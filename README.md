# SBA Document Checklist Tracker

A small local web app for tracking the document checklist on each SBA loan application. It brings every application into one list, puts the ones that need action first (stalled, expired or expiring documents), and lets a processor update each document's status, received date and notes.

## Quick start

You need **Node.js 22** and npm. With [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install && nvm use   # reads .nvmrc (22)
npm install
npm run dev
```

Open http://localhost:3000. On first start the app creates `.data/tracker.db` and loads `data/NEWITY_Sample_Data_A_Document_Checklist.csv` into it (60 applications, 620 documents). Later starts reuse the same database, so your edits are kept.

Every CSV row is checked before anything is loaded: known document type and status, no blank fields, a positive whole loan amount, real M/D/YYYY dates that aren't after the as-of date, and the same application details on every row for an application. If any row fails, the app loads nothing and the error lists every problem by line number. `data/NEWITY_Sample_Data_Malformed.csv` shows what gets rejected.

> **Use the same Node for every command.** The SQLite driver is compiled for the Node version that ran `npm install`. If you install under one version and run under another, the app fails to start. See [Troubleshooting](#troubleshooting).

## What's in the app

- **Applications** (`/`): every application in priority order, with search (business, borrower or application ID) and filters for status, processor, expiry and application date. Click a row to open it.
- **Application detail** (`/applications/[id]`): the checklist for one application, with its status, progress and any expiry warning. Edit a document's status, received date or notes inline; changes save automatically.
- **Outstanding items** (`/outstanding`): what to chase, grouped by application, as two views: missing or expired documents, and documents expiring within 30 days.

## How statuses are worked out

Each **document** is:

- **Done** when Approved or Not Required. Everything else is still needed.
- **Expired** when its stored status is Expired, or its expiration date is before the as-of date. An expired document no longer counts as done.
- **Expiring soon** when it expires within 30 days of the as-of date.

Each **application** gets one status, most urgent first:

| Status | Meaning |
| --- | --- |
| **Stalled** | Documents still needed, and nothing received for 14+ days (counted from the application date if nothing has arrived). |
| **Expired docs** | At least one document has expired. |
| **Needs docs** | Documents still needed. |
| **Complete** | Every document is done. |

**Expiring soon is a warning shown beside the status, not a status of its own.** An application whose documents are all done reads **Complete** with "1 expiring soon" next to it: done, but act before the date. Once the date passes, that document counts as expired, the checklist drops (e.g. 9 of 9 to 8 of 9) and the status becomes **Expired docs** or **Stalled**.

When a document is edited:

- Marking it Received, Under Review or Approved fills in the as-of date if it has no received date.
- Entering a received date on a tax return (3 years), bank statement (90 days) or insurance verification (365 days) recalculates its expiration date. Entering one on a document stored as Expired marks it Received.

Thresholds and expiry periods live in `src/lib/config.ts`; the rules themselves are in `src/lib/rules.ts`.

## The "today" date is frozen

Every expiry and stall check uses one **as-of date, 2026-02-15**, shown in the page header. It is fixed on purpose, not read from the system clock, because the sample data ends in February 2026. Against the real date, 34 of the 49 bank statements in the sample would already be expired, and since the last document arrived on 2026-02-12, every application still waiting on a document would be stalled.

So a document due on, say, March 10, 2026 shows as "expiring soon" rather than "expired". That is expected, not a bug. To try another date:

```bash
AS_OF_DATE=2026-03-11 npm run dev
```

## Design decisions

- **SQLite in a local file.** One user, one process, a few hundred rows: a file database needs no server or setup, and edits survive restarts. Several users or servers would call for Postgres.
- **`better-sqlite3` as the driver.** It's mature and fast, with a simple synchronous API. The trade-off is that it's a native module tied to one Node version (see Troubleshooting). Node's built-in `node:sqlite` would avoid that but is still marked experimental.
- **Business rules are pure functions** (`src/lib/rules.ts`) with no database access, so every rule is unit-tested directly. The database layer (`src/lib/db.ts`) only stores and loads.
- **Statuses are worked out when a page loads, not stored**, so they can never go stale as the as-of date moves.

## Known limitations

- **Expiry warnings never clear.** A document only has to stay valid until the loan closes, so the warning should stop at closing. Loan closing is out of scope for this version, so a complete application keeps its warning, and later drops out of Complete, until a fresh document is received.
- **Notes can contradict the status.** Notes are free text and don't change with the status. A document noted "Reviewing for completeness" keeps that note after it is marked Approved. Nothing checks that the two agree; one option is to prompt for a note when the status changes.
- **No sign-in or audit history.** Anyone with the app open can edit, and there is no record of who changed what.

## Project layout

```
src/app/            pages (applications list, detail, outstanding items) and the PATCH /api/documents/[id] route
src/components/     UI pieces, including the inline document editor
src/lib/config.ts   as-of date, thresholds, expiry periods, statuses
src/lib/rules.ts    all business rules (pure functions)
src/lib/db.ts       schema, CSV seed, queries
tests/              Vitest unit, database, API and editor component tests
e2e/                Playwright end-to-end test (runs against its own throwaway database)
data/               sample CSV
```

## Other commands

```bash
npm test                        # run the test suite
npx playwright install chromium # one-time: download the browser for the E2E test
npm run test:e2e                # build, start on port 3100 with a fresh .data/e2e.db, run the E2E test
npm run build && npm start      # production build
rm -rf .data && npm run dev     # reset: delete the database and reseed from the CSV
DB_PATH=/tmp/other.db npm run dev   # use a different database file
```

## Troubleshooting

Both errors below mean the SQLite driver (`better-sqlite3`) was built for a different Node than the one running now. That happens when terminals start on different Node versions, or when `npm install` ran before `nvm use`.

**`was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version of Node.js requires NODE_MODULE_VERSION Y`**: the driver was installed under another Node version (e.g. 147 is Node 26, 127 is Node 22). Switch to the project's Node and rebuild:

```bash
nvm use
npm rebuild better-sqlite3
```

**`better_sqlite3.node` ... `incompatible architecture (have 'arm64', need 'x86_64')`** (or the other way round): on Apple Silicon this usually means an x64 Node running under Rosetta. Check with `node -p process.arch`; it should print `arm64`. Install a native arm64 Node 22, then run the same two commands above.

If rebuilding doesn't help, reinstall from scratch:

```bash
nvm use
rm -rf node_modules && npm install
```
