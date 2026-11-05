import { readFileSync } from "node:fs";
import {
  assertOperationalReport,
  operationalOriginals,
} from "./operational-report.js";
const [file, kind] = process.argv.slice(2);
if (!file || (kind !== "api" && kind !== "audit" && kind !== "materials"))
  throw new Error("Expected report path and api|audit|materials");
assertOperationalReport(
  JSON.parse(readFileSync(file, "utf8")),
  operationalOriginals[kind],
);
console.log(
  `${kind}: ${operationalOriginals[kind].length} exact originals passed once; skips/flakes/retries=0/0/0`,
);
