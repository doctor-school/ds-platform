import { readFileSync } from "node:fs";
import { assertPointsEngineReport } from "../lib/points-engine-report.js";

const file = process.argv[2];
if (!file) throw new Error("Expected the 025 originals JSON report path");
assertPointsEngineReport(JSON.parse(readFileSync(file, "utf8")));
console.log(
  "025: exactly 3 originals passed; failures/skips/flakes/retries=0/0/0/0",
);
