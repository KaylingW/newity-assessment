import type { Tone } from "@/lib/rules";

export const TONE_CLASSES: Record<Tone, string> = {
  red: "bg-red-bg text-red-fg",
  amber: "bg-amber-bg text-amber-fg",
  green: "bg-green-bg text-green-fg",
  blue: "bg-blue-bg text-blue-fg",
  grey: "bg-subtle text-muted",
};

export function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-[27px] items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13px] text-muted">{subtitle}</p>}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-3 text-[28px] font-semibold leading-none text-ink tabular-nums">{value}</p>
    </div>
  );
}
