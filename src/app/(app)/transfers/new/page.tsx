import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page";
import { TransferWizard } from "@/components/transfers/transfer-wizard";
import { getDb } from "@/db/client";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "@/lib/domain";
import { requireCustomer } from "@/server/auth/session";
import { listAccountsForUser } from "@/server/queries/accounts";
import { listBeneficiaries } from "@/server/queries/misc";

export const metadata: Metadata = { title: "Move money" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function NewTransferPage({ searchParams }: Props) {
  const user = await requireCustomer();
  const params = await searchParams;
  const db = await getDb();

  const [accounts, beneficiaries] = await Promise.all([
    listAccountsForUser(db, user.id),
    listBeneficiaries(db, user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Move money"
        description="Send to a saved beneficiary or between your own accounts. You will review everything before anything is sent."
      />
      <TransferWizard
        accounts={accounts
          .filter((account) => account.status !== "closed")
          .map((account) => ({
            id: account.id,
            name: account.name,
            maskedNumber: maskAccountNumber(account.number),
            typeLabel: ACCOUNT_TYPE_LABELS[account.type],
            currency: account.currency,
            // bigint does not cross the server/client boundary as a prop.
            availableMinor: account.availableMinor.toString(),
            usable: account.status === "active",
          }))}
        beneficiaries={beneficiaries.map((b) => ({
          id: b.id,
          name: b.name,
          nickname: b.nickname,
          bankName: b.bankName,
          maskedNumber: maskAccountNumber(b.accountNumber),
          currency: b.currency,
          kind: b.kind,
        }))}
        initialSourceId={first(params.from)}
        initialBeneficiaryId={first(params.to)}
      />
    </>
  );
}
