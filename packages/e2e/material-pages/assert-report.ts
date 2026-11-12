import { readFileSync } from "node:fs";
import { assertOperationalReport } from "../api-probes/operational-report.js";

const ORIGINALS = [
  "A visitor moves the rail and older materials load near its end",
  "The keyboard moves the rail one card at a time",
  "Nothing in the rail moves by itself",
  "A failed next page keeps the loaded cards",
  "The first feed page shows placeholders while it loads",
  "The empty feed says so honestly",
  "The feed read fails and retries",
  "A failed material read offers a retry",
  "A draft material has no public page",
  "The doctor storefront shows nothing of the feed",
];

assertOperationalReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  ORIGINALS,
);
console.log(
  `material-pages: ${ORIGINALS.length} exact originals passed once; skips/flakes/retries=0/0/0`,
);
