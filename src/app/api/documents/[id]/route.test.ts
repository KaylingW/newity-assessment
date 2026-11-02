import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-route-"));
process.env.DB_PATH = path.join(dir, "tracker.db");

const { PATCH } = await import("./route");
const { getDb, getDocument } = await import("@/lib/db");
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
});
