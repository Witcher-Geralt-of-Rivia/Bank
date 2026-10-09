import { Landmark, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountStatusAction } from "@/components/admin/account-actions";
import { CurrencyProof } from "@/components/admin/currency-proof";
import { Money } from "@/components/shared/money";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { AccountStatusBadge } from "@/components/shared/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { ACCOUNT_TYPE_LABELS, type AccountType, isStaff, maskAccountNumber } from "@/lib/domain";
import { formatCount, pluralize } from "@/lib/format";
import { CURRENCY_CODES } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { type AdminAccountRow, listAllAccounts } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Accounts" };

/** What each of the bank's own accounts is for, in plain words. */
const LEDGER_PURPOSES: Partial<Record<AccountType, string>> = {
  clearing: "Money that has entered or left Aldera through other banks",
  transit: "Outgoing transfers that have left a customer account but not yet settled",
  fees: "Fees charged to customers",
  interest: "Interest paid to customers",
};

function Balance({ account }: { account: AdminAccountRow }) {
  return (
    <>
      <Money minor={account.postedMinor} currency={account.currency} className="block font-medium" />
      {account.heldMinor > 0n ? (
        <span className="block text-xs text-muted-foreground">
          <Money minor={account.heldMinor} currency={account.currency} /> reserved
        </span>
      ) : null}
    </>
  );
}

export default async function AdminAccountsPage() {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const db = await getDb();

  const accounts = await listAllAccounts(db);
  const customerAccounts = accounts.filter((account) => account.kind === "customer");
  const ledgerAccounts = accounts.filter((account) => account.kind === "system");
  const holders = new Set(customerAccounts.map((account) => account.ownerId)).size;
  const frozen = customerAccounts.filter((account) => account.status === "frozen").length;

  // Every balance in a currency, customer and bank side together, nets to zero.
  const sums = CURRENCY_CODES.map((currency) => {
    const inCurrency = accounts.filter((account) => account.currency === currency);
    const sideTotal = (kind: AdminAccountRow["kind"]) =>
      inCurrency.filter((account) => account.kind === kind).reduce((sum, account) => sum + account.postedMinor, 0n);
    return { currency, count: inCurrency.length, customerMinor: sideTotal("customer"), ledgerMinor: sideTotal("system") };
  }).filter((sum) => sum.count > 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Every account on the platform: the accounts customers hold, and the bank's own ledger accounts that sit on the other side of each movement."
      />

      <Section
        title="Customer accounts"
        description={`${pluralize(customerAccounts.length, "account")} held by ${pluralize(holders, "customer")}${frozen > 0 ? `, ${formatCount(frozen)} frozen` : ""}. A frozen account cannot send or receive funds; its balance is not affected.`}
        flush
      >
        {customerAccounts.length === 0 ? (
          <EmptyState icon={Wallet} title="No customer accounts yet" description="Accounts appear here as soon as a customer opens one." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="hidden md:table-cell">Customer</TableHead>
                <TableHead className="pl-5 md:pl-4">Account</TableHead>
                <TableHead className="hidden xl:table-cell">Status</TableHead>
                <TableHead className="hidden text-right md:table-cell">Balance</TableHead>
                <TableHead className="text-right">
                  <span className="md:hidden">Balance</span>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerAccounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="hidden max-w-[12rem] md:table-cell xl:max-w-[16rem]">
                    <span className="block truncate font-medium">{account.ownerName ?? "No owner"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{account.ownerEmail}</span>
                  </TableCell>
                  <TableCell className="w-full max-w-0 pl-5 md:pl-4">
                    <span className="block truncate font-medium">{account.name}</span>
                    <span className="block truncate text-xs text-muted-foreground md:hidden">{account.ownerName ?? "No owner"}</span>
                    <span className="tabular hidden truncate text-xs text-muted-foreground md:block">
                      {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency} · {maskAccountNumber(account.number)}
                    </span>
                    <span className="mt-1.5 block xl:hidden">
                      <AccountStatusBadge status={account.status} />
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <AccountStatusBadge status={account.status} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Balance account={account} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="md:hidden">
                      <Balance account={account} />
                    </div>
                    {account.status === "closed" ? null : (
                      <div className="mt-2 md:mt-0">
                        <AccountStatusAction id={account.id} name={account.name} ownerName={account.ownerName} status={account.status} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Ledger accounts"
        description="Aldera's own side of the books. Every movement has a bank-side leg posted to one of these accounts, which is why they can run negative and why all balances in a currency add up to zero."
        flush
        className="mt-6"
      >
        {ledgerAccounts.length === 0 ? (
          <EmptyState icon={Landmark} title="No ledger accounts" description="The bank's own accounts are created when the ledger is first set up." />
        ) : (
          <>
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
              {sums.map((sum) => (
                <CurrencyProof
                  key={sum.currency}
                  currency={sum.currency}
                  rows={[
                    { label: "Customer accounts", minor: sum.customerMinor },
                    { label: "Ledger accounts", minor: sum.ledgerMinor },
                  ]}
                  result={{ label: "All balances combined", minor: sum.customerMinor + sum.ledgerMinor }}
                  passed={sum.customerMinor + sum.ledgerMinor === 0n}
                />
              ))}
            </div>
            <div className="border-t border-border/70">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ledger account</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead className="hidden md:table-cell">Currency</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="w-full max-w-0 whitespace-normal">
                        <span className="block truncate font-medium">{account.name}</span>
                        <span className="block text-xs text-pretty text-muted-foreground">
                          {LEDGER_PURPOSES[account.type] ?? ACCOUNT_TYPE_LABELS[account.type]}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{ACCOUNT_TYPE_LABELS[account.type]}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
                          {account.currency}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money minor={account.postedMinor} currency={account.currency} className="font-medium" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
