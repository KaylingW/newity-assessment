---
title: 'SBA document checklist tracker — core (CAP-1 to CAP-5)'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cae8479b3a1f00bc943a4049dad637223dddf411'
context:
  - '{project-root}/_bmad-output/specs/spec-sba-doc-checklist/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-sba-doc-checklist/data-profile.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** NEWITY's loan processors track SBA document checklists for ~60 applications in a shared spreadsheet and can't see which applications are stalled or have expired documents, so things fall through the cracks.

**Approach:** A local Next.js + TypeScript app backed by SQLite, seeded once from the bundled CSV, showing a worklist sorted by attention needed (stalled and expiry flags, outstanding count, processor filter) and a per-application checklist where processors edit status, received date and notes. CAP-6 (weekly summary) is deferred to the next build.

## Boundaries & Constraints

**Always:** Follow SPEC.md constraints and assumptions verbatim: as-of date is one config value (default `2026-02-15`) shown in the UI and used for every expiry/stall check; complete = Approved | Not Required, everything else outstanding; effective Expired = stored Expired OR `expiration_date` < as-of; expiring soon = expires within 30 days of as-of; stalled = ≥1 outstanding doc AND latest `date_received` (or `application_date` if none received) ≥14 days before as-of. Dates stored as ISO `YYYY-MM-DD`. Seed is idempotent. One install command + one start command. Plain-language UI, no jargon.

**Never:** CAP-6 weekly summary, auth, email, charts, creating/deleting applications or document rows, CSV export, external services, a DB server, comparing dates as `M/D/YYYY` strings, keeping edit state only in the browser.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run | No DB file | Seeds 60 apps / 620 docs | Seed runs in one transaction; failure leaves DB empty |
| Restart | DB already seeded | No re-seed, counts unchanged, edits kept | N/A |
| Derived expiry | Status Received, `expiration_date` 2026-02-01 | Shows Expired | N/A |
| Expired, no date | Status Expired, no `expiration_date` (27 rows) | Shows Expired, counts outstanding | N/A |
| Expiring soon | `expiration_date` 2026-03-10, status Approved | "Expiring soon" on doc and app | N/A |
| Stalled | Outstanding docs, latest receipt 2026-01-20 | Flag reads e.g. "Stalled — 26 days idle, 4 outstanding" | N/A |
| Bad edit | Unknown status or malformed date via API | Rejected, row unchanged | 400 with plain message shown inline |
| Doc arrives | Pending doc set to Received / Under Review / Approved, blank received date | Received date auto-fills with as-of date; stall clears | N/A |
| Status-only edit | Already-received doc changes status, or notes edited | Stall clock unchanged | N/A |
| Replacement received | New received date on Bank Statements (90 day) | `expiration_date` = received + 90 days; no longer Expired | N/A |

**Decisions:** (1) Only received dates count as stall activity; status-only and notes edits don't reset the clock. (2) Setting a received date on an expiring type recalculates `expiration_date` from the type's rule (3y tax = 1,095d, bank 90d, insurance 365d); clearing it clears the expiration date. Non-expiring types never get one.

</frozen-after-approval>

## Code Map

Greenfield repo: only `README.md`, `data/NEWITY_Sample_Data_A_Document_Checklist.csv` (620 rows, no quoted fields, `M/D/YYYY` dates) and BMAD tooling. Node 21.7 is installed, so `node:sqlite` is unavailable; use `better-sqlite3`. Don't touch `_bmad/`, `.agents/` or `.claude/`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore` -- Next.js 15 App Router + TS, deps `better-sqlite3`, `csv-parse`; dev dep `vitest`; scripts `dev`, `build`, `start`, `test`; ignore `.data/` -- one-command run.
- [x] `src/lib/config.ts` -- `AS_OF_DATE` (env `AS_OF_DATE`, default `2026-02-15`), `STALL_DAYS = 14`, `EXPIRING_SOON_DAYS = 30`, expiry rule table by document type -- single source of truth.
- [x] `src/lib/rules.ts` -- pure functions: parse `M/D/YYYY` → ISO, effective doc state (complete / outstanding / expired / expiring soon), application rollup (outstanding count, stalled + days idle, expiry flags), worklist sort key -- testable without DB.
- [x] `src/lib/rules.test.ts` -- unit tests covering every I/O matrix row and both open-question decisions.
- [x] `src/lib/db.ts` -- open `.data/tracker.db`, create `applications` and `documents` tables, seed from CSV in a transaction when empty, query + update helpers -- CAP-1.
- [x] `src/lib/seed.test.ts` -- seed into a temp DB: 60/620 counts, second run adds nothing.
- [x] `src/app/api/documents/[id]/route.ts` -- PATCH status / date_received / notes with validation -- CAP-3 persistence.
- [x] `src/app/page.tsx` + components -- worklist table: business, borrower, processor, outstanding count, stalled reason, expiry badge; processor filter in the URL query; as-of date in the header -- CAP-2/4/5.
- [x] `src/app/applications/[id]/page.tsx` + components -- checklist table with inline status select (≤2 clicks), received-date input, notes field; saves on change and refreshes -- CAP-3/4.
- [x] `README.md` -- prerequisites (Node ≥22, see Implementation Notes), `npm install && npm run dev`, how to change the as-of date and reset the DB.

**Acceptance Criteria:**
- Given a fresh clone, when a reviewer runs `npm install` then `npm run dev`, then the worklist loads with 60 applications within 5 minutes.
- Given the worklist, when filtered to Aisha Patel, then only her applications show and the filter survives a page reload.
- Given the worklist, then every stalled or expired/expiring application sorts above all clean ones.
- Given an application checklist, when a processor changes a status, then the change takes ≤2 clicks, the worklist reflects it on return, and it survives a server restart.

