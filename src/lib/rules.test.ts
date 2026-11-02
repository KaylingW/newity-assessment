import { describe, expect, it } from "vitest";
import {
  addDays,
  applyDocumentEdit,
  compareWorklist,
  daysBetween,
  docState,
  formatDate,
  parseUsDate,
  stalledReason,
  summarizeApplication,
  type Application,
  type ApplicationSummary,
  type DocumentRow,
} from "./rules";

const AS_OF = "2026-02-15";

const app: Application = {
  id: "APP-1",
  business_name: "Test Co",
  borrower_name: "Pat Doe",
  loan_amount: 100000,
  application_date: "2025-12-01",
  assigned_processor: "Aisha Patel",
};

function doc(over: Partial<DocumentRow> = {}): DocumentRow {
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

describe("dates", () => {
  it("parses M/D/YYYY to ISO and rejects junk", () => {
    expect(parseUsDate("1/5/2026")).toBe("2026-01-05");
    expect(parseUsDate("12/31/2025")).toBe("2025-12-31");
    expect(parseUsDate("")).toBeNull();
    expect(() => parseUsDate("2/30/2026")).toThrow();
    expect(() => parseUsDate("2026-01-05")).toThrow();
  });

  it("does date math across month and year boundaries", () => {
    expect(addDays("2026-01-28", 90)).toBe("2026-04-28");
    expect(daysBetween("2026-01-20", "2026-02-15")).toBe(26);
    expect(formatDate("2026-02-15")).toBe("Feb 15, 2026");
  });

  it("compares by date, not by M/D/YYYY text", () => {
    // As text, "10/1/2025" < "9/1/2025"; as dates it is later.
    expect(parseUsDate("10/1/2025")! > parseUsDate("9/1/2025")!).toBe(true);
  });
});

describe("document state", () => {
  it("derives Expired from an expiration date before the as-of date", () => {
    const s = docState(doc({ status: "Received", expiration_date: "2026-02-01" }), AS_OF);
    expect(s.expired).toBe(true);
    expect(s.effectiveStatus).toBe("Expired");
    expect(s.outstanding).toBe(true);
  });

  it("keeps stored Expired with no expiration date, and counts it outstanding", () => {
    const s = docState(doc({ status: "Expired", expiration_date: null }), AS_OF);
    expect(s.expired).toBe(true);
    expect(s.outstanding).toBe(true);
  });

  it("flags Approved documents expiring within 30 days as expiring soon", () => {
    const s = docState(doc({ status: "Approved", expiration_date: "2026-03-10" }), AS_OF);
    expect(s.expiringSoon).toBe(true);
    expect(s.expired).toBe(false);
    expect(s.complete).toBe(true);
  });

  it("does not flag expiring soon beyond 30 days, and the as-of day itself is not expired", () => {
    expect(docState(doc({ status: "Approved", expiration_date: "2026-03-18" }), AS_OF).expiringSoon).toBe(false);
    expect(docState(doc({ status: "Approved", expiration_date: "2026-03-17" }), AS_OF).expiringSoon).toBe(true);
    const today = docState(doc({ status: "Approved", expiration_date: AS_OF }), AS_OF);
    expect(today.expired).toBe(false);
    expect(today.expiringSoon).toBe(true);
  });

  it("treats Approved and Not Required as complete and the rest as outstanding", () => {
    for (const status of ["Approved", "Not Required"]) {
      expect(docState(doc({ status }), AS_OF).complete).toBe(true);
    }
    for (const status of ["Pending", "Received", "Under Review", "Expired"]) {
      expect(docState(doc({ status }), AS_OF).outstanding).toBe(true);
    }
  });
});

describe("application rollup", () => {
  it("flags stalled with days idle and outstanding count", () => {
    const docs = [
      doc({ status: "Received", date_received: "2026-01-20" }),
      doc({ status: "Pending" }),
      doc({ status: "Pending" }),
      doc({ status: "Under Review", date_received: "2026-01-10" }),
      doc({ status: "Approved", date_received: "2026-01-05" }),
    ];
    const s = summarizeApplication(app, docs, AS_OF);
    expect(s.outstandingCount).toBe(4);
    expect(s.daysIdle).toBe(26);
    expect(s.stalled).toBe(true);
    expect(stalledReason(s)).toBe("Stalled — 26 days idle, 4 outstanding");
  });

  it("uses the application date when nothing has been received", () => {
    const s = summarizeApplication(app, [doc()], AS_OF);
    expect(s.lastActivity).toBe("2025-12-01");
    expect(s.stalled).toBe(true);
  });

  it("is not stalled under 14 days idle or with nothing outstanding", () => {
    const recent = summarizeApplication(app, [doc(), doc({ status: "Received", date_received: "2026-02-02" })], AS_OF);
    expect(recent.daysIdle).toBe(13);
    expect(recent.stalled).toBe(false);
    const atThreshold = summarizeApplication(app, [doc(), doc({ status: "Received", date_received: "2026-02-01" })], AS_OF);
    expect(atThreshold.stalled).toBe(true);
    const done = summarizeApplication(app, [doc({ status: "Approved", date_received: "2025-10-01" })], AS_OF);
    expect(done.stalled).toBe(false);
  });

  it("rolls expiry flags up to the application", () => {
    const s = summarizeApplication(
      app,
      [
        doc({ status: "Approved", expiration_date: "2026-03-10", date_received: "2026-02-10" }),
        doc({ status: "Received", expiration_date: "2026-02-01", date_received: "2025-11-03" }),
      ],
      AS_OF,
    );
    expect(s.expiringSoonCount).toBe(1);
    expect(s.expiredCount).toBe(1);
  });

  it("sorts stalled, then expired, then expiring soon, then outstanding count, then id", () => {
    const base = summarizeApplication(app, [], AS_OF);
    const mk = (id: string, over: Partial<ApplicationSummary>): ApplicationSummary => ({ ...base, id, stalled: false, ...over });
    const list = [
      mk("A-clean-many", { outstandingCount: 9 }),
      mk("B-soon", { expiringSoonCount: 1, outstandingCount: 1 }),
      mk("C-expired", { expiredCount: 1, outstandingCount: 1 }),
      mk("D-stalled", { stalled: true, outstandingCount: 1 }),
      mk("E-clean-few", { outstandingCount: 2 }),
      mk("A-clean-few", { outstandingCount: 2 }),
    ].sort(compareWorklist);
    expect(list.map((x) => x.id)).toEqual([
      "D-stalled",
      "C-expired",
      "B-soon",
      "A-clean-many",
      "A-clean-few",
      "E-clean-few",
    ]);
  });
});

describe("document edits", () => {
  it("rejects unknown statuses and malformed dates", () => {
    expect(applyDocumentEdit(doc(), { status: "Done" }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { date_received: "2/1/2026" }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { date_received: "2026-02-30" }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), { notes: 42 }, AS_OF).ok).toBe(false);
    expect(applyDocumentEdit(doc(), {}, AS_OF).ok).toBe(false);
  });

  it("rejects a received date after the as-of date", () => {
    const r = applyDocumentEdit(doc(), { date_received: "2026-02-16" }, AS_OF);
    expect(r).toEqual({ ok: false, error: "Received date can't be after today (2026-02-15)." });
    expect(applyDocumentEdit(doc(), { date_received: AS_OF }, AS_OF).ok).toBe(true);
  });

  it.each(["Received", "Under Review", "Approved"])(
    "auto-fills a blank received date with the as-of date when a Pending doc becomes %s",
    (status) => {
      const r = applyDocumentEdit(doc(), { status }, AS_OF);
      expect(r.ok && r.fields.date_received).toBe(AS_OF);
    },
  );

  it("clears the stall once a pending doc arrives", () => {
    const pending = doc();
    const before = summarizeApplication(app, [pending], AS_OF);
    expect(before.stalled).toBe(true);
    const r = applyDocumentEdit(pending, { status: "Received" }, AS_OF);
    if (!r.ok) throw new Error(r.error);
    const after = summarizeApplication(app, [{ ...pending, ...r.fields }], AS_OF);
    expect(after.stalled).toBe(false);
  });

  it("does not reset the stall clock on status-only or notes edits of a received doc", () => {
    const received = doc({ status: "Received", date_received: "2026-01-20" });
    const s1 = applyDocumentEdit(received, { status: "Under Review" }, AS_OF);
    const s2 = applyDocumentEdit(received, { notes: "Called borrower" }, AS_OF);
    expect(s1.ok && s1.fields.date_received).toBe("2026-01-20");
    expect(s2.ok && s2.fields.date_received).toBe("2026-01-20");
    expect(s2.ok && s2.fields.status).toBe("Received");
  });

  it("does not fill a received date when moving to Pending or Not Required", () => {
    const r = applyDocumentEdit(doc(), { status: "Not Required" }, AS_OF);
    expect(r.ok && r.fields.date_received).toBeNull();
  });

  it("recalculates expiration from a replacement received date and clears Expired", () => {
    const bank = doc({
      document_type: "Bank Statements (90 day)",
      status: "Expired",
      date_received: "2025-10-01",
      expiration_date: "2025-12-30",
    });
    const r = applyDocumentEdit(bank, { date_received: "2026-02-10" }, AS_OF);
    if (!r.ok) throw new Error(r.error);
    expect(r.fields.expiration_date).toBe("2026-05-11");
    expect(r.fields.status).toBe("Received");
    expect(docState(r.fields, AS_OF).expired).toBe(false);
  });

  it("applies the tax (1,095 day) and insurance (365 day) rules", () => {
    const tax = applyDocumentEdit(doc({ document_type: "Personal Tax Returns (3yr)" }), { date_received: "2026-01-01" }, AS_OF);
    expect(tax.ok && tax.fields.expiration_date).toBe("2028-12-31");
    const ins = applyDocumentEdit(doc({ document_type: "Insurance Verification" }), { date_received: "2026-01-01" }, AS_OF);
    expect(ins.ok && ins.fields.expiration_date).toBe("2027-01-01");
  });

  it("clears the expiration date when the received date is cleared", () => {
    const bank = doc({ document_type: "Bank Statements (90 day)", status: "Received", date_received: "2026-01-28", expiration_date: "2026-04-28" });
    const r = applyDocumentEdit(bank, { date_received: "" }, AS_OF);
    expect(r.ok && r.fields.expiration_date).toBeNull();
  });

  it("never gives non-expiring types an expiration date", () => {
    const r = applyDocumentEdit(doc({ document_type: "Lease Agreement" }), { status: "Received" }, AS_OF);
    expect(r.ok && r.fields.date_received).toBe(AS_OF);
    expect(r.ok && r.fields.expiration_date).toBeNull();
  });

  it("stores blank notes as null", () => {
    const r = applyDocumentEdit(doc({ notes: "old" }), { notes: "  " }, AS_OF);
    expect(r.ok && r.fields.notes).toBeNull();
  });
});
