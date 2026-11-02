import Link from "next/link";
import { PageTitle, Pill } from "@/components/ui";
import { AS_OF_DATE, EXPIRING_SOON_DAYS } from "@/lib/config";
import { getDb, listApplicationSummaries, listDocumentsByApplication } from "@/lib/db";
import type { RawParams } from "@/lib/listQuery";
import { outstandingGroups, type OutstandingView } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function OutstandingPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const view: OutstandingView = (await searchParams).view === "expiring" ? "expiring" : "missing";
  const db = getDb();
  const apps = listApplicationSummaries(db);
  const docsByApp = listDocumentsByApplication(db);
  const missing = outstandingGroups(apps, docsByApp, "missing", AS_OF_DATE);
  const expiring = outstandingGroups(apps, docsByApp, "expiring", AS_OF_DATE);
  const groups = view === "missing" ? missing : expiring;
  const highCount = groups.filter((g) => g.priority === "HIGH").length;
  const count = (gs: typeof groups) => gs.reduce((n, g) => n + g.items.length, 0);

  const tabs = [
    { view: "missing", href: "/outstanding", label: `Missing documents`, n: count(missing) },
    { view: "expiring", href: "/outstanding?view=expiring", label: `Expiring within ${EXPIRING_SOON_DAYS} days`, n: count(expiring) },
  ];

  return (
    <div className="space-y-6">
      <PageTitle
        title="Outstanding items"
        subtitle="Prioritize missing documents and documents approaching expiration."
      />

      <nav aria-label="Views" className="mt-9 flex flex-wrap gap-x-20 gap-y-2 rounded-[10px] border border-line bg-surface px-5 py-[18px] text-sm">
        {tabs.map((t) => (
          <Link
            key={t.view}
            href={t.href}
            aria-current={view === t.view ? "page" : undefined}
            className={view === t.view ? "font-semibold text-brand" : "text-muted hover:text-text"}
          >
            {t.label}&nbsp;&nbsp;({t.n})
          </Link>
        ))}
      </nav>

      {highCount > 0 && (
        <div className="rounded-[11px] bg-banner px-[22px] py-3.5">
          <p className="text-[15px] font-semibold text-ink">
            {highCount} {highCount === 1 ? "application needs" : "applications need"} immediate attention
          </p>
          <p className="mt-2 text-xs text-muted">
            High priority means the application is stalled or has an expired document.
            {view === "missing" ? " Listed in worklist order." : " Ordered by soonest expiry."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map(({ app, priority, items }) => (
          <Link
            key={app.id}
            href={`/applications/${encodeURIComponent(app.id)}`}
            className="block rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-brand/40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold text-ink">{app.business_name}</h2>
                <p className="mt-1.5 text-xs text-muted">
                  {app.id}
                  <span className="mx-2.5">•</span>
                  {app.outstandingCount} outstanding
                  <span className="mx-2.5">•</span>
                  {app.assigned_processor}
                </p>
              </div>
              <Pill tone={priority === "HIGH" ? "red" : "amber"}>{priority}</Pill>
            </div>
            <ul className="mt-3 space-y-1 pl-2 text-xs text-text">
              {items.map((item) => (
                <li key={item.document_type} className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>
                    {item.document_type} — {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </Link>
        ))}
        {groups.length === 0 && (
          <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-[13px] text-muted">
            Nothing to chase here.
          </p>
        )}
      </div>
    </div>
  );
}
