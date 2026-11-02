# SBA Document Checklist Tracker

A small local web app for tracking SBA loan document checklists. It shows every application in one list, puts the stalled ones and the ones with expired or expiring documents at the top, and lets a processor update each document's status, received date and notes.

## Prerequisites

- **Node.js 22 or newer** (`.nvmrc` pins 22). The SQLite driver (`better-sqlite3`) has ready-made builds for Node 22, 24 and 25, so no compiler is needed. Older versions (20, 21) have no ready-made build; the install falls back to compiling and may fail.
- npm (comes with Node).
- On Apple Silicon Macs, use a native **arm64** Node. Check with `node -p process.arch`; it should print `arm64`, not `x64`.

## Install

With [nvm](https://github.com/nvm-sh/nvm), switch to the pinned version first:

```bash
nvm install   # reads .nvmrc; only needed once
nvm use
```

Then install the dependencies:

```bash
npm install
```

## Run it

```bash
npm run dev
```

Open http://localhost:3000. On first start the app creates `.data/tracker.db` and loads `data/NEWITY_Sample_Data_A_Document_Checklist.csv` into it (60 applications, 620 documents). Later starts reuse the same database, so edits are kept.

For a production build: `npm run build && npm start`.

## Change the "today" date

All expiry and stalled checks use one as-of date, shown in the page header. It is **frozen at 2026-02-15** on purpose, not read from the system clock, because the sample data ends in February 2026. Against the real date, 34 of the 49 bank statements in the sample would already be expired, and since the last document arrived on 2026-02-12, every application still waiting on a document would be stalled. If a document due on, say, March 10, 2026 shows as "expiring soon" rather than "expired", that is why; it is not a bug. To change it, set `AS_OF_DATE` (format `YYYY-MM-DD`) when starting the app:

```bash
AS_OF_DATE=2026-03-01 npm run dev
```

## Reset the data

Stop the app, delete the database and start again. It reseeds from the CSV:

```bash
rm -rf .data && npm run dev
```

## Rules

- **Done:** Approved or Not Required. Everything else is still needed.
- **Expired:** stored status is Expired, or the expiration date is before the as-of date.
- **Expiring soon:** expires within 30 days of the as-of date. This is a warning shown beside the application's status, not a status of its own, so an application whose documents are all done still reads **Complete**, with e.g. "1 expiring soon" next to it. Once the date passes, the document counts as expired, the checklist drops (e.g. 9 of 9 to 8 of 9) and the status becomes **Expired docs** (or **Stalled**).
- **Stalled:** at least one document still needed, and no document received for 14 days or more (counting from the application date if nothing has been received).
- Marking a document Received, Under Review or Approved fills in the as-of date if it has no received date.
- Entering a received date on a tax return (3 years), bank statement (90 days) or insurance verification (365 days) recalculates its expiration date. Entering one on a document stored as Expired marks it Received.

The thresholds and expiry rules live in `src/lib/config.ts`; the rule logic is in `src/lib/rules.ts`.

## Known limitations

- **Expiry warnings never clear.** In real life a document only has to stay valid until the loan closes, so the warning should stop once it closes. Loan closing is out of scope for this version, so a complete application keeps its expiring-soon warning, and later drops out of Complete, until a fresh document is received.
- **Notes can contradict the status.** Notes are free text and don't change when the status does. A document reviewed with the note "Reviewing for completeness" keeps that note after it is marked Approved. Nothing checks that the two agree; one option would be to prompt for a note when the status changes.

## Tests

```bash
npm test
```

## Troubleshooting

**`better_sqlite3.node` ... incompatible architecture (have 'arm64', need 'x86_64')** (or the other way round): the native SQLite module was built with a different Node than the one running now. This usually means an x64 Node running under Rosetta on an Apple Silicon Mac. Switch to the arm64 Node 22 (`nvm use`) and rebuild the module:

```bash
nvm use
npm rebuild better-sqlite3
```

If that doesn't fix it, reinstall from scratch: `rm -rf node_modules && npm install`.
