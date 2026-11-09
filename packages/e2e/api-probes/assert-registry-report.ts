import { readFileSync } from "node:fs";
import { assertRegistryContractsReport } from "../lib/registry-contracts-report.js";

const file = process.argv[2];
if (!file) throw new Error("Expected the actual registry-original report path");
assertRegistryContractsReport(JSON.parse(readFileSync(file, "utf8")));
console.log(
  "registry-contracts: exact3 passed once, nine Background groups; skips/flakes/retries/errors=0",
);
