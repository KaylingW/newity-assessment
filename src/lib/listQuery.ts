// The Applications list keeps its filters in the URL. These helpers read them and carry them
// to the detail page and back, so "All applications" returns to the same filtered list.

import { APPLICATION_STATUSES, isIsoDate, type ApplicationFilters, type ApplicationStatus } from "./rules";

export type RawParams = Record<string, string | string[] | undefined>;

const KEYS = ["q", "status", "processor", "expiry", "from", "to"] as const;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function readListQuery(raw: RawParams, processors: string[]) {
  const status = first(raw.status);
  const expiry = first(raw.expiry);
  const processor = first(raw.processor);
  // Invalid dates are ignored; a reversed range is read the way it was meant.
  let from = isIsoDate(first(raw.from)) ? first(raw.from) : undefined;
  let to = isIsoDate(first(raw.to)) ? first(raw.to) : undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const filters: ApplicationFilters = {
    q: first(raw.q) || undefined,
    status: (APPLICATION_STATUSES as readonly string[]).includes(status) ? (status as ApplicationStatus) : undefined,
    expiry: expiry === "expired" || expiry === "soon" ? expiry : undefined,
    appliedFrom: from,
    appliedTo: to,
  };
  return { filters, processor: processors.includes(processor) ? processor : "" };
}

/** "?q=…&status=…" with only the list filters, or "" when none are set. */
export function listQueryString(raw: RawParams): string {
  const qs = new URLSearchParams();
  for (const key of KEYS) {
    const v = first(raw[key]);
    if (v) qs.set(key, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
