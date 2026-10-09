import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-sidebar" />
      <path
        d="M9.2 22.4 16 9.6l6.8 12.8"
        fill="none"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-sidebar-primary"
      />
      <path d="M12.6 18.2h6.8" strokeWidth="2.7" strokeLinecap="round" className="stroke-sidebar-primary" />
    </svg>
  );
}

export function Logo({
  className,
  tone = "dark",
}: {
  className?: string;
  /** "dark" for light surfaces, "light" for the evergreen rail. */
  tone?: "dark" | "light";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={tone === "light" ? "[&_rect]:fill-white/10" : undefined} />
      <span
        className={cn(
          "text-[1.0625rem] font-semibold tracking-[-0.02em]",
          tone === "light" ? "text-sidebar-foreground" : "text-foreground",
        )}
      >
        Aldera
      </span>
    </span>
  );
}
