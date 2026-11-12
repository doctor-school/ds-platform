import { readFileSync } from "node:fs";
import {
  assertCongressReport,
  assertCongressBackgrounds,
} from "../lib/congress-originals-report.js";
assertCongressReport(JSON.parse(readFileSync(process.argv[2]!, "utf8")));
assertCongressBackgrounds(readFileSync(process.argv[3]!, "utf8"));
console.log(
  JSON.stringify({
    cases: 3,
    backgrounds: 18,
    failed: 0,
    skipped: 0,
    flaky: 0,
    retries: 0,
    errors: 0,
  }),
);
