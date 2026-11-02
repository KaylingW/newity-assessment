"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";
import { APPLICATION_STATUSES } from "@/lib/rules";

export default function ApplicationFilters({ processors }: { processors: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-[240px] flex-1 lg:max-w-[555px]">
        <span className="sr-only">Search borrower or application ID</span>
        <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] text-muted">
          ⌕
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search borrower or application ID"
          className="h-[46px] w-full rounded-[9px] border border-line bg-surface pl-10 pr-3.5 text-[13px] text-text shadow-xs outline-none placeholder:text-muted focus:border-brand/50 focus:ring-4 focus:ring-brand/15"
        />
      </label>
      <Dropdown
        label="Status"
        value={params.get("status") ?? ""}
        onChange={(v) => update("status", v)}
        options={[{ value: "", label: "All statuses" }, ...APPLICATION_STATUSES.map((s) => ({ value: s, label: s }))]}
      />
      <Dropdown
        label="Processor"
        value={params.get("processor") ?? ""}
        onChange={(v) => update("processor", v)}
        options={[{ value: "", label: "All processors" }, ...processors.map((p) => ({ value: p, label: p }))]}
      />
      <Dropdown
        label="Expiry"
        value={params.get("expiry") ?? ""}
        onChange={(v) => update("expiry", v)}
        options={[
          { value: "", label: "Any expiry" },
          { value: "expired", label: "Has expired docs" },
          { value: "soon", label: "Expiring within 30 days" },
        ]}
      />
      <fieldset className="flex items-center gap-2 text-[13px] text-muted">
        <legend className="sr-only">Application date</legend>
        <span aria-hidden>Applied</span>
        <input
          type="date"
          aria-label="Applied from"
          value={params.get("from") ?? ""}
          max={params.get("to") ?? undefined}
          onChange={(e) => update("from", e.target.value)}
          className={dateField}
        />
        <span aria-hidden>to</span>
        <input
          type="date"
          aria-label="Applied to"
          value={params.get("to") ?? ""}
          min={params.get("from") ?? undefined}
          onChange={(e) => update("to", e.target.value)}
          className={dateField}
        />
      </fieldset>
    </div>
  );
}

const dateField =
  "h-[46px] rounded-[9px] border border-line bg-surface px-3 text-[13px] font-medium text-ink shadow-xs outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/15";
