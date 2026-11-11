import { readFileSync } from "node:fs";
import { assertRecordingAttachmentReport } from "../lib/recording-attachment-report.js";
const scope =
  process.argv[3] === "--display"
    ? "display"
    : process.argv[3] === "--invariants"
      ? "invariants"
      : process.argv[3] === "--new"
        ? "new"
        : "full";
if (
  process.argv[3] &&
  !["--new", "--invariants", "--display"].includes(process.argv[3])
)
  throw new Error("Unknown recording report scope");
assertRecordingAttachmentReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  scope,
);
console.log(
  `014: ${scope === "display" ? "3 display originals / 6 cases / 36" : scope === "invariants" ? "3 origin/routing originals / 4 cases / 24" : scope === "new" ? "3 backfill originals / 3 cases / 18" : "21 originals / 35 cases / 210"} Background groups; failures/skips/flakes/retries/errors=0`,
);
