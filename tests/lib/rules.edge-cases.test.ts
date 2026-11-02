import { describe, expect, it } from "vitest";
import {
  addDays,
  applyDocumentEdit,
  daysBetween,
  docState,
  filterApplications,
  formatDate,
  isIsoDate,
  outstandingGroups,
  parseUsDate,
  summarizeApplication,
  unsavedChanges,
} from "@/lib/rules";
import { AS_OF, app, doc } from "../helpers";

describe("date edge cases", () => {
  it("handles leap days", () => {
    expect(parseUsDate("2/29/2024")).toBe("2024-02-29");
    expect(() => parseUsDate("2/29/2025")).toThrow();
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 365)).toBe("2025-02-28");
  });

  it("trims whitespace and treats undefined or null as blank", () => {
    expect(parseUsDate("  1/5/2026 ")).toBe("2026-01-05");
    expect(parseUsDate("   ")).toBeNull();
    expect(parseUsDate(undefined)).toBeNull();
    expect(parseUsDate(null)).toBeNull();
  });

  it("rejects impossible months and days", () => {
    expect(() => parseUsDate("13/1/2026")).toThrow();
    expect(() => parseUsDate("0/10/2026")).toThrow();
    expect(() => parseUsDate("4/31/2026")).toThrow();
    expect(() => parseUsDate("1/5/26")).toThrow();
  });

  it("only accepts zero-padded YYYY-MM-DD strings as ISO dates", () => {
    expect(isIsoDate("2026-1-05")).toBe(false);
    expect(isIsoDate("2026-01-05T00:00:00Z")).toBe(false);
    expect(isIsoDate(20260105)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("does negative and year-crossing date math", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-02-15", "2026-02-01")).toBe(-14);
    expect(daysBetween(AS_OF, AS_OF)).toBe(0);
  });

  it("formats blank dates as empty and the ends of the year", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2025-12-31")).toBe("Dec 31, 2025");
  });
});

describe("document state edge cases", () => {
  it("treats a Not Required doc past its expiry as expired and outstanding", () => {
    const s = docState(doc({ status: "Not Required", expiration_date: "2026-01-01" }), AS_OF);
    expect(s.expired).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.effectiveStatus).toBe("Expired");
  });

  it("expires the day after the expiration date, not on it", () => {
    expect(docState(doc({ expiration_date: "2026-02-14" }), AS_OF).expired).toBe(true);
    expect(docState(doc({ expiration_date: "2026-02-15" }), AS_OF).expired).toBe(false);
  });

  it("never marks an expired doc as expiring soon", () => {
    const s = docState(doc({ status: "Expired", expiration_date: "2026-03-01" }), AS_OF);
    expect(s.expired).toBe(true);
    expect(s.expiringSoon).toBe(false);
  });
});

describe("application rollup edge cases", () => {
  it("summarizes an application with no documents as complete and not stalled", () => {
    const s = summarizeApplication(app, [], AS_OF);
    expect(s.totalDocs).toBe(0);
    expect(s.outstandingCount).toBe(0);
    expect(s.stalled).toBe(false);
    expect(s.nextExpiry).toBeNull();
    expect(s.lastActivity).toBe(app.application_date);
  });

  it("does not let an application dated after the as-of date go negative-stalled", () => {
    const s = summarizeApplication({ ...app, application_date: "2026-03-01" }, [doc()], AS_OF);
    expect(s.daysIdle).toBeLessThan(0);
    expect(s.stalled).toBe(false);
  });

  it("returns no outstanding groups when nothing needs chasing", () => {
    const docs = [doc({ status: "Approved", date_received: "2026-02-10" })];
    const s = summarizeApplication(app, docs, AS_OF);
    expect(outstandingGroups([s], new Map([[app.id, docs]]), "missing", AS_OF)).toEqual([]);
    expect(outstandingGroups([s], new Map(), "missing", AS_OF)).toEqual([]);
  });
});

describe("filters", () => {
  const mk = (id: string, application_date: string, business_name = "Biz") =>
    summarizeApplication({ ...app, id, application_date, business_name }, [], AS_OF);
  const apps = [mk("A", "2025-09-04"), mk("B", "2025-12-01"), mk("C", "2026-01-29")];
  const ids = (list: typeof apps) => list.map((a) => a.id);

  it("ignores whitespace-only search text", () => {
    expect(filterApplications(apps, { q: "   " })).toHaveLength(3);
  });

  it("searches business names without regex surprises", () => {
    const special = [mk("X", "2026-01-01", "A+B (Holdings) Inc.")];
    expect(filterApplications(special, { q: "(holdings)" })).toHaveLength(1);
    expect(filterApplications(special, { q: ".*" })).toHaveLength(0);
  });

  it("filters by application date, inclusive at both ends", () => {
    expect(ids(filterApplications(apps, { appliedFrom: "2025-12-01" }))).toEqual(["B", "C"]);
    expect(ids(filterApplications(apps, { appliedTo: "2025-12-01" }))).toEqual(["A", "B"]);
    expect(ids(filterApplications(apps, { appliedFrom: "2025-12-01", appliedTo: "2025-12-01" }))).toEqual(["B"]);
    expect(ids(filterApplications(apps, { appliedFrom: "2025-12-02", appliedTo: "2026-01-28" }))).toEqual([]);
  });

  it("combines the date filter with the other filters", () => {
    const withSearch = filterApplications([...apps, mk("D", "2026-01-15", "Metro Dental")], {
      q: "metro",
      appliedFrom: "2026-01-01",
    });
    expect(ids(withSearch)).toEqual(["D"]);
  });
});

