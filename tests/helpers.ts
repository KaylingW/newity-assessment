// Shared fixtures for the test suite: sample rows and throwaway SQLite databases.

import { afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "@/lib/db";
import type { Application, DocumentRow } from "@/lib/rules";

export const AS_OF = "2026-02-15";

export const app: Application = {
  id: "APP-1",
  business_name: "Test Co",
  borrower_name: "Pat Doe",
  loan_amount: 100000,
  application_date: "2025-12-01",
  assigned_processor: "Aisha Patel",
};

export function doc(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 1,
    application_id: "APP-1",
    document_type: "SBA Form 1919",
    status: "Pending",
    date_received: null,
    expiration_date: null,
    notes: null,
    ...over,
  };
}

// Temp directories and connections made by a test are cleaned up after it.
const tmpDirs: string[] = [];
const opened: DB[] = [];

afterEach(() => {
  opened.splice(0).forEach((db) => db.open && db.close());
  tmpDirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

export function tempDir(prefix = "tracker-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

export function tempDbPath(): string {
  return path.join(tempDir(), "tracker.db");
}

/** Opens a database that is closed automatically after the test. */
export function open(dbPath: string): DB {
  const db = openDb(dbPath);
  opened.push(db);
  return db;
}

export const count = (db: DB, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
