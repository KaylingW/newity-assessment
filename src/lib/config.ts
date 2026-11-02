// Single source of truth for every date rule in the app.
// Change the as-of date with the AS_OF_DATE environment variable (YYYY-MM-DD).

const DEFAULT_AS_OF_DATE = "2026-02-15";

function readAsOfDate(): string {
  const raw = process.env.AS_OF_DATE?.trim();
  if (!raw) return DEFAULT_AS_OF_DATE;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (d.toISOString().slice(0, 10) === raw) return raw;
  }
  console.warn(`Ignoring invalid AS_OF_DATE "${raw}"; using ${DEFAULT_AS_OF_DATE}.`);
  return DEFAULT_AS_OF_DATE;
}

/** "Today" for every expiry and stall check, as ISO YYYY-MM-DD. */
export const AS_OF_DATE: string = readAsOfDate();

/** An application with outstanding documents is stalled after this many days without a document received. */
export const STALL_DAYS = 14;

/** A document is "expiring soon" when it expires within this many days of the as-of date. */
export const EXPIRING_SOON_DAYS = 30;

/** Days from received date to expiration date, by document type. Types not listed never expire. */
export const EXPIRY_RULES: Readonly<Record<string, number>> = {
  "Personal Tax Returns (3yr)": 1095,
  "Business Tax Returns (3yr)": 1095,
  "Bank Statements (90 day)": 90,
  "Insurance Verification": 365,
};

export const DOCUMENT_STATUSES = [
  "Pending",
  "Received",
  "Under Review",
  "Approved",
  "Expired",
  "Not Required",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Statuses that count as done. Everything else is outstanding. */
export const COMPLETE_STATUSES: readonly DocumentStatus[] = ["Approved", "Not Required"];

/** Statuses that mean the document has arrived; setting one auto-fills a blank received date. */
export const ARRIVED_STATUSES: readonly DocumentStatus[] = ["Received", "Under Review", "Approved"];
