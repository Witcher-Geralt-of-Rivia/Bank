import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { isStaff } from "@/lib/domain";
import { requireUser } from "@/server/auth/session";

/**
 * Gate for the operations console. Customers who reach an /admin URL get a
 * plain refusal and no operational data; each page and action underneath
 * checks the role again for itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (!isStaff(user.role)) {
    return (
      <div className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to this area"
          description="The operations console is restricted to Aldera staff. If you think this is a mistake, contact your administrator."
          action={
            <Button asChild>
              <Link href="/dashboard">Back to overview</Link>
            </Button>
          }
          className="py-20"
        />
      </div>
    );
  }

  return children;
}
