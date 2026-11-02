# Sample Data Profile

This profiles `NEWITY_Sample_Data_A_Document_Checklist.csv`: 620 rows plus a header, covering 60 applications. Each row is one application and one document.

## Columns

| Column | Notes |
|---|---|
| `application_id` | Example `APP-2026-1001`. The application-level columns below repeat on every row of an application and are consistent within it. |
| `business_name`, `borrower_name` | Never blank. |
| `loan_amount` | Integer from 80,000 to 500,000. |
| `application_date` | Format `M/D/YYYY`, from Sep 2025 to 2026-01-29. |
| `assigned_processor` | One of Ricardo Fuentes (253 rows), Aisha Patel (186) or Janet Morrison (181). |
| `document_type` | One of the 12 values in the table below. Each application has 8–12 rows, with no duplicate application and document pairs. |
| `document_status` | One of the 6 values listed under Statuses below. |
| `date_received` | Format `M/D/YYYY`. Blank on 209 rows, exactly the Pending and Not Required ones. Range 2025-07-18 to 2026-02-12. |
| `expiration_date` | Format `M/D/YYYY`. Blank on 483 rows. Range 2025-10-16 to 2029-02-11. |
| `notes` | Free text. Blank on 448 rows. Common values include "Document expired - replacement requested", "Waiting on borrower" and "Waived per SBA guidelines". |

All dates parse correctly. No required field is blank.

## Document types and expiry rules

The rule is `expiration_date − date_received`, and the data matches it exactly.

| Document type | Expires after |
|---|---|
| Personal Tax Returns (3yr) | 1,095 days (3 years) |
| Business Tax Returns (3yr) | 1,095 days (3 years) |
| Bank Statements (90 day) | 90 days |
| Insurance Verification | 365 days. This one isn't in the brief and comes only from the data. |
| SBA Form 1919, SBA Form 912, Lease Agreement, Business Financial Statements, Articles of Incorporation, Debt Schedule, Business Licenses & Permits, Ownership Verification | Never |

## Statuses

Pending 183 · Received 160 · Approved 121 · Under Review 93 · Expired 37 · Not Required 26.

## Quirks the build must tolerate

- 27 rows have status Expired but no `expiration_date`, and they're on document types that never expire, such as Articles of Incorporation. Keep the stored status.
- 4 rows are past their `expiration_date` as of 2026-02-15 but are not marked Expired. The derived-expiry rule in SPEC Constraints covers them.
- No application has every document complete, so every application has outstanding items.
- Dates are in non-ISO `M/D/YYYY` format, so normalize them on seed. Don't compare them as strings.
