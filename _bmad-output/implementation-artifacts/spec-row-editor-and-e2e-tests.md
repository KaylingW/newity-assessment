---
title: 'Component tests for DocumentRowEditor and a stall-clearing E2E test'
type: 'chore'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1ba9ebd083508f6c56194727c0c2acf3225ddcc0'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current tests cover rules, the db layer, the seed and the PATCH route, but nothing tests the browser editor (`DocumentRowEditor`) or the running app. The editor holds the riskiest logic: the notes debounce, the ordered save queue, undo-on-error and save-on-close. A bug there would silently lose or overwrite a processor's edit.

**Approach:** Add Vitest component tests for `DocumentRowEditor` (jsdom, Testing Library, fake timers, mocked `fetch` and `next/navigation`). Add one Playwright E2E test against a production build backed by a throwaway database: marking a stalled application's pending document Received clears Stalled, survives a reload, and shows on `/outstanding`. Both are in scope for this run (user decision).

## Boundaries & Constraints

**Always:** Leave every existing test running in the `node` environment; only the new component test file opts into jsdom. The E2E test uses its own database file (`DB_PATH`), seeded fresh each run, and never touches `.data/tracker.db`. Use the same Node 22 that `.nvmrc` pins. Match the existing tests' style: plain-English `it` names and short comments only where needed.

**Never:** Change application code in `src/` to make it easier to test. If a test exposes a real bug, record it in Implementation Notes and the review rather than fixing it here. No snapshot tests, no extra E2E flows beyond the one below, no CI workflow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Notes debounce | Type "abc" in notes, wait 800ms | Exactly one PATCH `{notes:"abc"}` | N/A |
| Debounce + blur | Type, blur before 800ms, then advance timers | One PATCH total | N/A |
| Ordered saves | Status → Received (slow response), then → Approved | Second request only starts after the first resolves; order Received, Approved | N/A |
| Failed status save | PATCH returns 400 `{error:"Bad"}` | Select goes back to `doc.status`; "Bad" shown with role=status | Other fields untouched |
| Failed notes save | Notes PATCH returns 400 | Typed notes stay in the textarea; blurring again resends them | N/A |
| Network failure | `fetch` rejects | "Could not reach the server. Please try again." | N/A |
| Success | PATCH 200 | "Saved" shown; `router.refresh` called | N/A |
| Refresh while typing | Notes focused with typed text, `doc.notes` prop changes on rerender | Textarea keeps the typed text | N/A |
| Refresh not focused | `doc.notes` prop changes, notes not focused | Textarea shows the new prop value | N/A |
| Flush on close | Unsaved received date; `pagehide`, hidden `visibilitychange`, or unmount | PATCH with `keepalive: true` and only the unsaved field | Nothing sent when nothing is unsaved |

</frozen-after-approval>

## Code Map

- `src/components/DocumentRowEditor.tsx` -- system under test. Renders a `<tr>`, so mount it inside `<table><tbody>`. Accessible names: `Status for {type}`, `Received date for {type}`, `Notes for {type}`. Messages use `role="status"`. `NOTES_AUTOSAVE_MS = 800`. Received date saves on blur only. Read only, don't change.
- `src/lib/rules.ts` `unsavedChanges`, `DocumentRow` -- what flush sends; the type for fixture props.
- `tests/helpers.ts` `doc()` -- reuse for the `doc` prop. Importing it pulls in `@/lib/db` (better-sqlite3); fine under jsdom but keep an eye on it.
- `vitest.config.mts` -- `include` is `tests/**/*.test.ts`; widen it to `.tsx`. Keep `environment: "node"` as the default.
- `src/lib/db.ts` `getDb` -- reads `process.env.DB_PATH` and seeds from `data/NEWITY_Sample_Data_A_Document_Checklist.csv` when empty.
- `src/app/applications/[id]/page.tsx` -- the status pill (`Stalled` → `Needs docs`) and the stalled reason text.
- `src/app/outstanding/page.tsx` -- per-application card with a HIGH/MEDIUM pill and `{type} — Missing` items.
- E2E fixture: **APP-2026-1035 Oasis Spa & Salon**, stalled 26 days idle, 0 expired, pending: Business Licenses & Permits, Lease Agreement, Ownership Verification. Marking **Lease Agreement** Received auto-fills the as-of date, so the application becomes `Needs docs` and its outstanding card drops HIGH → MEDIUM and no longer lists Lease Agreement.
- `.gitignore` -- already ignores `.data/`; add Playwright's `test-results/` and `playwright-report/`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add devDeps `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`; add script `"test:e2e": "playwright test"` -- tooling.
- [x] `vitest.config.mts` -- include `tests/**/*.test.{ts,tsx}` -- picks up the component test.
- [x] `tests/components/DocumentRowEditor.test.tsx` -- `// @vitest-environment jsdom`; mock `next/navigation` `useRouter` with a `refresh` spy; stub `fetch` per test; cover every matrix row -- the main deliverable.
- [x] `playwright.config.ts` -- `testDir: "e2e"`, one chromium project, `webServer` that removes `.data/e2e.db*`, then runs `next build && next start -p 3100` with `DB_PATH=.data/e2e.db`, `reuseExistingServer: false`, `baseURL` on port 3100 -- an isolated, fresh database per run.
- [x] `e2e/stall-clears.spec.ts` -- open `/applications/APP-2026-1035`, assert Stalled; set Lease Agreement to Received; wait for "Saved"; assert Needs docs and the received date filled in; reload and assert again; open `/outstanding` and assert the Oasis card shows MEDIUM with no Lease Agreement item -- the E2E journey.
- [x] `.gitignore` -- add `test-results/` and `playwright-report/`.
- [x] `README.md` -- under Other commands, add `npm run test:e2e` and the one-time `npx playwright install chromium`; update the `tests/` line in Project layout -- docs.

