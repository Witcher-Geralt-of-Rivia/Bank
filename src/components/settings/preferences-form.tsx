"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingSwitch } from "@/components/settings/setting-switch";
import { updatePreferencesAction } from "@/server/actions/banking";

type Preferences = { notifyTransfers: boolean; notifySecurity: boolean };

/** Notification preferences. There is no save button: each change is stored as it is made. */
export function PreferencesForm({ notifyTransfers, notifySecurity }: Preferences) {
  const router = useRouter();
  const [preferences, setPreferences] = useState<Preferences>({ notifyTransfers, notifySecurity });
  const [pending, startTransition] = useTransition();

  function save(next: Preferences) {
    const previous = preferences;
    setPreferences(next);
    startTransition(async () => {
      const result = await updatePreferencesAction(next);
      if (!result.ok) {
        setPreferences(previous);
        toast.error(result.error.message);
        return;
      }
      toast.success("Preferencias de notificaciones guardadas");
      router.refresh();
    });
  }

  return (
    <div role="group" aria-label="Preferencias de notificaciones" className="divide-y divide-border/70">
      <SettingSwitch
        label="Novedades de transferencias"
        hint="Transferencias enviadas, recibidas, retenidas para revisión o devueltas."
        checked={preferences.notifyTransfers}
        disabled={pending}
        onCheckedChange={(checked) => save({ ...preferences, notifyTransfers: checked })}
        className="pb-4"
      />
      <SettingSwitch
        label="Alertas de seguridad"
        hint="Cambios de contraseña y otra actividad que afecta el acceso a tu perfil."
        checked={preferences.notifySecurity}
        disabled={pending}
        onCheckedChange={(checked) => save({ ...preferences, notifySecurity: checked })}
        className="pt-4"
      />
    </div>
  );
}
