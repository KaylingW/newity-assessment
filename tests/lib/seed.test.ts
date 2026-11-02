import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CSV_PATH,
  listApplicationSummaries,
  seedIfEmpty,
  validateCsvRows,
  type CsvRow,
} from "@/lib/db";
import { docState } from "@/lib/rules";
import { AS_OF, count, open, tempDbPath, tempDir } from "../helpers";

const MALFORMED_CSV_PATH = path.join(path.dirname(DEFAULT_CSV_PATH), "NEWITY_Sample_Data_Malformed.csv");

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
    const csv = path.join(tempDir("tracker-csv-"), "bad.csv");
    const good = fs.readFileSync(DEFAULT_CSV_PATH, "utf8").split("\n").slice(0, 5);
    fs.writeFileSync(csv, [...good, "APP-X,Biz,Bob,1000,13/45/2025,Aisha Patel,Lease Agreement,Pending,,,"].join("\n"));
    const db = open(tempDbPath());
    expect(() => seedIfEmpty(db, csv)).toThrow();
    expect(count(db, "applications")).toBe(0);
    expect(count(db, "documents")).toBe(0);
  });

  it("rejects the malformed sample file, reporting every problem with its line", () => {
    const db = open(tempDbPath());
    let message = "";
    try {
      seedIfEmpty(db, MALFORMED_CSV_PATH);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const expected of [
      'line 2: loan_amount is wrapped in curly quotes (“390000”)',
      "line 2: application_date: Unrecognized date \"12/1/20\"",
      'line 2: unknown document_status "Terstsfhdgk"',
      "line 2: date_received is wrapped in curly quotes",
      "line 3: borrower_name is wrapped in curly quotes",
      'line 4: loan_amount "3adfnv" is not a positive whole number',
      'line 4: assigned_processor "{}" is not a name',
      "line 6: application_date 9999-12-01 is after today",
      'line 6: unknown document_type "Personal Tax Returns"',
      'line 6: unknown document_status "Undefined"',
      'line 6: date_received: Unrecognized date "{NA}"',
    ]) {
      expect(message).toContain(expected);
    }
    expect(message).toContain("nothing was loaded");
    expect(count(db, "applications")).toBe(0);
    expect(count(db, "documents")).toBe(0);
  });
});

describe("validateCsvRows", () => {
  const good: CsvRow = {
    application_id: "APP-1",
    business_name: "Biz",
    borrower_name: "Bob",
    loan_amount: "390000",
    application_date: "12/1/2025",
    assigned_processor: "Aisha Patel",
    document_type: "Lease Agreement",
    document_status: "Pending",
    date_received: "",
    expiration_date: "",
    notes: "",
  };
  const check = (...rows: Partial<CsvRow>[]) =>
    validateCsvRows(rows.map((r, i) => ({ record: { ...good, ...r }, line: i + 2 })), AS_OF).errors;

  it("accepts a valid row and converts it", () => {
    const { rows, errors } = validateCsvRows(
      [{ record: { ...good, date_received: "1/2/2026", notes: "hi" }, line: 2 }],
      AS_OF,
    );
    expect(errors).toEqual([]);
    expect(rows[0].app.loan_amount).toBe(390000);
    expect(rows[0].app.application_date).toBe("2025-12-01");
    expect(rows[0].doc.date_received).toBe("2026-01-02");
    expect(rows[0].doc.notes).toBe("hi");
  });

  it.each([
    [{ business_name: "" }, "business_name is blank"],
    [{ assigned_processor: "" }, "assigned_processor is blank"],
    [{ document_type: "" }, "document_type is blank"],
    [{ document_status: "" }, "document_status is blank"],
    [{ loan_amount: "" }, "loan_amount is blank"],
    [{ loan_amount: "0" }, 'loan_amount "0" is not a positive whole number'],
    [{ loan_amount: "-5" }, 'loan_amount "-5" is not a positive whole number'],
    [{ loan_amount: "390000.55" }, 'loan_amount "390000.55" is not a positive whole number'],
    [{ date_received: "2/16/2026" }, "date_received 2026-02-16 is after today"],
    [{ date_received: "1/10/2026", expiration_date: "1/9/2026" }, "expiration_date 2026-01-09 is before date_received"],
  ] as [Partial<CsvRow>, string][])("rejects %o", (row, expected) => {
    expect(check(row).join("\n")).toContain(`line 2: ${expected}`);
  });

  it("rejects rows that disagree about the same application", () => {
    expect(check({}, { document_type: "Debt Schedule", assigned_processor: "Janet Morrison" })).toEqual([
      'line 3: assigned_processor "Janet Morrison" differs from "Aisha Patel" on line 2 for APP-1',
    ]);
  });

  it("rejects a document listed twice for one application", () => {
    expect(check({}, {})).toEqual(["line 3: duplicate Lease Agreement for APP-1 (first on line 2)"]);
  });
});
