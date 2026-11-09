import { readFileSync } from "node:fs";
import { assertRecordingAttachmentReport } from "../lib/recording-attachment-report.js";
assertRecordingAttachmentReport(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")),
);
console.log(
  "014: 3 originals / 4 cases / 24 Background groups; failures/skips/flakes/retries/errors=0",
);
