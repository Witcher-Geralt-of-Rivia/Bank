"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/shared/client";
import { markAllNotificationsReadAction } from "@/server/actions/banking";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction({});
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("All notifications marked as read");
      router.refresh();
    });
  }

  return (
    <SubmitButton
      type="button"
      variant="outline"
      size="lg"
      pending={pending}
      pendingLabel="Mark all as read"
      disabled={disabled || pending}
      onClick={markAll}
    >
      <CheckCheck /> Mark all as read
    </SubmitButton>
  );
}
