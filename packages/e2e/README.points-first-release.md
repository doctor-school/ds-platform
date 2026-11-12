# 025 first event, partial release and phone eligibility

Issue #3983 adds only the original scenarios at baseline 025:17/90/253, selected
by @points-first-release. Native compiled points.record, prices and ledger services
run against the explicitly owned ds_dev_3983 database (CI: ds_test).
The verified doctor/specialty Background precedes engine intake, preserving the
first scenario's no-account Given. No account or immutable fact is deleted.

Run bddgen and Playwright with points-first-release.config.ts; set DATABASE_URL,
E2E_POINTS_DATABASE, E2E_POINTS_OPS_LOG, E2E_POINTS_REPORT and
E2E_POINTS_RESOURCE_REPORT to owned targets. Check the report with
api-probes/assert-points-engine-report.ts <report> --first-release.
The strict checker requires exactly three originals and six ordered Background
receipts, no skips, retries, flaky outcomes or errors. The full engine config
retains the previous twenty-one originals and requires all twenty-four.

FIFO is established through genuine sequential commits and asserted stored
opened_at values. Cancellation is recorded-fact engine acceptance only; the
actual producer remains deferred in #3884. Phone state is an eligibility Given,
with no OTP, login or provider journey. Full independent table snapshots include
orphan keys/postings and system settlement legs. Resources are captured before
closing each runtime; the lead accepts proof before owned cleanup. Existing
native suites remain complements; no app-local tests were removed.

Each scenario retires only its owned events through the shared soft-retirement
helper. The resource receipt retains the events and verifies their retired and
soft-deleted state, while all six financial tables and owned prices remain
unchanged. The strict checker requires these receipts for both the narrow and
full runs so test events cannot pollute later event-feed checks.
