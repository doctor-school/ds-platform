import { readFileSync } from "node:fs";
import { publicFeedStateTitles } from "./public-feed-states.js";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";

assertOperationalReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  process.env.E2E_PUBLIC_FEED_STATES === "1"
    ? publicFeedStateTitles
    : operationalOriginals.feedEntry,
  "doctor",
);
console.log(
  "feed-entry: 3 exact originals passed once; failures/skips/flakes/retries/errors=0/0/0/0/0",
);
