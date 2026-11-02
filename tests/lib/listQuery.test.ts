import { describe, expect, it } from "vitest";
import { listQueryString, readListQuery } from "@/lib/listQuery";

const processors = ["Aisha Patel", "Marcus Lee"];

describe("readListQuery", () => {
  it("reads every filter from the URL", () => {
    const { filters, processor } = readListQuery(
      { q: " metro ", status: "Stalled", expiry: "soon", processor: "Marcus Lee", from: "2025-10-01", to: "2026-01-31" },
      processors,
    );
    expect(filters).toEqual({
      q: "metro",
      status: "Stalled",
      expiry: "soon",
      appliedFrom: "2025-10-01",
      appliedTo: "2026-01-31",
    });
    expect(processor).toBe("Marcus Lee");
  });

  it("ignores unknown statuses, expiry values and processors", () => {
    const { filters, processor } = readListQuery(
      { status: "stalled", expiry: "later", processor: "Nobody" },
      processors,
    );
    expect(filters.status).toBeUndefined();
    expect(filters.expiry).toBeUndefined();
    expect(processor).toBe("");
  });

  it("ignores dates that aren't real YYYY-MM-DD dates", () => {
    for (const bad of ["2026-02-30", "2/1/2026", "yesterday", "2026-1-1", ""]) {
      const { filters } = readListQuery({ from: bad, to: bad }, processors);
      expect(filters.appliedFrom).toBeUndefined();
      expect(filters.appliedTo).toBeUndefined();
    }
  });

  it("swaps a reversed date range", () => {
    const { filters } = readListQuery({ from: "2026-01-31", to: "2025-10-01" }, processors);
    expect(filters.appliedFrom).toBe("2025-10-01");
    expect(filters.appliedTo).toBe("2026-01-31");
  });

  it("keeps a one-sided date range", () => {
    expect(readListQuery({ from: "2026-01-01" }, processors).filters).toMatchObject({
      appliedFrom: "2026-01-01",
      appliedTo: undefined,
    });
  });

  it("uses the first value when a parameter repeats", () => {
    const { filters } = readListQuery({ status: ["Complete", "Stalled"], from: ["2026-01-01", "2025-01-01"] }, processors);
    expect(filters.status).toBe("Complete");
    expect(filters.appliedFrom).toBe("2026-01-01");
  });

  it("treats a blank search as no search", () => {
    expect(readListQuery({ q: "   " }, processors).filters.q).toBeUndefined();
  });
});

describe("listQueryString", () => {
  it("carries the list filters, including dates, and drops everything else", () => {
    expect(listQueryString({ q: "a b", from: "2026-01-01", to: "2026-01-31", view: "expiring", status: "" })).toBe(
      "?q=a+b&from=2026-01-01&to=2026-01-31",
    );
  });

  it("is empty when no filters are set", () => {
    expect(listQueryString({})).toBe("");
    expect(listQueryString({ q: "  " })).toBe("");
  });
});
