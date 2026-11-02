import Link from "next/link";
import { notFound } from "next/navigation";
import DocumentRowEditor from "@/components/DocumentRowEditor";
import { Pill } from "@/components/ui";
import { AS_OF_DATE, DOCUMENT_STATUSES } from "@/lib/config";
import { getApplication, getDb, listDocuments } from "@/lib/db";
import { listQueryString, type RawParams } from "@/lib/listQuery";
import {
  applicationStatus,
  docState,
  expiringSoonWarning,
  formatDate,
  stalledReason,
  summarizeApplication,
} from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  const { id } = await params;
  const db = getDb();
  const app = getApplication(db, decodeURIComponent(id));
  if (!app) notFound();

  const docs = listDocuments(db, app.id);
  const summary = summarizeApplication(app, docs, AS_OF_DATE);
  const status = applicationStatus(summary);
  const reason = stalledReason(summary);
  const warning = expiringSoonWarning(summary);
  const backHref = `/${listQueryString(await searchParams)}`;
  const pct = summary.totalDocs ? Math.round((summary.completeCount / summary.totalDocs) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-[13px] font-semibold text-brand hover:underline">
          ‹&nbsp;&nbsp;All applications
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold leading-tight text-ink">{app.business_name}</h1>
            <p className="mt-2 flex flex-wrap gap-x-2 text-[13px] text-muted">
              <span>{app.id}</span>•<span>${app.loan_amount.toLocaleString("en-US")}</span>•
              <span>Processor: {app.assigned_processor}</span>•<span>Borrower: {app.borrower_name}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Applied {formatDate(app.application_date)} · Last document received {formatDate(summary.lastActivity)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 pt-2.5">
            <div className="flex flex-wrap justify-end gap-1.5">
              <Pill tone={status.tone}>{status.label}</Pill>
              {warning && <Pill tone="amber">{warning}</Pill>}
            </div>
            {reason && <span className="text-[11px] text-red-fg">{reason}</span>}
          </div>
        </div>
      </div>

      <section className="mt-9 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Document checklist</h2>
          <p className="mt-2.5 text-xs text-muted">
            {summary.completeCount} of {summary.totalDocs} approved or not required
            {summary.expiredCount > 0 && <span className="text-red-fg"> · {summary.expiredCount} expired</span>}
            {summary.expiringSoonCount > 0 && (
              <span className="text-amber-fg"> · {summary.expiringSoonCount} expiring soon</span>
            )}
          </p>
        </div>
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          <span className="w-10 text-base font-semibold text-brand tabular-nums">{pct}%</span>
          <div
            role="progressbar"
            aria-label="Checklist progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[9px] flex-1 overflow-hidden rounded-full bg-track sm:w-[365px] sm:flex-none"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-[11px]">
          <thead>
            <tr className="uppercase text-muted">
              {["Document type", "Status", "Received", "Expires", "Notes"].map((h, i, all) => (
                <th
                  key={h}
                  scope="col"
                  className={`h-[43px] bg-table-head px-[18px] font-semibold ${i === 0 ? "rounded-l-lg" : ""} ${
                    i === all.length - 1 ? "w-[32%] rounded-r-lg" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map((d, i) => {
              const state = docState(d, AS_OF_DATE);
              return (
                <DocumentRowEditor
                  key={d.id}
                  striped={i % 2 === 0}
                  doc={d}
                  statuses={[...DOCUMENT_STATUSES]}
                  expired={state.expired}
                  derivedExpired={state.expired && d.status !== "Expired"}
                  expiringSoon={state.expiringSoon}
                  expiresLabel={formatDate(d.expiration_date)}
                  asOf={AS_OF_DATE}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Changes save automatically. Marking a document Received, Under Review or Approved fills in today&apos;s date if
        no received date is set.
      </p>
    </div>
  );
}
