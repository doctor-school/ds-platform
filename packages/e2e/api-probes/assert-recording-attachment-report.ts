import { readFileSync } from "node:fs";
import { assertRecordingAttachmentReport } from "../lib/recording-attachment-report.js";
const scope =
  process.argv[3] === "--invariants"
    ? "invariants"
    : process.argv[3] === "--new"
      ? "new"
      : "full";
if (process.argv[3] && !["--new", "--invariants"].includes(process.argv[3]))
  throw new Error("Unknown recording report scope");
assertRecordingAttachmentReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  scope,
);
console.log(
  `014: ${scope === "invariants" ? "3 origin/routing originals / 4 cases / 24" : scope === "new" ? "3 backfill originals / 3 cases / 18" : "18 originals / 29 cases / 174"} Background groups; failures/skips/flakes/retries/errors=0`,
);
