"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS, TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";

const ALL = "all";

/**
 * Filters for a transaction list. State lives in the URL, so a filtered view
 * can be bookmarked, shared and navigated with the back button; the server
 * re-validates every parameter before using it.
 */
export function TransactionFilterBar({
  accounts,
}: {
  accounts?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const lastPushed = useRef(params.get("q") ?? "");

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  // Debounce typing so each keystroke does not trigger a request.
  useEffect(() => {
    if (search === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = search;
      update({ q: search.trim() || null });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` reads the latest params on each call
  }, [search]);

  const active = ["q", "type", "status", "account", "from", "to"].some((key) => params.get(key));

  return (
    <div className={cn("no-print grid gap-3 border-b border-border/70 p-4 sm:p-5", pending && "opacity-80")}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, descripción o referencia"
          aria-label="Buscar transacciones"
          className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {pending ? (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : search ? (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => setSearch("")}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-center">
        <Select value={params.get("status") ?? ALL} onValueChange={(value) => update({ status: value })}>
          <SelectTrigger aria-label="Estado" className="w-full lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {TRANSACTION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {TRANSACTION_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={params.get("type") ?? ALL} onValueChange={(value) => update({ type: value })}>
          <SelectTrigger aria-label="Tipo" className="w-full lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los tipos</SelectItem>
            {TRANSACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {TRANSACTION_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {accounts && accounts.length > 1 ? (
          <Select value={params.get("account") ?? ALL} onValueChange={(value) => update({ account: value })}>
            <SelectTrigger aria-label="Cuenta" className="col-span-2 w-full lg:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las cuentas</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <label className="flex flex-col gap-1 text-xs text-muted-foreground lg:flex-row lg:items-center lg:gap-2 lg:text-sm">
          <span className="shrink-0">Desde</span>
          <Input
            type="date"
            value={params.get("from") ?? ""}
            max={params.get("to") ?? undefined}
            onChange={(event) => update({ from: event.target.value || null })}
            className="tabular w-full lg:w-[9.5rem]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground lg:flex-row lg:items-center lg:gap-2 lg:text-sm">
          <span className="shrink-0">Hasta</span>
          <Input
            type="date"
            value={params.get("to") ?? ""}
            min={params.get("from") ?? undefined}
            onChange={(event) => update({ to: event.target.value || null })}
            className="tabular w-full lg:w-[9.5rem]"
          />
        </label>

        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 justify-self-start lg:ml-auto"
            onClick={() => {
              setSearch("");
              lastPushed.current = "";
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X /> Limpiar filtros
          </Button>
        ) : null}
      </div>
    </div>
  );
}
