import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  API_COPY_ALLOWLIST,
  classifyChangeTier,
  isEnvironmentSensitivePath,
  isNonRuntimePath,
  normalizeTierFiles,
  parseDeclaredTier,
  resolveTier,
  type ChangeTierFile,
} from "../lib/change-tier";
import { runGuard } from "./run-guard";

const mod = (path: string, additions = 2, deletions = 2): ChangeTierFile => ({
  path,
  status: "modified",
  additions,
  deletions,
});
const copy = mod("apps/doctor/messages/ru.json");
const SHIP = "Change-tier: ship — date substitution in the promo copy";

describe("change-tier classifier (#2584)", () => {
  it("an Ask path forces minimum ask", () => {
    for (const path of [
      "packages/db/src/schema/users.ts",
      "apps/api/src/auth/auth.service.ts",
      "tools/lint/foo.ts",
      ".github/workflows/ci.yml",
      "apps/doctor/package.json",
      "apps/doctor/next.config.ts",
      "apps/doctor/middleware.ts",
      "apps/api/drizzle/0048_event_kinds.sql",
      "apps/docs/content/specs/features/001-x/001-design.md",
      "AGENTS.md",
    ])
      expect(classifyChangeTier([copy, mod(path)]).minimum, path).toBe("ask");
  });

  it("a renamed file's old path is checked too", () => {
    expect(
      classifyChangeTier([
        {
          ...mod("apps/doctor/lib/x.ts"),
          status: "renamed",
          previousPath: "packages/schemas/src/x.ts",
        },
      ]).minimum,
    ).toBe("ask");
  });

  it("an added, removed or renamed non-test file ⇒ show", () => {
    for (const status of ["added", "removed", "renamed"])
      expect(classifyChangeTier([{ ...copy, status }]).minimum, status).toBe(
        "show",
      );
  });

  it("size cap: 80 changed lines is ship, 81 is show", () => {
    expect(
      classifyChangeTier([mod("apps/doctor/messages/ru.json", 40, 40)]).minimum,
    ).toBe("ship");
    expect(
      classifyChangeTier([mod("apps/doctor/messages/ru.json", 41, 40)]).minimum,
    ).toBe("show");
  });

  it("tests and changesets are excluded from the cap and may be added", () => {
    expect(
      classifyChangeTier([
        mod("apps/doctor/messages/ru.json", 40, 40),
        { ...mod("apps/doctor/app/page.test.tsx", 300, 0), status: "added" },
        { ...mod(".changeset/quiet-fox.md", 5, 0), status: "added" },
        mod("apps/doctor/e2e/promo.spec.ts", 100, 100),
      ]).minimum,
    ).toBe("ship");
  });

  it("the apps/api email copy allowlist is ship-eligible", () => {
    for (const path of API_COPY_ALLOWLIST)
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe("ship");
    expect(
      classifyChangeTier([mod("apps/api/src/mailer/smtp-mailer.ts")]).minimum,
    ).toBe("ask");
  });

  it("ship is an allowlist: server, route, auth, proxy and procedure paths never ship", () => {
    const expected: Record<string, "show" | "ask"> = {
      "apps/doctor/proxy.ts": "ask",
      "packages/auth-flow/src/server/session.ts": "show",
      "packages/auth-flow/src/server/auth-route-guard.ts": "show",
      "packages/auth-flow/src/return-target.ts": "show",
      "apps/portal/app/academy-partnership-action.ts": "show",
      "packages/events-storefront/src/server/register-action.ts": "show",
      "apps/admin/lib/admin-auth.ts": "show",
      "apps/docs/content/agent-discipline.md": "ask",
      "packages/congress-submissions/src/model/model.ts": "show",
      "apps/portal/app/foo/page.tsx": "show",
      "apps/portal/app/foo/route.ts": "show",
      "apps/doctor/instrumentation.ts": "show",
      "packages/events-storefront/src/server/card.tsx": "show",
      "apps/portal/lib/shell-auth.ts": "show",
    };
    for (const [path, minimum] of Object.entries(expected))
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe(minimum);
  });

  it("ship accepts UI source, copy modules, the email allowlist and plain product docs", () => {
    for (const path of [
      "packages/congress-submissions/src/copy.ts",
      "packages/congress-submissions/src/ui/submission-detail.tsx",
      "packages/auth-flow/src/ui/login-form.tsx",
      "packages/events-storefront/src/storefront-copy.ts",
      "packages/events-storefront/src/copy/ru.ts",
      "apps/api/src/mailer/notice-emails.ts",
      "apps/doctor/components/hero.tsx",
      "apps/docs/content/product/glossary/pul.md",
    ])
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe("ship");
  });

  it("an empty or incomplete file set is ask", () => {
    expect(classifyChangeTier([]).minimum).toBe("ask");
    expect(classifyChangeTier([copy], 2).minimum).toBe("ask");
  });
});

