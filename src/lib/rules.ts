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
  outstandingCount: number;
  expiredCount: number;
  expiringSoonCount: number;
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
  let latestReceived: string | null = null;
  for (const doc of docs) {
    const state = docState(doc, asOf);
    if (state.outstanding) outstandingCount++;
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
    outstandingCount,
    expiredCount,
    expiringSoonCount,
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
