import { readFileSync } from "node:fs";
import {
  assertOperationalReport,
  operationalOriginals,
} from "./operational-report.js";
const kinds = ["api", "audit", "materials", "materialJourneys"] as const;
type Kind = (typeof kinds)[number];
const [file, kind] = process.argv.slice(2);
if (!file || !kinds.includes(kind as Kind))
  throw new Error(`Expected report path and ${kinds.join("|")}`);
const expected = operationalOriginals[kind as Kind];
assertOperationalReport(JSON.parse(readFileSync(file, "utf8")), expected);
console.log(
  `${kind}: ${expected.length} exact originals passed once; skips/flakes/retries=0/0/0`,
);
