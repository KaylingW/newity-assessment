import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CSV_PATH, listApplicationSummaries, openDb, seedIfEmpty, type DB } from "./db";
import { docState } from "./rules";

const tmpDirs: string[] = [];
const opened: DB[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-test-"));
  tmpDirs.push(dir);
  return path.join(dir, "tracker.db");
}

function open(p: string): DB {
  const db = openDb(p);
  opened.push(db);
  return db;
}

const count = (db: DB, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

afterEach(() => {
  opened.splice(0).forEach((db) => db.close());
  tmpDirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

describe("seed", () => {
  it("loads 60 applications and 620 documents, and a second run adds nothing", () => {
    const p = tempDbPath();
    const db = open(p);
    expect(seedIfEmpty(db, DEFAULT_CSV_PATH)).toBe(true);
    expect(count(db, "applications")).toBe(60);
    expect(count(db, "documents")).toBe(620);
    expect(seedIfEmpty(db, DEFAULT_CSV_PATH)).toBe(false);

    // Simulate a restart: reopen the same file, keep an edit.
    db.prepare("UPDATE documents SET notes = 'edited' WHERE id = 1").run();
    db.close();
    opened.length = 0;
    const db2 = open(p);
    expect(seedIfEmpty(db2, DEFAULT_CSV_PATH)).toBe(false);
    expect(count(db2, "applications")).toBe(60);
    expect(count(db2, "documents")).toBe(620);
    expect((db2.prepare("SELECT notes FROM documents WHERE id = 1").get() as { notes: string }).notes).toBe("edited");
  });

  it("stores dates as ISO and matches the data profile", () => {
    const db = open(tempDbPath());
    seedIfEmpty(db, DEFAULT_CSV_PATH);
    const docs = db.prepare("SELECT * FROM documents").all() as {
      status: string; date_received: string | null; expiration_date: string | null;
    }[];
    for (const d of docs) {
      for (const v of [d.date_received, d.expiration_date]) {
        if (v !== null) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    expect(docs.filter((d) => d.date_received === null).length).toBe(209);
    expect(docs.filter((d) => d.status === "Expired" && d.expiration_date === null).length).toBe(27);
    const derived = docs.filter((d) => d.status !== "Expired" && docState(d, "2026-02-15").expired);
    expect(derived.length).toBe(4);
    const all = listApplicationSummaries(db, undefined, "2026-02-15");
    const flagged = (a: (typeof all)[number]) => a.stalled || a.expiredCount > 0 || a.expiringSoonCount > 0;
    const firstClean = all.findIndex((a) => !flagged(a));
    expect(firstClean === -1 || all.slice(firstClean).every((a) => !flagged(a))).toBe(true);
    const aisha = listApplicationSummaries(db, "Aisha Patel", "2026-02-15");
    expect(aisha.length).toBe(18);
    expect(aisha.every((a) => a.assigned_processor === "Aisha Patel")).toBe(true);
  });

  it("leaves the database empty when the CSV is bad", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-csv-"));
    tmpDirs.push(dir);
    const csv = path.join(dir, "bad.csv");
    const good = fs.readFileSync(DEFAULT_CSV_PATH, "utf8").split("\n").slice(0, 5);
    fs.writeFileSync(csv, [...good, "APP-X,Biz,Bob,1000,13/45/2025,Aisha Patel,Lease Agreement,Pending,,,"].join("\n"));
    const db = open(tempDbPath());
    expect(() => seedIfEmpty(db, csv)).toThrow();
    expect(count(db, "applications")).toBe(0);
    expect(count(db, "documents")).toBe(0);
  });
});
