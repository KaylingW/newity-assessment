// Pure business rules. No database access here, so everything is unit-testable.
// All dates are ISO YYYY-MM-DD strings; ISO strings sort and compare correctly as text.

import {
  ARRIVED_STATUSES,
  COMPLETE_STATUSES,
  DOCUMENT_STATUSES,
  EXPIRING_SOON_DAYS,
  EXPIRY_RULES,
  STALL_DAYS,
  type DocumentStatus,
} from "./config";

export interface Application {
  id: string;
  business_name: string;
  borrower_name: string;
  loan_amount: number;
  application_date: string;
  assigned_processor: string;
}

export interface DocumentRow {
  id: number;
  application_id: string;
  document_type: string;
  status: string;
  date_received: string | null;
  expiration_date: string | null;
  notes: string | null;
}

// ---------- Dates ----------

const MS_PER_DAY = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** True when the value is a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(toUtc(value)).toISOString().slice(0, 10) === value;
}

/** Converts the CSV's M/D/YYYY dates to ISO. Blank gives null; anything unparseable throws. */
export function parseUsDate(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) throw new Error(`Unrecognized date "${raw}" (expected M/D/YYYY)`);
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (!isIsoDate(iso)) throw new Error(`Invalid calendar date "${raw}"`);
  return iso;
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-15" -> "Feb 15, 2026". Timezone-free. */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// ---------- Document state ----------

export function isKnownStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export interface DocState {
  /** Expired by stored status or by expiration date before the as-of date. */
  expired: boolean;
  /** Not expired, and expires within EXPIRING_SOON_DAYS of the as-of date. */
  expiringSoon: boolean;
  /** Approved or Not Required, and not expired. */
  complete: boolean;
  outstanding: boolean;
  /** Status to display: "Expired" when derived-expired, otherwise the stored status. */
  effectiveStatus: string;
}

export function docState(
  doc: Pick<DocumentRow, "status" | "expiration_date">,
  asOf: string,
): DocState {
  const expired =
    doc.status === "Expired" || (doc.expiration_date !== null && doc.expiration_date < asOf);
  const expiringSoon =
    !expired &&
    doc.expiration_date !== null &&
    doc.expiration_date <= addDays(asOf, EXPIRING_SOON_DAYS);
  const complete = !expired && (COMPLETE_STATUSES as readonly string[]).includes(doc.status);
  return {
    expired,
    expiringSoon,
    complete,
    outstanding: !complete,
    effectiveStatus: expired ? "Expired" : doc.status,
  };
}

// ---------- Application rollup ----------

export interface ApplicationSummary extends Application {
  totalDocs: number;
  completeCount: number;
  outstandingCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  /** Earliest expiration date on or after the as-of date, or null when none. */
  nextExpiry: string | null;
  /** Latest received date, or the application date if nothing has been received. */
  lastActivity: string;
  daysIdle: number;
  stalled: boolean;
}

export function summarizeApplication(
  app: Application,
  docs: Pick<DocumentRow, "status" | "expiration_date" | "date_received">[],
  asOf: string,
): ApplicationSummary {
  let outstandingCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;
  let nextExpiry: string | null = null;
  let latestReceived: string | null = null;
  for (const doc of docs) {
    const state = docState(doc, asOf);
    if (state.outstanding) outstandingCount++;
    if (
      !state.expired &&
      doc.expiration_date !== null &&
      (nextExpiry === null || doc.expiration_date < nextExpiry)
    ) {
      nextExpiry = doc.expiration_date;
    }
    if (state.expired) expiredCount++;
    if (state.expiringSoon) expiringSoonCount++;
    if (doc.date_received && (latestReceived === null || doc.date_received > latestReceived)) {
      latestReceived = doc.date_received;
    }
  }
  const lastActivity = latestReceived ?? app.application_date;
  const daysIdle = daysBetween(lastActivity, asOf);
  return {
    ...app,
    totalDocs: docs.length,
    completeCount: docs.length - outstandingCount,
    outstandingCount,
    expiredCount,
    expiringSoonCount,
    nextExpiry,
    lastActivity,
    daysIdle,
    stalled: outstandingCount > 0 && daysIdle >= STALL_DAYS,
  };
}

/** Plain-language reason for the stalled flag, or null when not stalled. */
export function stalledReason(s: Pick<ApplicationSummary, "stalled" | "daysIdle" | "outstandingCount">): string | null {
  if (!s.stalled) return null;
  return `Stalled — ${s.daysIdle} days idle, ${s.outstandingCount} outstanding`;
}

export type Tone = "red" | "amber" | "green" | "blue" | "grey";

