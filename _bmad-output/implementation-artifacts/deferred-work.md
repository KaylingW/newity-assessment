- source_spec: none
  summary: Build CAP-6, the weekly pipeline summary the team lead copies as email-ready text (totals by status, stalled apps, expiring/expired docs, outstanding per processor).
  evidence: Split from the SBA checklist V1 build because it ships independently and reads from the CAP-1–5 core tracker; user chose to build the core first.
- source_spec: `_bmad-output/implementation-artifacts/spec-sba-doc-checklist-core.md`
  summary: Add tests for `readAsOfDate` in `src/lib/config.ts` (valid override, `2026-02-30`, `2/15/2026` fall back to the default with a warning).
  evidence: Verification-gap review found no test sets `AS_OF_DATE`; weakening the ISO check would silently corrupt every expiry and stall flag. Needs the parser exported or a module-reload test.
- source_spec: `_bmad-output/implementation-artifacts/spec-row-editor-and-e2e-tests.md`
  summary: When a save fails because the server can't be reached, `DocumentRowEditor` keeps showing the unsaved status or received date instead of putting it back, so the row looks saved apart from the error line.
  evidence: The `catch` branch in `send()` in `src/components/DocumentRowEditor.tsx` resets only `sentNotes`, while the 400 branch reverts status and date. Found by the edge-case review of the editor tests; this is existing behaviour, so it was left out of the test-only change.
