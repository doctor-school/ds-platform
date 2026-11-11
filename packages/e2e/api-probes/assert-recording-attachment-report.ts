import { readFileSync } from "node:fs";
import { assertRecordingAttachmentReport } from "../lib/recording-attachment-report.js";
const scope = process.argv[3] === "--new" ? "new" : "full";
if (process.argv[3] && process.argv[3] !== "--new")
  throw new Error("Unknown recording report scope");
assertRecordingAttachmentReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
  scope,
);
console.log(
  `014: ${scope === "new" ? "3 boundary originals / 9 cases / 54" : "12 originals / 22 cases / 132"} Background groups; failures/skips/flakes/retries/errors=0`,
);