export const APPLICATION_STATUSES = ["Stalled", "Expired docs", "Needs docs", "Complete"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * The single most urgent label for an application. Expiring-soon documents don't change it: they're shown
 * as a separate warning (expiringSoonWarning), so a finished application still reads as Complete.
 */
export function applicationStatus(
  s: Pick<ApplicationSummary, "stalled" | "expiredCount" | "outstandingCount">,
): { label: ApplicationStatus; tone: Tone } {
  if (s.stalled) return { label: "Stalled", tone: "red" };
  if (s.expiredCount > 0) return { label: "Expired docs", tone: "red" };
  if (s.outstandingCount > 0) return { label: "Needs docs", tone: "amber" };
  return { label: "Complete", tone: "green" };
}

/** Warning shown beside the status, e.g. "1 expiring soon", or null when nothing is expiring soon. */
export function expiringSoonWarning(s: Pick<ApplicationSummary, "expiringSoonCount">): string | null {
  return s.expiringSoonCount > 0 ? `${s.expiringSoonCount} expiring soon` : null;
}

export interface ApplicationFilters {
  /** Matches application id, business name or borrower name, case-insensitive. */
  q?: string;
  status?: ApplicationStatus;
  expiry?: "expired" | "soon";
  /** Application date on or after this ISO date. */
  appliedFrom?: string;
  /** Application date on or before this ISO date. */
  appliedTo?: string;
}

export function filterApplications<T extends ApplicationSummary>(apps: T[], f: ApplicationFilters): T[] {
  const q = f.q?.trim().toLowerCase();
  return apps.filter(
    (a) =>
      (!q || [a.id, a.business_name, a.borrower_name].some((v) => v.toLowerCase().includes(q))) &&
      (!f.status || applicationStatus(a).label === f.status) &&
      (f.expiry !== "expired" || a.expiredCount > 0) &&
      (f.expiry !== "soon" || a.expiringSoonCount > 0) &&
      (!f.appliedFrom || a.application_date >= f.appliedFrom) &&
      (!f.appliedTo || a.application_date <= f.appliedTo),
  );
}

/** Pill colour for a document's displayed status. */
export function documentStatusTone(status: string): Tone {
  switch (status) {
    case "Approved":
      return "green";
    case "Received":
    case "Under Review":
      return "blue";
    case "Pending":
      return "amber";
    case "Expired":
      return "red";
    default:
      return "grey";
  }
}

// ---------- Outstanding items ----------

export type OutstandingView = "missing" | "expiring";

export interface OutstandingGroup {
  app: ApplicationSummary;
  priority: "HIGH" | "MEDIUM";
  items: { document_type: string; label: string; sortKey: string }[];
}

/**
 * Groups documents that need chasing by application.
 * - "missing": Pending (not yet sent) or expired (needs a new copy).
 * - "expiring": not expired, but expiring within EXPIRING_SOON_DAYS.
 * HIGH priority means the application is stalled or has an expired document.
 * Missing groups keep worklist order; expiring groups are ordered by soonest expiry.
 */
export function outstandingGroups(
  apps: ApplicationSummary[],
  docsByApp: Map<string, Pick<DocumentRow, "document_type" | "status" | "expiration_date">[]>,
  view: OutstandingView,
  asOf: string,
): OutstandingGroup[] {
  const groups: OutstandingGroup[] = [];
  for (const app of apps) {
    const items: OutstandingGroup["items"] = [];
    for (const d of docsByApp.get(app.id) ?? []) {
      const state = docState(d, asOf);
      if (view === "missing" && (state.expired || d.status === "Pending")) {
        items.push({ document_type: d.document_type, label: state.expired ? "Expired" : "Missing", sortKey: d.document_type });
      } else if (view === "expiring" && state.expiringSoon && d.expiration_date) {
        items.push({
          document_type: d.document_type,
          label: `Expires ${formatDate(d.expiration_date)}`,
          sortKey: d.expiration_date,
        });
      }
    }
    if (items.length === 0) continue;
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    groups.push({ app, priority: app.stalled || app.expiredCount > 0 ? "HIGH" : "MEDIUM", items });
  }
  const rank = (g: OutstandingGroup) => (g.priority === "HIGH" ? 0 : 1);
  return groups.sort(
    (a, b) => rank(a) - rank(b) || (view === "expiring" ? a.items[0].sortKey.localeCompare(b.items[0].sortKey) : 0),
  );
}

/** Worklist order: stalled, then has expired, then expiring soon, then most outstanding, then id. */
export function compareWorklist(a: ApplicationSummary, b: ApplicationSummary): number {
  const flag = (x: boolean) => (x ? 0 : 1);
  return (
    flag(a.stalled) - flag(b.stalled) ||
    flag(a.expiredCount > 0) - flag(b.expiredCount > 0) ||
    flag(a.expiringSoonCount > 0) - flag(b.expiringSoonCount > 0) ||
    b.outstandingCount - a.outstandingCount ||
    a.id.localeCompare(b.id)
  );
}

// ---------- Edits ----------

export interface DocumentEdit {
  status?: unknown;
  date_received?: unknown;
  notes?: unknown;
}

export type EditResult =
  | { ok: true; fields: Pick<DocumentRow, "status" | "date_received" | "expiration_date" | "notes"> }
  | { ok: false; error: string };

const MAX_NOTES_LENGTH = 2000;

/**
 * Validates an edit and works out the full set of stored fields after it.
 * - Setting an "arrived" status on a document with no received date fills in the as-of date.
 * - A new received date recalculates the expiration date for types that expire; clearing it clears the expiration.
 * - A new received date on a document stored as Expired (with no status in the same edit) marks it Received,
 *   since a replacement has arrived.
 * - Status-only and notes-only edits never touch the received date, so they don't reset the stall clock.
 */
export function applyDocumentEdit(
  current: DocumentRow,
  edit: DocumentEdit,
  asOf: string,
): EditResult {
  const hasStatus = edit.status !== undefined;
  const hasReceived = edit.date_received !== undefined;
  const hasNotes = edit.notes !== undefined;
  if (!hasStatus && !hasReceived && !hasNotes) {
    return { ok: false, error: "Nothing to save. Send a status, received date or notes." };
  }

  if (hasStatus && !isKnownStatus(edit.status)) {
    return {
      ok: false,
      error: `"${String(edit.status)}" is not a valid status. Choose one of: ${DOCUMENT_STATUSES.join(", ")}.`,
    };
  }

  let receivedInput: string | null = null;
  if (hasReceived) {
    if (edit.date_received === null || edit.date_received === "") {
      receivedInput = null;
    } else if (isIsoDate(edit.date_received)) {
      receivedInput = edit.date_received;
      if (receivedInput > asOf) {
        return { ok: false, error: `Received date can't be after today (${asOf}).` };
      }
    } else {
      return { ok: false, error: "Received date must be a real date (YYYY-MM-DD), or blank." };
    }
  }

  if (hasNotes && edit.notes !== null && typeof edit.notes !== "string") {
    return { ok: false, error: "Notes must be text." };
  }
  if (typeof edit.notes === "string" && edit.notes.length > MAX_NOTES_LENGTH) {
    return { ok: false, error: `Notes are too long (max ${MAX_NOTES_LENGTH} characters).` };
  }

  let status: string = hasStatus ? (edit.status as string) : current.status;
  let dateReceived = hasReceived ? receivedInput : current.date_received;

  const statusChanged = status !== current.status;
  if (
    statusChanged &&
    !hasReceived &&
    dateReceived === null &&
    (ARRIVED_STATUSES as readonly string[]).includes(status)
  ) {
    dateReceived = asOf;
  }

  let expirationDate = current.expiration_date;
  if (dateReceived !== current.date_received) {
    const rule = EXPIRY_RULES[current.document_type];
    if (rule !== undefined) {
      expirationDate = dateReceived ? addDays(dateReceived, rule) : null;
    }
    if (!hasStatus && current.status === "Expired" && dateReceived) {
      status = "Received";
    }
  }

  const notes = hasNotes
    ? typeof edit.notes === "string" && edit.notes.trim() !== ""
      ? edit.notes
      : null
    : current.notes;

  return {
    ok: true,
    fields: { status, date_received: dateReceived, expiration_date: expirationDate, notes },
  };
}

export type DocumentPatch = { status?: string; date_received?: string | null; notes?: string };

/**
 * What the editor shows but the server hasn't stored yet, as a PATCH body; empty when everything is saved.
 * Blank form fields match null stored values, and whitespace-only notes match no notes (they're stored as null).
 */
export function unsavedChanges(
  saved: Pick<DocumentRow, "status" | "date_received" | "notes">,
  shown: { status: string; date_received: string; notes: string },
): DocumentPatch {
  const patch: DocumentPatch = {};
  if (shown.status !== saved.status) patch.status = shown.status;
  if (shown.date_received !== (saved.date_received ?? "")) patch.date_received = shown.date_received || null;
  const notesCleared = shown.notes.trim() === "" && saved.notes === null;
  if (shown.notes !== (saved.notes ?? "") && !notesCleared) patch.notes = shown.notes;
  return patch;
}
