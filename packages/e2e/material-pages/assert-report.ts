import { readFileSync } from "node:fs";
import { assertOperationalReport } from "../api-probes/operational-report.js";

assertOperationalReport(JSON.parse(readFileSync(process.argv[2]!, "utf8")), [
  "A failed material read offers a retry",
  "A draft material has no public page",
  "The doctor storefront shows nothing of the feed",
]);
console.log(
  "material-pages: 3 exact originals passed once; skips/flakes/retries=0/0/0",
);
