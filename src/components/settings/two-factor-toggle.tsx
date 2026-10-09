"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingSwitch } from "@/components/settings/setting-switch";
import { setTwoFactorAction } from "@/server/actions/banking";

/** Turns two-step verification on or off; the change is saved as soon as the switch moves. */
export function TwoFactorToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await setTwoFactorAction({ enabled: next });
      if (!result.ok) {
        setChecked(!next);
        toast.error(result.error.message);
        return;
      }
      toast.success(next ? "Two-step verification turned on" : "Two-step verification turned off");
      router.refresh();
    });
  }

  return (
    <SettingSwitch
      label="Two-step verification"
      hint="In this demonstration the setting is recorded and audited, but no second factor is requested at sign-in."
      checked={checked}
      disabled={pending}
      onCheckedChange={toggle}
    />
  );
}
