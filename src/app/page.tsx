import Link from "next/link";
import ProcessorFilter from "@/components/ProcessorFilter";
import { EXPIRING_SOON_DAYS, STALL_DAYS } from "@/lib/config";
import { getDb, listApplicationSummaries, listProcessors } from "@/lib/db";
import { stalledReason } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function WorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ processor?: string | string[] }>;
}) {
  const db = getDb();
  const processors = listProcessors(db);
  const raw = (await searchParams).processor;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const processor = requested && processors.includes(requested) ? requested : "";
  const apps = listApplicationSummaries(db, processor || undefined);
  const stalledCount = apps.filter((a) => a.stalled).length;
  const expiredCount = apps.filter((a) => a.expiredCount > 0).length;
  const backQuery = processor ? `?processor=${encodeURIComponent(processor)}` : "";

  return (
    <>
      <h1>Applications</h1>
      <p className="subtle">Applications that need attention are listed first.</p>

      <div className="toolbar">
        <ProcessorFilter processors={processors} selected={processor} />
        <div className="badges">
          <span className="badge grey">{apps.length} applications</span>
          <span className={`badge ${stalledCount > 0 ? "red" : "grey"}`}>{stalledCount} stalled</span>
          <span className={`badge ${expiredCount > 0 ? "red" : "grey"}`}>
            {expiredCount} with expired documents
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Borrower</th>
              <th>Processor</th>
              <th className="num">Documents still needed</th>
              <th>Needs attention</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const reason = stalledReason(a);
              const attention = a.stalled || a.expiredCount > 0;
              return (
                <tr key={a.id} className={attention ? "attention" : undefined}>
                  <td>
                    <Link href={`/applications/${encodeURIComponent(a.id)}${backQuery}`}>
                      <strong>{a.business_name}</strong>
                    </Link>
                    <div className="subtle small">{a.id}</div>
                  </td>
                  <td>{a.borrower_name}</td>
                  <td>{a.assigned_processor}</td>
                  <td className="num">
                    {a.outstandingCount} of {a.totalDocs}
                  </td>
                  <td>
                    <div className="badges">
                      {reason && <span className="badge red">{reason}</span>}
                      {a.expiredCount > 0 && (
                        <span className="badge red">
                          {a.expiredCount} expired {a.expiredCount === 1 ? "document" : "documents"}
                        </span>
                      )}
                      {a.expiringSoonCount > 0 && (
                        <span className="badge amber">{a.expiringSoonCount} expiring soon</span>
                      )}
                      {!reason && a.expiredCount === 0 && a.expiringSoonCount === 0 && (
                        <span className="badge green">On track</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="legend">
        <strong>Stalled</strong> means documents are still needed and nothing has come in for {STALL_DAYS} days
        or more. <strong>Expiring soon</strong> means a document expires within {EXPIRING_SOON_DAYS} days.
      </p>
    </>
  );
}