**Acceptance Criteria:**
- Given a fresh clone on Node 22, when `npm test` runs, then the existing tests and the new component tests all pass, and the existing tests still run under `node`.
- Given `npx playwright install chromium` has run, when `npm run test:e2e` runs twice in a row, then it passes both times and `.data/tracker.db` is unchanged.
- Given the editor's save queue were removed (saves sent in parallel), when the component tests run, then the ordered-saves test fails. Check this mutation by hand once, then revert it.

## Implementation Notes

- 17 component tests in `tests/components/DocumentRowEditor.test.tsx` cover every matrix row; only this file opts into jsdom (per-file comment), the vitest default stays `node`.
- Flush-on-close tests set the received date with `fireEvent.change` (no blur), so it stays unsaved; hidden `visibilitychange` is simulated by stubbing `document.visibilityState`.
- Mutation check done by hand: replacing the queue with `void send(patch)` fails only "sends saves one at a time, in the order they were made"; reverted.
- `playwright.config.ts` webServer deletes `.data/e2e.db`, `-wal`, `-shm`, then `npx next build && npx next start -p 3100` with `DB_PATH=.data/e2e.db`. Uses `rm -f`, so the E2E command assumes a POSIX shell.
- `next build` writes to `.next/`, so running the E2E suite replaces any existing production build.
- No application bugs found; no `src/` changes.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| VG: failed date save revert, and notes retry after a network failure, untested (mutations survive) | medium | Pre-verified: deleting either line in `send()` left all 13 tests green | patch |
| Blind/Edge: `shouldAdvanceTime: true` lets real time fire the 800ms debounce, so count assertions can flake | medium | Fake timers advance with the wall clock; `not.toHaveBeenCalled` after typing and the exact counts depend on staying under 800ms real time | patch |
| Edge: notes-retry test can pass via the pending debounce timer instead of the blur | medium | The timer for "abc" is still pending after the early blur; once a failure resets `sentNotes`, the timer would resend it | patch |
| Blind: failed save mid-queue not shown to leave later saves working; no-`error` 400 fallback message untested | low | `send` returns without throwing, so the queue continues, but nothing asserts it; adding the test is a direct addition | patch |
| Edge: "other fields untouched" only checked against unedited props, not an in-progress edit | low | The test sets no unsaved edit before the failing select; fixing it takes one `fireEvent.change` | patch |
| VG other: a flush on `visibilitychange` to visible is not caught | low | Mutation survived; adding a visible-event test is a direct addition | patch |
| Edge: network failure leaves the status select showing the unsaved value | medium | `catch` in `send()` reverts only `sentNotes`, not status or date; this is existing behaviour in `src/`, not caused by this change | defer |
| Blind/Edge: flush after a successful save but before refresh resends the same patch (also on E2E reload) | low | Real, but the PATCH is idempotent (same values); fixing it means a new guard in `src/` | reject |
| Blind/Edge: E2E `next build` clobbers a running dev server | false | Next 16 dev writes to `.next/dev` (verified on disk); only a prior production build is replaced, as Implementation Notes say | reject |
| Edge: port 3100 busy fails the run | false | Fails loudly with a port-in-use error, which is correct behaviour | reject |
| Blind/Edge: `rm -f` is POSIX-only | low | Project tooling (nvm) is Unix-oriented; the fix adds a globalSetup | reject |
| Blind/Edge: no `workers: 1` for future specs sharing the db | false | There is only one spec, so no race exists today | reject |
| Blind: E2E precondition asserts (HIGH, Pending) missing; README duplicates the webServer steps | low | Stalled is asserted first; the seed is static | reject |
| Blind: README only mentions `npm test`; no note to reinstall Playwright browsers after a version bump | false/low | `npm test` runs the component tests; reinstalling after a bump is standard Playwright guidance | reject |
| Blind: date null-clear, unchanged-date blur and whitespace-notes flush untested | low | Already covered by `unsavedChanges` and route tests; component-level duplication only | reject |
| VG other: Node 21 shell fails with a rolldown binding error | false | Existing environment issue; the README's `nvm use` covers it | reject |

## Design Notes

Ordered-saves test: give `fetch` a deferred promise for the first call, then assert `fetch` was called only once after the second change; resolve it, flush microtasks, and assert the second call. Use plain `vi.useFakeTimers()` (time moves only when a test advances it, so the debounce cannot fire on its own) with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, and stub a global `jest` with `advanceTimersByTime` so Testing Library's async wrapper advances the fake clock instead of hanging.

## Verification

**Commands:**
- `nvm use && npm test` -- expected: all pass
- `npx tsc --noEmit` -- expected: no errors
- `npx playwright install chromium && npm run test:e2e` -- expected: 1 passed, then pass again on a second run
