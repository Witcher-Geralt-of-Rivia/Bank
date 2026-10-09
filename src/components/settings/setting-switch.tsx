"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A labelled on/off setting. The state is written out, not left to the colour of the switch. */
export function SettingSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
  className,
}: {
  label: string;
  hint: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        <p id={`${id}-hint`} className="mt-1 max-w-xl text-[0.8125rem] text-pretty text-muted-foreground">
          {hint}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span aria-hidden="true" className="tabular w-6 text-right text-xs font-medium text-muted-foreground">
          {checked ? "Sí" : "No"}
        </span>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={`${id}-hint`}
        />
      </div>
    </div>
  );
}
