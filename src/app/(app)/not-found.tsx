import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
      <EmptyState
        icon={Compass}
        title="We couldn't find that"
        description="The record doesn't exist, or it isn't available to your profile."
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
