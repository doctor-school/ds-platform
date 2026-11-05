import { readFileSync } from "node:fs";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";

assertOperationalReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  operationalOriginals.feedEntry,
);
console.log(
  "feed-entry: 3 exact originals passed once; failures/skips/flakes/retries/errors=0/0/0/0/0",
);
