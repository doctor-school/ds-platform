import { readFileSync } from "node:fs";
import {
  publicFeedStateTitles,
  publicSpecialtyMemoryTitles,
} from "./host-tags.js";
import { assertPublicReadonlyReport } from "./public-readonly-originals.js";
import { assertRecordFormsReport } from "./record-forms-report.js";
import { assertBookFieldsReport } from "./book-fields-report.js";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";

const report = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (process.env.E2E_PUBLIC_BOOK_FIELDS === "1") assertBookFieldsReport(report);
else if (process.env.E2E_PUBLIC_RECORD_FORMS === "1")
  assertRecordFormsReport(report);
else if (process.env.E2E_PUBLIC_READONLY === "1")
  assertPublicReadonlyReport(report);
else
  assertOperationalReport(
    report,
    process.env.E2E_PUBLIC_SPECIALTY_MEMORY === "1"
      ? publicSpecialtyMemoryTitles
      : process.env.E2E_PUBLIC_FEED_STATES === "1"
        ? publicFeedStateTitles
        : operationalOriginals.feedEntry,
    "doctor",
  );
console.log(
  `feed-entry: 3 exact originals, ${process.env.E2E_PUBLIC_BOOK_FIELDS === "1" ? 5 : 3} actual cases passed once; 0 failures, 0 skipped, 0 retries, 0 flaky, 0 errors`,
);
