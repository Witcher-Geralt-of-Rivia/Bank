import "server-only";
import { sql } from "drizzle-orm";
import { type DbOrTx, rowsOf } from "@/db/client";
import type { CurrencyCode } from "@/lib/money";

export type CurrencyTotals = {
  currency: CurrencyCode;
  debitMinor: bigint;
  creditMinor: bigint;
  /** Sum of every account balance in the currency; zero in a sound ledger. */
  netBalanceMinor: bigint;
};

export type LedgerIntegrityReport = {
  healthy: boolean;
  entryCount: number;
  currencies: CurrencyTotals[];
  /** Transactions whose entries do not sum to zero. */
  unbalancedTransactions: number;
  /** Accounts whose stored balance differs from the sum of their entries. */
  driftedAccounts: number;
  checkedAt: Date;
};

/**
 * Re-derives the ledger's invariants from the raw entries.
 *
 * The database already prevents these from being violated; this report proves
 * it on demand, the way a nightly reconciliation job would:
 *   1. total debits equal total credits in every currency;
 *   2. every transaction balances on its own;
 *   3. every account's running balance equals the sum of its entries;
 *   4. all balances in a currency net to zero (nothing created or destroyed).
 */
export async function checkLedgerIntegrity(
  db: DbOrTx,
): Promise<LedgerIntegrityReport> {
  const totals = rowsOf<{
    currency: CurrencyCode;
    debit: string;
    credit: string;
    entries: string;
  }>(
    await db.execute(sql`
      SELECT currency,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debit,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit,
             COUNT(*)::text AS entries
        FROM ledger_entries
       GROUP BY currency
       ORDER BY currency
    `),
  );

  const balances = rowsOf<{ currency: CurrencyCode; net: string }>(
    await db.execute(sql`
      SELECT currency, COALESCE(SUM(posted_minor), 0)::text AS net
        FROM accounts
       GROUP BY currency
    `),
  );

  const [unbalanced] = rowsOf<{ count: string }>(
    await db.execute(sql`
      SELECT COUNT(*)::text AS count FROM (
        SELECT transaction_id
          FROM ledger_entries
         GROUP BY transaction_id, currency
        HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
      ) AS offending
    `),
  );

  const [drifted] = rowsOf<{ count: string }>(
    await db.execute(sql`
      SELECT COUNT(*)::text AS count
        FROM accounts a
        LEFT JOIN (
          SELECT account_id,
                 SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END) AS balance
            FROM ledger_entries
           GROUP BY account_id
        ) e ON e.account_id = a.id
       WHERE a.posted_minor <> COALESCE(e.balance, 0)
    `),
  );

  const netByCurrency = new Map(balances.map((row) => [row.currency, BigInt(row.net)]));
  const currencies: CurrencyTotals[] = totals.map((row) => ({
    currency: row.currency,
    debitMinor: BigInt(row.debit),
    creditMinor: BigInt(row.credit),
    netBalanceMinor: netByCurrency.get(row.currency) ?? 0n,
  }));

  const unbalancedTransactions = Number(unbalanced?.count ?? 0);
  const driftedAccounts = Number(drifted?.count ?? 0);

  return {
    healthy:
      unbalancedTransactions === 0 &&
      driftedAccounts === 0 &&
      currencies.every(
        (c) => c.debitMinor === c.creditMinor && c.netBalanceMinor === 0n,
      ),
    entryCount: totals.reduce((sum, row) => sum + Number(row.entries), 0),
    currencies,
    unbalancedTransactions,
    driftedAccounts,
    checkedAt: new Date(),
  };
}
