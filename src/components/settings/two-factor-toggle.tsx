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
      toast.success(next ? "Verificación en dos pasos activada" : "Verificación en dos pasos desactivada");
      router.refresh();
    });
  }

  return (
    <SettingSwitch
      label="Verificación en dos pasos"
      hint="En esta demostración, el ajuste se registra y se audita, pero no se solicita un segundo factor al iniciar sesión."
      checked={checked}
      disabled={pending}
      onCheckedChange={toggle}
    />
  );
}
