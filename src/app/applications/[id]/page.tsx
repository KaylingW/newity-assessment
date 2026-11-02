import Link from "next/link";
import { notFound } from "next/navigation";
import DocumentRowEditor from "@/components/DocumentRowEditor";
import { AS_OF_DATE, DOCUMENT_STATUSES } from "@/lib/config";
import { getApplication, getDb, listDocuments } from "@/lib/db";
import { docState, formatDate, stalledReason, summarizeApplication } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ processor?: string | string[] }>;
}) {
  const { id } = await params;
  const db = getDb();
  const app = getApplication(db, decodeURIComponent(id));
  if (!app) notFound();

  const docs = listDocuments(db, app.id);
  const summary = summarizeApplication(app, docs, AS_OF_DATE);
  const reason = stalledReason(summary);
  const raw = (await searchParams).processor;
  const processor = Array.isArray(raw) ? raw[0] : raw;
  const backHref = processor ? `/?processor=${encodeURIComponent(processor)}` : "/";

  return (
    <>
      <p>
        <Link href={backHref}>← Back to applications</Link>
      </p>
      <h1>{app.business_name}</h1>
      <div className="facts">
        <span>
          Borrower <strong>{app.borrower_name}</strong>
        </span>
        <span>
          Processor <strong>{app.assigned_processor}</strong>
        </span>
        <span>
          Loan <strong>${app.loan_amount.toLocaleString("en-US")}</strong>
        </span>
        <span>
          Applied <strong>{formatDate(app.application_date)}</strong>
        </span>
        <span>
          Last document received <strong>{formatDate(summary.lastActivity)}</strong>
        </span>
        <span className="subtle">{app.id}</span>
      </div>

      <div className="badges" style={{ marginBottom: 16 }}>
        <span className="badge grey">
          {summary.outstandingCount} of {summary.totalDocs} documents still needed
        </span>
        {reason && <span className="badge red">{reason}</span>}
        {summary.expiredCount > 0 && (
          <span className="badge red">
            {summary.expiredCount} expired {summary.expiredCount === 1 ? "document" : "documents"}
          </span>
        )}
        {summary.expiringSoonCount > 0 && (
          <span className="badge amber">{summary.expiringSoonCount} expiring soon</span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th>Received</th>
              <th>Expires</th>
              <th style={{ width: "32%" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const state = docState(d, AS_OF_DATE);
              return (
                <DocumentRowEditor
                  key={d.id}
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
      <p className="legend">
        Changes save automatically. Marking a document Received, Under Review or Approved fills in today&apos;s
        date if no received date is set.
      </p>
    </>
  );
}
