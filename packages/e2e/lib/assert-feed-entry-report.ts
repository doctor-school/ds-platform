import { readFileSync } from "node:fs";
import {
  publicFeedStateTitles,
  publicSpecialtyMemoryTitles,
} from "./host-tags.js";
import { assertPublicReadonlyReport } from "./public-readonly-originals.js";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";

const report = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (process.env.E2E_PUBLIC_READONLY === "1") assertPublicReadonlyReport(report);
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
  "feed-entry: 3 exact originals passed once; failures/skips/flakes/retries/errors=0/0/0/0/0",
);