describe("document edit edge cases", () => {
  it("accepts notes at the 2,000 character limit and rejects one more", () => {
    expect(applyDocumentEdit(doc(), { notes: "a".repeat(2000) }, AS_OF).ok).toBe(true);
    expect(applyDocumentEdit(doc(), { notes: "a".repeat(2001) }, AS_OF)).toEqual({
      ok: false,
      error: "Notes are too long (max 2000 characters).",
    });
  });

  it("keeps notes exactly as typed, including newlines, quotes and emoji", () => {
    const text = "Line 1\nLine 2 — \"quoted\" it's ✅";
    const r = applyDocumentEdit(doc(), { notes: text }, AS_OF);
    expect(r.ok && r.fields.notes).toBe(text);
  });

  it("clears notes with null, and keeps existing notes when notes aren't sent", () => {
    const withNotes = doc({ notes: "keep me" });
    const cleared = applyDocumentEdit(withNotes, { notes: null }, AS_OF);
    expect(cleared.ok && cleared.fields.notes).toBeNull();
    const statusOnly = applyDocumentEdit(withNotes, { status: "Received" }, AS_OF);
    expect(statusOnly.ok && statusOnly.fields.notes).toBe("keep me");
  });

  it("rejects non-string statuses and non-string received dates", () => {
    expect(applyDocumentEdit(doc(), { status: 1 }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { status: null }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { date_received: 20260201 }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { notes: ["x"] }, AS_OF).ok).toBe(false);
  });

  it("is case-sensitive about statuses", () => {
    expect(applyDocumentEdit(doc(), { status: "received" }, AS_OF).ok).toBe(false);
  });

  it("does not overwrite an existing received date when a status arrives", () => {
    const r = applyDocumentEdit(doc({ status: "Received", date_received: "2026-01-10" }), { status: "Approved" }, AS_OF);
    expect(r.ok && r.fields.date_received).toBe("2026-01-10");
  });

  it("does not auto-fill a received date when the status is resent unchanged", () => {
    const r = applyDocumentEdit(doc({ status: "Received" }), { status: "Received" }, AS_OF);
    expect(r.ok && r.fields.date_received).toBeNull();
  });

  it("keeps an explicit status sent with a new received date on an Expired doc", () => {
    const expired = doc({ document_type: "Bank Statements (90 day)", status: "Expired", date_received: "2025-10-01" });
    const r = applyDocumentEdit(expired, { status: "Under Review", date_received: "2026-02-01" }, AS_OF);
    expect(r.ok && r.fields.status).toBe("Under Review");
    expect(r.ok && r.fields.expiration_date).toBe("2026-05-02");
  });

  it("leaves an Expired doc Expired when its received date is cleared", () => {
    const expired = doc({ document_type: "Bank Statements (90 day)", status: "Expired", date_received: "2025-10-01", expiration_date: "2025-12-30" });
    const r = applyDocumentEdit(expired, { date_received: null }, AS_OF);
    expect(r.ok && r.fields.status).toBe("Expired");
    expect(r.ok && r.fields.expiration_date).toBeNull();
  });

  it("keeps a stored expiration date on non-expiring types when the received date changes", () => {
    const lease = doc({ document_type: "Lease Agreement", status: "Received", date_received: "2026-01-01", expiration_date: "2027-01-01" });
    const r = applyDocumentEdit(lease, { date_received: "2026-02-01" }, AS_OF);
    expect(r.ok && r.fields.expiration_date).toBe("2027-01-01");
  });
});

describe("unsaved changes", () => {
  const saved = doc({ status: "Received", date_received: "2026-02-01", notes: "Called" });
  const shown = { status: "Received", date_received: "2026-02-01", notes: "Called" };

  it("is empty when the form matches what's stored", () => {
    expect(unsavedChanges(saved, shown)).toEqual({});
    expect(unsavedChanges(doc(), { status: "Pending", date_received: "", notes: "" })).toEqual({});
  });

  it("lists only the fields that differ", () => {
    expect(unsavedChanges(saved, { ...shown, notes: "Called twice" })).toEqual({ notes: "Called twice" });
    expect(unsavedChanges(saved, { ...shown, status: "Approved", date_received: "" })).toEqual({
      status: "Approved",
      date_received: null,
    });
  });

  it("treats whitespace-only notes as matching no notes, but not as matching real notes", () => {
    expect(unsavedChanges(doc(), { status: "Pending", date_received: "", notes: "  \n" })).toEqual({});
    expect(unsavedChanges(saved, { ...shown, notes: "  " })).toEqual({ notes: "  " });
    expect(unsavedChanges(saved, { ...shown, notes: "" })).toEqual({ notes: "" });
  });
});
