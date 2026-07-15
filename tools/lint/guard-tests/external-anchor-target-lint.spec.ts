import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/external-anchor-target-lint.ts` (#867). An
 * external-document anchor on a user-facing surface (`apps/portal`, `apps/admin`,
 * `packages/design-system/src`) must carry `target="_blank"` AND a `rel`
 * containing `noreferrer`/`noopener`. Covers the failure branch (the pre-#865
 * `webinar-page-content.tsx` shape — a `*Url` anchor with neither attribute), the
 * compliant path (attributes present, incl. a multi-line tag + a literal external
 * URL), the exempt path (in-app `<a href={route}>` / relative / `<Link>` /
 * `mailto:` / anchor-text inside a string literal), and the suppression hatch.
 */
const GUARD = "external-anchor-target-lint.ts";
const dir = (name: string) => caseDir("external-anchor", name);

describe("external-anchor-target-lint", () => {
  it("red: pre-#865 external *Url anchor missing target+rel → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-target-rel"));
    expect(code).toBe(1);
    expect(stderr).toContain("external-anchor");
  });

  it("green: compliant external anchors (target=_blank + rel) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-compliant"));
    expect(code).toBe(0);
  });

  it("green: in-app <a>/<Link>/relative/mailto + string-literal anchor text → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-internal-link"));
    expect(code).toBe(0);
  });

  it("green: a deliberate same-tab anchor with the external-anchor-ok marker → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-suppressed"));
    expect(code).toBe(0);
  });
});
