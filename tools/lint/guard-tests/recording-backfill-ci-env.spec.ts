import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Same bounded line scan as workflow-warn-posture: no undeclared YAML dependency.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(
  resolve(root, ".github/workflows/ci.yml"),
  "utf8",
);
const job = workflow.split("\n  admin-e2e:\n")[1]!.split(/\n {2}[\w-]+:/)[0]!;
function env(block: string, indentation: number) {
  return Object.fromEntries(
    [
      ...block.matchAll(
        new RegExp(`^ {${indentation}}([A-Z][A-Z_0-9]+):[ \\t]*(.+)$`, "gm"),
      ),
    ].map((m) => [m[1], m[2]]),
  );
}
const shared = env(job.split("\n    steps:")[0]!, 6);
function effective(name: string) {
  const block = job.split(`      - name: ${name}\n`)[1]!.split(/\n {6}- /)[0]!;
  return { ...shared, ...env(block, 10) };
}
it("014 EARS-29: the API and backfill CLI receive the same explicit fail-closed boot inputs", () => {
  const api = effective("Start the api"),
    cli = effective("Recording attachment originals on Academy");
  for (const key of [
    "AUDIT_IDENTIFIER_PEPPER",
    "LIFECYCLE_IMPACT_TOKEN_SECRET",
  ]) {
    expect(api[key], `API ${key}`).toBeTruthy();
    expect(cli[key], `CLI ${key}`).toBe(api[key]);
  }
});
