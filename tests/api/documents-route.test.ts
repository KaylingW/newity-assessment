import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-route-"));
process.env.DB_PATH = path.join(dir, "tracker.db");

const { PATCH } = await import("@/app/api/documents/[id]/route");
const { getDb, getDocument, openDb } = await import("@/lib/db");
const { AS_OF_DATE } = await import("@/lib/config");
const { addDays } = await import("@/lib/rules");

function patch(id: number | string, body: unknown) {
  const req = new Request(`http://localhost/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: String(id) }) });
}

/** Reads a document through a fresh connection, to prove the change reached the database file. */
function readFromDisk(id: number) {
  const db = openDb(process.env.DB_PATH);
  try {
    return getDocument(db, id);
  } finally {
    db.close();
  }
}

function pendingDocId(offset: number): number {
  return (
    getDb()
      .prepare("SELECT id FROM documents WHERE status = 'Pending' AND date_received IS NULL ORDER BY id LIMIT 1 OFFSET ?")
      .get(offset) as { id: number }
  ).id;
}

let docId: number;

beforeAll(() => {
  const row = getDb()
    .prepare("SELECT id FROM documents WHERE status = 'Pending' AND date_received IS NULL LIMIT 1")
    .get() as { id: number };
  docId = row.id;
});

afterAll(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("PATCH /api/documents/[id]", () => {
  it.each([
    [{ status: "Done" }],
    [{ date_received: "2/1/2026" }],
    ["not json"],
    [[]],
    [null],
  ])("rejects a bad edit %j with a 400 and a plain message, leaving the row unchanged", async (body) => {
    const before = getDocument(getDb(), docId);
    const res = await patch(docId, body);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
    expect(getDocument(getDb(), docId)).toEqual(before);
  });

  it("returns 404 for an unknown document", async () => {
    expect((await patch(999999, { status: "Received" })).status).toBe(404);
    expect((await patch("abc", { status: "Received" })).status).toBe(404);
    expect((await patch("1e1", { notes: "x" })).status).toBe(404);
    expect((await patch("0x5", { notes: "x" })).status).toBe(404);
    expect((await patch("-1", { notes: "x" })).status).toBe(404);
    expect((await patch("01", { notes: "x" })).status).toBe(404);
    expect((await patch("1.5", { notes: "x" })).status).toBe(404);
    expect((await patch("99999999999999999999", { notes: "x" })).status).toBe(404);
  });

  it("saves a valid edit", async () => {
    const res = await patch(docId, { status: "Received" });
    expect(res.status).toBe(200);
    const saved = getDocument(getDb(), docId)!;
    expect(saved.status).toBe("Received");
    expect(saved.date_received).toBe(AS_OF_DATE);
  });

  it("persists notes", async () => {
    expect((await patch(docId, { notes: "x" })).status).toBe(200);
    expect(getDocument(getDb(), docId)!.notes).toBe("x");
  });

  it("persists a replacement bank statement as Received with a recalculated expiration", async () => {
    const { id } = getDb()
      .prepare("SELECT id FROM documents WHERE status = 'Expired' AND document_type = 'Bank Statements (90 day)' LIMIT 1")
      .get() as { id: number };
    const received = addDays(AS_OF_DATE, -5);
    expect((await patch(id, { date_received: received })).status).toBe(200);
    const saved = getDocument(getDb(), id)!;
    expect(saved.status).toBe("Received");
    expect(saved.date_received).toBe(received);
    expect(saved.expiration_date).toBe(addDays(received, 90));
  });

  it.each([
    [{}],
    [{ unrelated: "field" }],
    [{ notes: "a".repeat(2001) }],
    [{ notes: 5 }],
    [{ date_received: "2999-01-01" }],
    [{ status: "Received", date_received: "nope" }],
  ])("rejects %j without saving any part of it", async (body) => {
    const id = pendingDocId(10);
    const before = readFromDisk(id);
    expect((await patch(id, body)).status).toBe(400);
    expect(readFromDisk(id)).toEqual(before);
  });
});

describe("PATCH /api/documents/[id] saves to the database", () => {
  it("writes status changes to disk", async () => {
    const id = pendingDocId(1);
    expect((await patch(id, { status: "Under Review" })).status).toBe(200);
    expect(readFromDisk(id)).toMatchObject({ status: "Under Review", date_received: AS_OF_DATE });
  });

  it("returns the same row it saved", async () => {
    const id = pendingDocId(2);
    const res = await patch(id, { status: "Approved", notes: "Signed" });
    const { document } = await res.json();
    expect(document).toEqual(readFromDisk(id));
  });

  it("saves status, received date and notes sent together", async () => {
    const id = pendingDocId(3);
    const received = addDays(AS_OF_DATE, -3);
    expect((await patch(id, { status: "Approved", date_received: received, notes: "All three" })).status).toBe(200);
    expect(readFromDisk(id)).toMatchObject({ status: "Approved", date_received: received, notes: "All three" });
  });

  it("keeps every field when separate fields are saved at the same time", async () => {
    const id = pendingDocId(4);
    const received = addDays(AS_OF_DATE, -1);
    const results = await Promise.all([
      patch(id, { notes: "From the notes box" }),
      patch(id, { date_received: received }),
      patch(id, { status: "Under Review" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(readFromDisk(id)).toMatchObject({ notes: "From the notes box", date_received: received, status: "Under Review" });
  });

  it("clears a received date and its expiration", async () => {
    const { id } = getDb()
      .prepare("SELECT id FROM documents WHERE document_type = 'Bank Statements (90 day)' AND date_received IS NOT NULL LIMIT 1")
      .get() as { id: number };
    expect((await patch(id, { date_received: null })).status).toBe(200);
    expect(readFromDisk(id)).toMatchObject({ date_received: null, expiration_date: null });
  });
});

describe("PATCH /api/documents/[id] saves notes", () => {
  it.each([
    ["multi-line text", "Called borrower.\nLeft voicemail."],
    ["quotes and SQL-looking text", `He said "'); DROP TABLE documents; --"`],
    ["emoji and accents", "Café ✅ 📄"],
    ["the full 2,000 characters", "n".repeat(2000)],
  ])("stores %s exactly", async (_label, notes) => {
    const id = pendingDocId(5);
    expect((await patch(id, { notes })).status).toBe(200);
    expect(readFromDisk(id)!.notes).toBe(notes);
  });

  it("saving notes changes nothing else on the row", async () => {
    const id = pendingDocId(6);
    const before = readFromDisk(id)!;
    expect((await patch(id, { notes: "Only notes" })).status).toBe(200);
    expect(readFromDisk(id)).toEqual({ ...before, notes: "Only notes" });
  });

  it("keeps existing notes when another field is saved", async () => {
    const id = pendingDocId(7);
    await patch(id, { notes: "Keep me" });
    expect((await patch(id, { status: "Received" })).status).toBe(200);
    expect(readFromDisk(id)!.notes).toBe("Keep me");
  });

  it.each([[""], ["   "], [null]])("clears notes when sent %j", async (blank) => {
    const id = pendingDocId(8);
    await patch(id, { notes: "To be cleared" });
    expect((await patch(id, { notes: blank })).status).toBe(200);
    expect(readFromDisk(id)!.notes).toBeNull();
  });

  it("keeps the latest of several notes edits in a row", async () => {
    const id = pendingDocId(9);
    for (const notes of ["draft 1", "draft 2", "final"]) {
      expect((await patch(id, { notes })).status).toBe(200);
    }
    expect(readFromDisk(id)!.notes).toBe("final");
  });
});