describe("change-tier declaration (#2584)", () => {
  it("parses ship/show/ask case-insensitively with a reason", () => {
    expect(parseDeclaredTier(SHIP)).toBe("ship");
    expect(parseDeclaredTier("Change-tier: SHOW - new badge state")).toBe(
      "show",
    );
    expect(parseDeclaredTier("Change-tier: ask")).toBe("ask");
  });

  it("absent or malformed declarations are ask", () => {
    for (const body of [
      "",
      "Change-tier: ship",
      "Change-tier: ship — TBD",
      "Change-tier: shipit — copy",
      "Change-tier: fast — copy",
      `${SHIP}\nChange-tier: show — twice`,
    ])
      expect(parseDeclaredTier(body), body).toBe("ask");
  });

  it("a declaration below the minimum resolves to BLOCK", () => {
    expect(resolveTier(SHIP, [mod("packages/db/x.ts")])).toMatchObject({
      declared: "ship",
      minimum: "ask",
      effective: null,
    });
    expect(resolveTier(SHIP, [copy]).effective).toBe("ship");
    expect(resolveTier("", [copy]).effective).toBe("ask");
  });

  it("normalises gh pr view and REST file shapes alike", () => {
    expect(
      normalizeTierFiles([
        { path: "a.tsx", additions: 1, deletions: 0, changeType: "MODIFIED" },
        {
          filename: "b.tsx",
          status: "renamed",
          additions: 0,
          deletions: 0,
          previous_filename: "c.tsx",
        },
      ]),
    ).toEqual([
      { path: "a.tsx", status: "modified", additions: 1, deletions: 0 },
      {
        path: "b.tsx",
        status: "renamed",
        additions: 0,
        deletions: 0,
        previousPath: "c.tsx",
      },
    ]);
  });
});

