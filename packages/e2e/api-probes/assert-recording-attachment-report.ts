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
  `014: ${scope === "new" ? "3 legacy originals / 3 cases / 18" : "9 originals / 13 cases / 78"} Background groups; failures/skips/flakes/retries/errors=0`,
);
