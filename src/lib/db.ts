// SQLite storage: schema, one-time seed from the bundled CSV, and query/update helpers.

import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { AS_OF_DATE, DOCUMENT_STATUSES, DOCUMENT_TYPES } from "./config";
import {
  compareWorklist,
  isKnownStatus,
  parseUsDate,
  summarizeApplication,
  type Application,
  type ApplicationSummary,
  type DocumentRow,
} from "./rules";

export type DB = Database.Database;

export const DEFAULT_DB_PATH = path.join(process.cwd(), ".data", "tracker.db");
export const DEFAULT_CSV_PATH = path.join(
  process.cwd(),
  "data",
  "NEWITY_Sample_Data_A_Document_Checklist.csv",
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applications (
  id                 TEXT PRIMARY KEY,
  business_name      TEXT NOT NULL,
  borrower_name      TEXT NOT NULL,
  loan_amount        INTEGER NOT NULL,
  application_date   TEXT NOT NULL,
  assigned_processor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  TEXT NOT NULL REFERENCES applications(id),
  document_type   TEXT NOT NULL,
  status          TEXT NOT NULL,
  date_received   TEXT,
  expiration_date TEXT,
  notes           TEXT,
  UNIQUE (application_id, document_type)
);
CREATE INDEX IF NOT EXISTS documents_by_application ON documents(application_id);
`;

export function openDb(dbPath: string = DEFAULT_DB_PATH): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // Sync every commit to disk, so a saved edit survives a crash or power loss.
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export interface CsvRow {
  application_id: string;
  business_name: string;
  borrower_name: string;
  loan_amount: string;
  application_date: string;
  assigned_processor: string;
  document_type: string;
  document_status: string;
  date_received: string;
  expiration_date: string;
  notes: string;
}

type SeedApplication = Omit<Application, "id">;

interface SeedRow {
  line: number;
  applicationId: string;
  app: SeedApplication;
  doc: Pick<DocumentRow, "document_type" | "status" | "date_received" | "expiration_date" | "notes">;
}

const REQUIRED_FIELDS = [
  "application_id",
  "business_name",
  "borrower_name",
  "loan_amount",
  "application_date",
  "assigned_processor",
  "document_type",
  "document_status",
] as const;

/**
 * Checks every CSV row and converts it to database values. Collects every problem
 * (with its line number) instead of stopping at the first, so one run reports them all.
 */
export function validateCsvRows(
  records: { record: CsvRow; line: number }[],
  asOf: string = AS_OF_DATE,
): { rows: SeedRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: SeedRow[] = [];
  const firstSeen = new Map<string, { line: number; app: SeedApplication }>();
  const docLines = new Map<string, number>();

  for (const { record: r, line } of records) {
    const problems: string[] = [];
    const problem = (msg: string) => problems.push(`line ${line}: ${msg}`);

    for (const field of Object.keys(r) as (keyof CsvRow)[]) {
      if (/^[“”].*[“”]$/.test(r[field] ?? "")) problem(`${field} is wrapped in curly quotes (${r[field]})`);
    }
    for (const field of REQUIRED_FIELDS) {
      if (!r[field]) problem(`${field} is blank`);
    }

    if (r.loan_amount && !(/^\d+$/.test(r.loan_amount) && Number(r.loan_amount) > 0)) {
      problem(`loan_amount "${r.loan_amount}" is not a positive whole number`);
    }
    if (r.assigned_processor && !/[A-Za-z]/.test(r.assigned_processor)) {
      problem(`assigned_processor "${r.assigned_processor}" is not a name`);
    }
    if (r.document_type && !(DOCUMENT_TYPES as readonly string[]).includes(r.document_type)) {
      problem(`unknown document_type "${r.document_type}"`);
    }
    if (r.document_status && !isKnownStatus(r.document_status)) {
      problem(`unknown document_status "${r.document_status}" (expected one of: ${DOCUMENT_STATUSES.join(", ")})`);
    }

    const date = (field: "application_date" | "date_received" | "expiration_date") => {
      try {
        return parseUsDate(r[field]);
      } catch (e) {
        problem(`${field}: ${(e as Error).message}`);
        return null;
      }
    };
    const appDate = date("application_date");
    const received = date("date_received");
    const expires = date("expiration_date");
    if (appDate && appDate > asOf) problem(`application_date ${appDate} is after today (${asOf})`);
    if (received && received > asOf) problem(`date_received ${received} is after today (${asOf})`);
    if (received && expires && expires < received) {
      problem(`expiration_date ${expires} is before date_received ${received}`);
    }

    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }

    const app: SeedApplication = {
      business_name: r.business_name,
      borrower_name: r.borrower_name,
      loan_amount: Number(r.loan_amount),
      application_date: appDate!,
      assigned_processor: r.assigned_processor,
    };
    // Every row repeats its application's details; they must agree, or one would be silently dropped.
    const seen = firstSeen.get(r.application_id);
    if (!seen) {
      firstSeen.set(r.application_id, { line, app });
    } else {
      for (const key of Object.keys(app) as (keyof SeedApplication)[]) {
        if (app[key] !== seen.app[key]) {
          errors.push(
            `line ${line}: ${key} "${app[key]}" differs from "${seen.app[key]}" on line ${seen.line} for ${r.application_id}`,
          );
        }
      }
    }
    const docKey = `${r.application_id}\u0000${r.document_type}`;
    const dupLine = docLines.get(docKey);
    if (dupLine !== undefined) {
      errors.push(`line ${line}: duplicate ${r.document_type} for ${r.application_id} (first on line ${dupLine})`);
    } else {
      docLines.set(docKey, line);
    }

    rows.push({
      line,
      applicationId: r.application_id,
      app,
      doc: {
        document_type: r.document_type,
        status: r.document_status,
        date_received: received,
        expiration_date: expires,
        notes: r.notes === "" ? null : r.notes,
      },
    });
  }
  return { rows, errors };
}

/**
 * Loads the CSV when the database has no applications yet. Every row is validated first;
 * any problem throws one error listing them all, and nothing is written. Returns true if it seeded.
 */
export function seedIfEmpty(
  db: DB,
  csvPath: string = DEFAULT_CSV_PATH,
  asOf: string = AS_OF_DATE,
): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM applications").get() as { n: number };
  if (n > 0) return false;

  // Read from the project folder at runtime; tell Turbopack not to trace (and bundle) the whole project for it.
  const parsed = parse(fs.readFileSync(/*turbopackIgnore: true*/ csvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    info: true,
  }) as { record: CsvRow; info: { lines: number } }[];

  const { rows, errors } = validateCsvRows(
    parsed.map((p) => ({ record: p.record, line: p.info.lines })),
    asOf,
  );
  if (errors.length > 0) {
    throw new Error(
      `${csvPath} has ${errors.length} problem${errors.length === 1 ? "" : "s"}; nothing was loaded:\n  ${errors.join("\n  ")}`,
    );
  }

  const insertApp = db.prepare(
    `INSERT OR IGNORE INTO applications
       (id, business_name, borrower_name, loan_amount, application_date, assigned_processor)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertDoc = db.prepare(
    `INSERT OR IGNORE INTO documents
       (application_id, document_type, status, date_received, expiration_date, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const { applicationId, app, doc } of rows) {
      insertApp.run(
        applicationId,
        app.business_name,
        app.borrower_name,
        app.loan_amount,
        app.application_date,
        app.assigned_processor,
      );
      insertDoc.run(
        applicationId,
        doc.document_type,
        doc.status,
        doc.date_received,
        doc.expiration_date,
        doc.notes,
      );
    }
  })();
  return true;
}

// One connection per server process; cached on globalThis so dev hot-reload doesn't reopen it.
const globalForDb = globalThis as unknown as { __trackerDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__trackerDb) {
    const db = openDb(process.env.DB_PATH || DEFAULT_DB_PATH);
    seedIfEmpty(db);
    globalForDb.__trackerDb = db;
  }
  return globalForDb.__trackerDb;
}

// ---------- Queries ----------

export function listProcessors(db: DB): string[] {
  return (
    db
      .prepare("SELECT DISTINCT assigned_processor AS p FROM applications ORDER BY p")
      .all() as { p: string }[]
  ).map((r) => r.p);
}

/** All applications (optionally one processor's), with flags computed as of AS_OF_DATE, in worklist order. */
export function listApplicationSummaries(
  db: DB,
  processor?: string,
  asOf: string = AS_OF_DATE,
): ApplicationSummary[] {
  const apps = (
    processor
      ? db.prepare("SELECT * FROM applications WHERE assigned_processor = ?").all(processor)
      : db.prepare("SELECT * FROM applications").all()
  ) as Application[];
  const docs = db
    .prepare("SELECT application_id, status, date_received, expiration_date FROM documents")
    .all() as Pick<DocumentRow, "application_id" | "status" | "date_received" | "expiration_date">[];
  const byApp = new Map<string, typeof docs>();
  for (const d of docs) {
    const list = byApp.get(d.application_id) ?? [];
    list.push(d);
    byApp.set(d.application_id, list);
  }
  return apps
    .map((a) => summarizeApplication(a, byApp.get(a.id) ?? [], asOf))
    .sort(compareWorklist);
}

export function getApplication(db: DB, id: string): Application | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Application | undefined;
}

export function listDocuments(db: DB, applicationId: string): DocumentRow[] {
  return db
    .prepare("SELECT * FROM documents WHERE application_id = ? ORDER BY document_type")
    .all(applicationId) as DocumentRow[];
}

/** Every document, grouped by application id. */
export function listDocumentsByApplication(db: DB): Map<string, DocumentRow[]> {
  const byApp = new Map<string, DocumentRow[]>();
  for (const d of db.prepare("SELECT * FROM documents ORDER BY document_type").all() as DocumentRow[]) {
    const list = byApp.get(d.application_id) ?? [];
    list.push(d);
    byApp.set(d.application_id, list);
  }
  return byApp;
}

export function getDocument(db: DB, id: number): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
}

export function updateDocument(
  db: DB,
  id: number,
  fields: Pick<DocumentRow, "status" | "date_received" | "expiration_date" | "notes">,
): DocumentRow | undefined {
  db.prepare(
    `UPDATE documents
        SET status = @status, date_received = @date_received,
            expiration_date = @expiration_date, notes = @notes
      WHERE id = @id`,
  ).run({ ...fields, id });
  return getDocument(db, id);
}