describe("change-tier guard (#2584)", () => {
  const dirs: string[] = [];
  afterAll(() =>
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
  );
  function run(body: string, files: Record<string, unknown>[]) {
    const root = mkdtempSync(join(tmpdir(), "change-tier-"));
    dirs.push(root);
    const gh = join(root, "gh");
    mkdirSync(gh);
    writeFileSync(
      join(gh, "pr-view-2584.json"),
      JSON.stringify({ number: 2584, body, changedFiles: files.length, files }),
    );
    return runGuard("change-tier-lint.ts", root, {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "2584",
        PR_BODY: body,
        LINT_GH_FIXTURE_DIR: gh,
      },
    });
  }
  const ghCopy = {
    path: "apps/doctor/messages/ru.json",
    additions: 2,
    deletions: 2,
    changeType: "MODIFIED",
  };

  it("passes a verified ship declaration", () => {
    const { code, stdout } = run(SHIP, [ghCopy]);
    expect(code).toBe(0);
    expect(stdout).toContain("tier ship (minimum ship)");
  });

  it("passes an undeclared PR as ask", () => {
    const { code, stdout } = run("", [
      { ...ghCopy, path: "packages/db/src/x.ts" },
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("tier ask (minimum ask)");
  });

  it("blocks a declaration below the minimum, naming the reasons", () => {
    const { code, stderr } = run(SHIP, [
      { ...ghCopy, path: "packages/db/src/x.ts" },
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("require at least ask");
    expect(stderr).toContain("ask path: packages/db/src/x.ts");
  });
});

describe("#2699: evidence captures and non-runtime / environment-sensitive paths", () => {
  it("`.github/ui-evidence/**` is evidence, not CI config: it no longer raises the minimum", () => {
    const evidence: ChangeTierFile = {
      path: ".github/ui-evidence/2699/after.png",
      status: "added",
      additions: 0,
      deletions: 0,
    };
    expect(classifyChangeTier([copy, evidence]).minimum).toBe("ship");
    expect(
      classifyChangeTier([copy, mod(".github/workflows/ci.yml")]).minimum,
    ).toBe("ask");
  });
  it("non-runtime = tests, changesets, ui-evidence captures, docs content and .feature files", () => {
    for (const path of [
      "apps/portal/src/app/room/header.test.tsx",
      "apps/portal/e2e/room.spec.ts",
      ".changeset/room.md",
      ".github/ui-evidence/2699/after.png",
      "apps/docs/content/specs/features/001-x/001-design.md",
      "apps/docs/content/adr/0001-x.md",
      "apps/docs/content/skills/x/SKILL.md",
      "apps/docs/content/product/glossary/x.mdx",
      "apps/docs/content/specs/features/001-x/room.feature",
    ])
      expect(isNonRuntimePath(path), path).toBe(true);
    for (const path of [
      "apps/portal/src/app/room/header.tsx",
      "apps/api/src/mailer/notice-emails.ts",
      ".github/workflows/ci.yml",
      "apps/docs/app/page.tsx",
      "AGENTS.md",
    ])
      expect(isNonRuntimePath(path), path).toBe(false);
  });
  it("environment-sensitive = auth paths, migrations, infra, the mailer, IdP/captcha tooling", () => {
    for (const path of [
      // auth: every path the change-tier auth rules match + the auth pages
      "apps/portal/lib/shell-auth.ts",
      "apps/doctor/lib/auth-flow-client.ts",
      "apps/api/src/auth/auth.service.ts",
      "apps/api/src/authz/roles.guard.ts",
      "packages/auth-flow/src/login/login-form.tsx",
      "packages/schemas/src/auth/login.ts",
      "apps/portal/app/login/page.tsx",
      "apps/portal/app/verify/verify-form.tsx",
      "apps/doctor/app/(auth)/register/page.tsx",
      "apps/admin/app/mfa/enroll/page.tsx",
      // request routing in front of every page
      "apps/portal/middleware.ts",
      "apps/doctor/proxy.ts",
      // schema: the real migration layout + the Drizzle schema
      "apps/api/drizzle/0048_event_kinds.sql",
      "apps/api/drizzle/meta/0048_snapshot.json",
      "packages/db/src/schema/users.ts",
      // infra, mail, IdP, captcha / bot protection
      "infra/deploy/zitadel.env.example",
      "infra/dev-stand/idp/provision.sh",
      "apps/api/src/mailer/notice-emails.ts",
      "tools/staging/idp.mjs",
      "tools/deploy/idp-policy.mjs",
      "packages/db/src/seed/golden/idp.ts",
      "apps/api/src/bot-protection/bot-protection.guard.ts",
      "apps/portal/components/captcha-widget.tsx",
    ])
      expect(isEnvironmentSensitivePath(path), path).toBe(true);
    for (const path of [
      "apps/portal/app/room/header.tsx",
      "packages/design-system/src/ui/button.tsx",
      "apps/portal/app/room/header.test.tsx",
      "apps/portal/middleware.test.ts",
    ])
      expect(isEnvironmentSensitivePath(path), path).toBe(false);
  });
});
