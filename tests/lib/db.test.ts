import { describe, expect, it } from "vitest";
import {
  DEFAULT_CSV_PATH,
  getDocument,
  listDocuments,
  listDocumentsByApplication,
  seedIfEmpty,
  updateDocument,
  type DB,
} from "@/lib/db";
import { count, open, tempDbPath } from "../helpers";

function seeded(): { db: DB; path: string } {
  const path = tempDbPath();
  const db = open(path);
  seedIfEmpty(db, DEFAULT_CSV_PATH);
  return { db, path };
}

const firstPendingId = (db: DB) =>
  (db.prepare("SELECT id FROM documents WHERE status = 'Pending' ORDER BY id LIMIT 1").get() as { id: number }).id;

describe("saving documents", () => {
  it("returns the saved row and changes nothing else", () => {
    const { db } = seeded();
    const id = firstPendingId(db);
    const others = db.prepare("SELECT * FROM documents WHERE id != ? ORDER BY id").all(id);
    const fields = { status: "Received", date_received: "2026-02-10", expiration_date: null, notes: "Arrived by email" };
    expect(updateDocument(db, id, fields)).toMatchObject({ id, ...fields });
    expect(db.prepare("SELECT * FROM documents WHERE id != ? ORDER BY id").all(id)).toEqual(others);
  });

  it("is visible to another connection straight away", () => {
    const { db, path } = seeded();
    const id = firstPendingId(db);
    updateDocument(db, id, { status: "Approved", date_received: "2026-02-01", expiration_date: null, notes: "ok" });
    const reader = open(path);
    expect(getDocument(reader, id)).toMatchObject({ status: "Approved", date_received: "2026-02-01", notes: "ok" });
  });

  it("survives closing and reopening the database", () => {
    const { db, path } = seeded();
    const id = firstPendingId(db);
    updateDocument(db, id, { status: "Under Review", date_received: "2026-02-14", expiration_date: "2026-05-15", notes: "Reviewing" });
    db.close();
    const reopened = open(path);
    expect(seedIfEmpty(reopened, DEFAULT_CSV_PATH)).toBe(false);
    expect(getDocument(reopened, id)).toMatchObject({
      status: "Under Review",
      date_received: "2026-02-14",
      expiration_date: "2026-05-15",
      notes: "Reviewing",
    });
  });

  it("keeps the last of several saves to the same row", () => {
    const { db, path } = seeded();
    const id = firstPendingId(db);
    for (const notes of ["first", "second", "third"]) {
      updateDocument(db, id, { status: "Pending", date_received: null, expiration_date: null, notes });
    }
    db.close();
    expect(getDocument(open(path), id)!.notes).toBe("third");
  });

  it("returns undefined and writes nothing for a missing document", () => {
    const { db } = seeded();
    const before = count(db, "documents");
    expect(updateDocument(db, 999_999, { status: "Approved", date_received: null, expiration_date: null, notes: null })).toBeUndefined();
    expect(count(db, "documents")).toBe(before);
  });
});

describe("saving notes", () => {
  it.each([
    ["multi-line text", "Line one\nLine two\r\nLine three"],
    ["quotes and apostrophes", `Borrower said "next week" — it's late`],
    ["SQL-looking text", "'); DROP TABLE documents; --"],
    ["emoji and accents", "Café owner ✅ 📄"],
    ["leading and trailing spaces", "  padded  "],
    ["the full 2,000 characters", "n".repeat(2000)],
  ])("stores %s exactly and reads it back after a reopen", (_label, notes) => {
    const { db, path } = seeded();
    const id = firstPendingId(db);
    updateDocument(db, id, { status: "Pending", date_received: null, expiration_date: null, notes });
    db.close();
    const reopened = open(path);
    expect(getDocument(reopened, id)!.notes).toBe(notes);
    expect(count(reopened, "documents")).toBe(620);
  });

  it("clears notes when saved as null", () => {
    const { db, path } = seeded();
    const id = firstPendingId(db);
    updateDocument(db, id, { status: "Pending", date_received: null, expiration_date: null, notes: "temp" });
    updateDocument(db, id, { status: "Pending", date_received: null, expiration_date: null, notes: null });
    db.close();
    expect(getDocument(open(path), id)!.notes).toBeNull();
  });

  it("shows saved notes in the per-application and grouped listings", () => {
    const { db } = seeded();
    const id = firstPendingId(db);
    const { application_id } = getDocument(db, id)!;
    updateDocument(db, id, { status: "Pending", date_received: null, expiration_date: null, notes: "listed" });
    expect(listDocuments(db, application_id).find((d) => d.id === id)!.notes).toBe("listed");
    expect(listDocumentsByApplication(db).get(application_id)!.find((d) => d.id === id)!.notes).toBe("listed");
  });
});

describe("schema", () => {
  it("rejects a document for an application that doesn't exist", () => {
    const { db } = seeded();
    expect(() =>
      db.prepare("INSERT INTO documents (application_id, document_type, status) VALUES ('NOPE', 'Lease', 'Pending')").run(),
    ).toThrow();
  });

  it("rejects a second copy of the same document type on one application", () => {
    const { db } = seeded();
    const d = db.prepare("SELECT application_id, document_type FROM documents LIMIT 1").get() as {
      application_id: string;
      document_type: string;
    };
    expect(() =>
      db.prepare("INSERT INTO documents (application_id, document_type, status) VALUES (?, ?, 'Pending')").run(
        d.application_id,
        d.document_type,
      ),
    ).toThrow();
  });

  it("syncs every commit to disk", () => {
    const { db } = seeded();
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("synchronous", { simple: true })).toBe(2); // FULL
  });
});
