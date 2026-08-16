import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const readRepo = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");

function jobBlock(source: string, job: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) return "";
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("#1302 Academy demo permanent CI and guard routing", () => {
  it("routes the standalone Academy Playwright suite through a dedicated path-gated blocking job", () => {
    const workflow = readRepo(".github/workflows/ci.yml");
    const job = jobBlock(workflow, "playwright-academy-demo");
    const aggregate = jobBlock(workflow, "ci");

    expect(job).toContain("needs: changes");
    expect(job).toContain("if: needs.changes.outputs.code == 'true'");
    expect(job).toContain("pnpm --filter @ds/academy-demo build");
    expect(job).toContain(
      "pnpm --filter @ds/academy-demo exec playwright install --with-deps chromium",
    );
    expect(job).toContain("pnpm --filter @ds/academy-demo test:e2e:ci");
    expect(aggregate).toContain("playwright-academy-demo,");
    expect(aggregate).toContain(
      "playwright-academy-demo=${{ needs['playwright-academy-demo'].result }}",
    );
  });

  it.each([
    "interaction-states-lint.ts",
    "primitives-first-lint.ts",
    "aa-contrast-lint.ts",
    "form-error-lint.ts",
    "form-rhythm-lint.ts",
    "submit-pending-lint.ts",
  ])("includes Academy app TSX in %s", (guard) => {
    expect(readRepo(`tools/lint/${guard}`)).toContain(
      '"apps/academy-demo/app/**/*.tsx"',
    );
  });

  it("includes Academy app source in the no-stub guard", () => {
    expect(readRepo("tools/lint/no-stub-lint.ts")).toContain(
      '"apps/academy-demo/app/**/*.{ts,tsx,jsx}"',
    );
  });

  it("includes Academy source in external-anchor and route-target guards", () => {
    expect(readRepo("tools/lint/external-anchor-target-lint.ts")).toContain(
      '"apps/academy-demo/**/*.{ts,tsx}"',
    );
    expect(readRepo("tools/lint/route-target-lint.ts")).toContain(
      '"apps/academy-demo"',
    );
  });

  it.each(["registry-research-lint.ts", "stage-b-lint.ts"])(
    "treats Academy render changes as user-facing in %s",
    (guard) => {
      expect(readRepo(`tools/lint/${guard}`)).toContain("academy-demo");
    },
  );

  it("keeps Academy out of the production-surface manifest guard", () => {
    expect(readRepo("tools/lint/prod-surface-lint.ts")).not.toContain(
      "academy-demo",
    );
    expect(readRepo("tools/lint/prod-surface-manifest.yaml")).not.toContain(
      "academy-demo",
    );
  });
});
