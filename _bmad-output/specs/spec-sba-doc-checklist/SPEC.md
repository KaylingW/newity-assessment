---
id: SPEC-sba-doc-checklist
companions:
  - data-profile.md
  - deliverables.md
  - stack.md
sources:
  - ~/Downloads/NEWITY_Assessment_A_Document_Checklist.pdf
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# SBA Document Checklist Tracker (V1)

## Why

**Pain + mandate.** NEWITY's loan ops team (two loan processors, one team lead) tracks SBA document checklists for 50–75 active applications (up to 12 document types each) in a shared spreadsheet. Their biggest pain is not knowing which applications are stalled waiting on documents, so things fall through the cracks. Expired tax returns (3 years) and bank statements (90 days) cause the most rework. The team lead compiles a weekly pipeline email for leadership by hand every Monday. This is also a take-home assessment: the brief deliberately asks for more than fits in 4 hours, and part of the grade is cutting scope deliberately and explaining why.

## Capabilities

- **CAP-1**
  - **intent:** On first run, the system loads the bundled sample CSV into a persistent store with no manual import step.
  - **success:** A fresh install shows 60 applications and 620 document rows. Restarting does not duplicate data.
- **CAP-2**
  - **intent:** A processor sees every application in one worklist showing its outstanding-document count, stalled flag and expiry flag. They can filter to their own applications, and the list is sorted so the ones needing attention come first.
  - **success:** Filtering to one processor shows only that processor's applications. Stalled and expiring applications appear above clean ones.
- **CAP-3**
  - **intent:** A processor opens one application's checklist and updates a document's status, received date or notes.
  - **success:** A status change takes at most 2 clicks, appears immediately in the worklist counts and flags, and survives a server restart.
- **CAP-4**
  - **intent:** Users can see which documents are expired or expire within 30 days, on the document and rolled up to its application.
  - **success:** A document whose `expiration_date` is before the as-of date shows as Expired even if its stored status says otherwise. A document expiring within 30 days shows "expiring soon."
- **CAP-5**
  - **intent:** The tool flags applications that are stalled waiting on documents, which is the team's top pain point.
  - **success:** An application is flagged when it has at least one outstanding document and no document activity for 14 or more days, and the flag shows why (days idle, count outstanding).
- **CAP-6**
  - **intent:** The team lead gets a weekly pipeline summary for leadership and copies it as email-ready text, replacing the Monday hand-compiled email.
  - **success:** One click copies plain text containing totals by status, stalled applications, documents expiring soon or expired, and outstanding counts per processor. The numbers match the worklist.

## Constraints

- The whole assessment is capped at 4 hours, with roughly 2.5–3 hours for the build. When time runs short, cut scope rather than run over.
- The tool runs locally in a browser. A reviewer must get it running from the README in under 5 minutes with one setup command, and the CSV is bundled in the repo.
- Persistence is SQLite on a server, seeded from the CSV. The stack is in `stack.md`. Edits are shared and persistent, so state is not kept only in the browser.
- Users are non-technical, so the tool can be no harder to use than the spreadsheet. That means plain language, no jargon, and no configuration screens.
- The tool is standalone: no external APIs, email service or pre-existing database.
- It must ingest the provided CSV as-is. The CSV is flat, with one row per application and document, and its schema and quirks are in `data-profile.md`.
- The as-of date ("today") is one configurable value that defaults to 2026-02-15, because the sample data ends in Feb 2026. All expiry and stall checks use it, and the UI shows it.
- Document state rules: Approved and Not Required count as complete. Pending, Received, Under Review and Expired count as outstanding. A document is effectively Expired if its stored status is Expired or its `expiration_date` is before the as-of date.

## Non-goals

- Email alerts or any outbound notifications. They need email infrastructure the team doesn't have. This is V2.
- A charted or graphical leadership dashboard. The CAP-6 text summary covers the Monday need.
- Authentication, user accounts or roles.
- Deployment or hosting.
- Uploading or storing the document files themselves.
- Creating, closing or deleting applications, adding document rows, or editing the checklist template. V1 edits existing rows only.
- CSV export or re-import after the first seed.

## Success signal

- In a demo under 10 minutes with the sample data, a processor opens the tool and can name the stalled applications and the reason for each within 10 seconds. They update a document, and the worklist and weekly summary reflect the change right away. The team lead pastes the summary into an email unedited.
- A reviewer on a clean machine runs the app from the README in under 5 minutes.

## Assumptions

- The stall threshold is 14 days without document activity. Activity means the latest `date_received`, or the application date if no document has been received. The threshold is a single constant.
- The "expiring soon" window is 30 days.
- Applications have between 8 and 12 document rows. A document type that is absent from an application is not on that application's checklist and is not shown as missing.
- There is no login. Processors scope the view with a filter instead.
- Rows with status Expired but no `expiration_date` are kept as stored. There are 27 of them, on document types that don't expire.
