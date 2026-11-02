import Link from "next/link";
import { Suspense } from "react";
import ApplicationFilters from "@/components/ApplicationFilters";
import ClickableRow from "@/components/ClickableRow";
import { MetricCard, PageTitle, Pill } from "@/components/ui";
import { EXPIRING_SOON_DAYS, STALL_DAYS } from "@/lib/config";
import { getDb, listApplicationSummaries, listProcessors } from "@/lib/db";
import { listQueryString, readListQuery, type RawParams } from "@/lib/listQuery";
import { applicationStatus, expiringSoonWarning, filterApplications, formatDate, stalledReason } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const db = getDb();
  const processors = listProcessors(db);
  const raw = await searchParams;
  const { filters, processor } = readListQuery(raw, processors);
  const apps = filterApplications(listApplicationSummaries(db, processor || undefined), filters);
  const backQuery = listQueryString(raw);

  return (
    <div className="space-y-8">
      <PageTitle
        title="Loan applications"
        subtitle="Track SBA document readiness across active loan applications."
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:gap-[35px]">
        <MetricCard label="Active applications" value={apps.length} />
        <MetricCard label="Need documents" value={apps.filter((a) => a.outstandingCount > 0).length} />
        <MetricCard
          label={`Expiring within ${EXPIRING_SOON_DAYS} days`}
          value={apps.filter((a) => a.expiringSoonCount > 0).length}
        />
      </div>

      <Suspense>
        <ApplicationFilters processors={processors} />
      </Suspense>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr className="text-[11px] font-semibold uppercase text-muted">
              {["Application", "Borrower", "Applied", "Documents", "Outstanding", "Next expiry", "Status"].map((h, i, all) => (
                <th
                  key={h}
                  scope="col"
                  className={`h-[43px] bg-table-head px-[18px] font-semibold ${i === 0 ? "rounded-l-lg" : ""} ${
                    i === all.length - 1 ? "rounded-r-lg" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map((a, i) => {
              const status = applicationStatus(a);
              const warning = expiringSoonWarning(a);
              const href = `/applications/${encodeURIComponent(a.id)}${backQuery}`;
              return (
                <ClickableRow
                  key={a.id}
                  href={href}
                  className={`${i % 2 === 0 ? "bg-surface-alt" : "bg-surface"} hover:bg-subtle`}
                >
                  <td className="h-[74px] border-b border-line px-[18px]">
                    <Link href={href} className="font-semibold text-brand hover:underline">
                      {a.id}
                    </Link>
                  </td>
                  <td className="border-b border-line px-[18px]">
                    <Link href={href} className="text-text hover:underline">
                      {a.business_name}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {a.borrower_name} · {a.assigned_processor}
                    </div>
                  </td>
                  <td className="border-b border-line px-[18px]">{formatDate(a.application_date)}</td>
                  <td className="border-b border-line px-[18px] tabular-nums">
                    {a.completeCount} / {a.totalDocs}
                  </td>
                  <td className="border-b border-line px-[18px]">
                    {a.outstandingCount > 0 ? `${a.outstandingCount} outstanding` : "—"}
                  </td>
                  <td className="border-b border-line px-[18px]">{formatDate(a.nextExpiry) || "—"}</td>
                  <td className="border-b border-line px-[18px]">
                    <div className="flex flex-wrap gap-1.5">
                      <Pill tone={status.tone} title={stalledReason(a) ?? undefined}>
                        {status.label}
                      </Pill>
                      {warning && <Pill tone="amber">{warning}</Pill>}
                    </div>
                  </td>
                </ClickableRow>
              );
            })}
            {apps.length === 0 && (
              <tr>
                <td colSpan={7} className="px-[18px] py-10 text-center text-[13px] text-muted">
                  No applications match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        <strong className="font-semibold text-text">Stalled</strong> means documents are still needed and nothing has
        come in for {STALL_DAYS} days or more. <strong className="font-semibold text-text">Expiring soon</strong> means
        a document expires within {EXPIRING_SOON_DAYS} days; it shows beside the status, so a complete application
        still reads as Complete. <strong className="font-semibold text-text">Documents</strong>{" "}
        counts those approved or not required, out of the total.
      </p>
    </div>
  );
}
