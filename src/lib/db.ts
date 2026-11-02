// SQLite storage: schema, one-time seed from the bundled CSV, and query/update helpers.

import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { AS_OF_DATE } from "./config";
import {
  compareWorklist,
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
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

interface CsvRow {
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

/**
 * Loads the CSV when the database has no applications yet. Runs in one transaction,
 * so a failure leaves the database empty. Returns true if it seeded.
 */
export function seedIfEmpty(db: DB, csvPath: string = DEFAULT_CSV_PATH): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM applications").get() as { n: number };
  if (n > 0) return false;

  // Read from the project folder at runtime; tell Turbopack not to trace (and bundle) the whole project for it.
  const rows = parse(fs.readFileSync(/*turbopackIgnore: true*/ csvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvRow[];

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
    rows.forEach((r, i) => {
      const line = i + 2;
      const loanAmount = Number(r.loan_amount);
      const appDate = parseUsDate(r.application_date);
      if (!r.application_id || !Number.isFinite(loanAmount) || !appDate) {
        throw new Error(`CSV line ${line}: missing application id, loan amount or application date`);
      }
      insertApp.run(
        r.application_id,
        r.business_name,
        r.borrower_name,
        loanAmount,
        appDate,
        r.assigned_processor,
      );
      insertDoc.run(
        r.application_id,
        r.document_type,
        r.document_status,
        parseUsDate(r.date_received),
        parseUsDate(r.expiration_date),
        r.notes === "" ? null : r.notes,
      );
    });
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