## Implementation Notes

- Node prerequisite is Node 22+ (not 18.18): `better-sqlite3` has no prebuilt binary for Node 21 (this machine's default) in v10+, and v12.11 (needed for Node 24/25 prebuilds) drops Node 20. README and `engines` say >=22; `.nvmrc` pins 22. Verified install on 22.12 and 25.7.
- A new received date on a doc stored as Expired (with no status in the same edit) sets status to Received, so the "Replacement received" matrix row ends "no longer Expired".
- `src/app/api/documents/[id]/route.test.ts` covers the Bad edit matrix row at the API level: 400 with a plain message and the row unchanged, plus 404 for unknown ids.
- Auto-fill of received date happens only when the status changes into Received / Under Review / Approved and the edit doesn't set a received date itself.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | Received-date input saves on every change: partial years (`0002-…`) and transient `""` PATCH mid-typing; `""` wipes received + expiration dates | high | `DocumentRowEditor.tsx` onChange saves any ISO/empty value; Chrome emits these while editing segments | patch |
| 2 | BH, EC | Received date after as-of accepted; negative `daysIdle` hides a stall | medium | `applyDocumentEdit` only checks calendar validity; `summarizeApplication` stalled needs `daysIdle >= 14` | patch |
| 3 | BH, EC | Notes over 2000 chars rejected and the error path resets the typed text | medium | textarea has no `maxLength`; error branch calls `setNotes(doc.notes)` | patch |
| 4 | BH, EC | Concurrent row saves: `disabled={saving}` blocks the next control; error reverts all fields, not the one patched | low | blur save disables select during click; PATCH is per-field so disabling is unnecessary | patch |
| 5 | VG, BH | No DB-level test that PATCH persists recalculated `expiration_date`, Expired→Received, and notes; non-object body branch untested | medium | only route success test reads status/date_received | patch |
| 6 | VG | Processor filter test passes on empty result (`.every` on `[]`) | low | CSV has 18 Aisha Patel apps; one-line assertion | patch |
| 7 | VG, EC | Route test hard-codes `2026-02-15` instead of `AS_OF_DATE` | low | fails if `AS_OF_DATE` set in shell, as README suggests | patch |
| 8 | VG | `readAsOfDate` parsing/fallback untested | medium (unverified impact) | logic not exported; needs module-reload test | defer |
| 9 | BH | README says odd-numbered Node may fail yet lists 25 as tested | low | README prerequisites line | patch |
| 10 | EC | Non-canonical ids (`1e1`, `0x5`) resolve to other documents | low | `Number(rawId)` in route; one-line regex | patch |
| 11 | BH | Red "0 stalled" / "0 with expired" badges and "N expired" wording mismatch; redundant template literal | low | `page.tsx` badges, checklist badge, `label` | patch |
| 12 | VG, BH | Expiring-soon rows not highlighted red though sorted above clean | false | red bar marks red-severity flags; expiring rows carry amber badge and sort correctly — no wrong outcome | reject |
| 13 | BH, EC | Seed doesn't validate status / blank loan / required text | false | bundled CSV: only the 6 known statuses, 0 blank loans; must ingest as-is | reject |
| 14 | BH, EC | `INSERT OR IGNORE` silently drops conflicting rows | false | bundled CSV has 0 duplicate pairs, 0 conflicting app rows; seed test pins 60/620 | reject |
| 15 | EC | Seed CSV date errors lack line number | low | unreachable with bundled CSV; message still names bad value | reject |
| 16 | EC | Seed failure in `getDb` leaks a connection per request | low | requires deleted/corrupted bundled CSV; unlikely | reject |
| 17 | BH | Status-only Expired→Received keeps past expiry, still Expired; clearing date on arrived status | false | matches frozen decisions (only received dates move clock/expiry); UI explains "past its expiry date" | reject |
| 18 | EC | Pending keeps received date and resets stall clock | false | frozen Decision 1: status-only edits don't touch the clock | reject |
| 19 | EC | Not Required with past expiration counts expired | false | frozen rule: expired = stored Expired OR expiration < as-of; CSV has 0 such rows | reject |
| 20 | BH | `package-lock.json` missing from change | false | file exists untracked; excluded only from review diff | reject |
| 21 | BH | Invalid `AS_OF_DATE` only warns | low | designed fallback; surfacing in UI adds surface | reject |
| 22 | BH | Worklist loads all documents when filtered | low | 620 rows, negligible | reject |
| 23 | BH | Planning files incomplete (deferred-work source, empty logs, implementation-note decisions) | false | fix edits this build's spec; source_spec none is correct for a pre-spec split | reject |
| 24 | BH | "Saved" message never clears; no `error.tsx` | low | cosmetic; fixes add timers/files | reject |
| 25 | EC | `decodeURIComponent` on malformed `%` → 500 not 404 | low | hand-crafted URL only | reject |
| 26 | EC | Route test `beforeAll` throws TypeError if no Pending null-date row | false | seeded CSV has 183 Pending, 209 null receipts | reject |

## Design Notes

Sort order: stalled first, then has expired doc, then expiring soon, then outstanding count descending, then application id. Flags are computed on read from rows + as-of date, never stored, so changing `AS_OF_DATE` re-evaluates everything.

## Verification

**Commands:**
- `npm test` -- expected: all rules and seed tests pass.
- `npx tsc --noEmit` -- expected: no type errors.
- `npm run build` -- expected: succeeds.

**Manual checks (if no CLI):**
- Start the app, confirm 60 applications and a visible as-of date, edit a document, restart, and confirm the edit persists.
