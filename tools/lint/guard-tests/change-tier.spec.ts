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

  it("ship is an allowlist: server, route, auth, proxy and procedure paths never ship (auth / route / action are ask, #2808)", () => {
    const expected: Record<string, "show" | "ask"> = {
      "apps/doctor/proxy.ts": "ask",
      "packages/auth-flow/src/server/session.ts": "ask",
      "packages/auth-flow/src/server/auth-route-guard.ts": "ask",
      "packages/auth-flow/src/return-target.ts": "ask",
      "apps/portal/app/academy-partnership-action.ts": "ask",
      "packages/events-storefront/src/server/register-action.ts": "ask",
      "apps/admin/lib/admin-auth.ts": "ask",
      "apps/docs/content/agent-discipline.md": "ask",
      "packages/congress-submissions/src/model/model.ts": "show",
      "apps/portal/app/foo/page.tsx": "show",
      "apps/portal/app/foo/route.ts": "ask",
      "apps/doctor/instrumentation.ts": "show",
      "packages/events-storefront/src/server/card.tsx": "show",
      "apps/portal/lib/shell-auth.ts": "ask",
    };
    for (const [path, minimum] of Object.entries(expected))
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe(minimum);
  });

  it("ship accepts UI source, copy modules, the email allowlist and plain product docs", () => {
    for (const path of [
      "packages/congress-submissions/src/copy.ts",
      "packages/congress-submissions/src/ui/submission-detail.tsx",
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

describe("#2807: test-only class, docs follow the code, wider Ship allowlist", () => {
  const added = (path: string): ChangeTierFile => ({
    ...mod(path),
    status: "added",
  });
  const feature = (patch?: string, status = "modified"): ChangeTierFile => ({
    ...mod("apps/docs/content/specs/features/003-x/003-scenarios.feature"),
    status,
    ...(patch === undefined ? {} : { patch }),
  });
  const TAG_ONLY_PATCH = [
    "@@ -339,7 +339,9 @@ Feature: Net-new web authentication",
    "     # status/body and interleaved triad median timing.",
    " ",
    "-  @EARS-34 @EARS-16 @happy",
    "+  @EARS-34 @EARS-16 @EARS-41 @happy @verified-login-email-code",
    "   Scenario: A login-email-code request arms the challenge unchanged",
    "+    # Retained native challenge proof: apps/api/src/auth/idp/x.spec.ts",
    "+",
  ].join("\n");
  const STEP_TEXT_PATCH = [
    "@@ -340,3 +340,3 @@",
    "   Scenario: A login-email-code request arms the challenge unchanged",
    "-    Given a verified doctor_guest user",
    "+    Given a uniquely registered and verified Academy account",
  ].join("\n");

  it("EARS-1: test-only PRs (packages/e2e, apps/api/test, other test paths) are the test-only ship class", () => {
    for (const files of [
      [mod("packages/e2e/tests/auth/login-otp.spec.ts", 200, 40)],
      [added("packages/e2e/tests/support/academy-mail.ts")],
      [mod("apps/api/test/auth/login-otp.e2e-spec.ts", 120, 3)],
      [mod("apps/api/test/support/mail-capture.ts")],
      [added("packages/db/src/schema/users.spec.ts")],
      [mod("apps/api/src/auth/auth.service.spec.ts"), mod(".changeset/x.md")],
    ]) {
      const result = classifyChangeTier(files);
      expect(result.minimum, files[0].path).toBe("ship");
      expect(result.testOnly, files[0].path).toBe(true);
    }
  });

  it("EARS-1: a .feature edit that changes only tags, comments or blank lines is a test", () => {
    const result = classifyChangeTier([
      feature(TAG_ONLY_PATCH),
      mod("packages/e2e/tests/auth/login-otp.spec.ts"),
    ]);
    expect(result.minimum).toBe("ship");
    expect(result.testOnly).toBe(true);
  });

  it("EARS-1: a .feature edit that changes scenario text stays ask (spec change)", () => {
    for (const patch of [
      STEP_TEXT_PATCH,
      "@@ -1 +1 @@\n-Feature: Old\n+Feature: New",
      "@@ -9 +9 @@\n-  Scenario: Old title\n+  Scenario: New title",
      "@@ -9 +9 @@\n-      | a | b |\n+      | a | c |",
    ]) {
      const result = classifyChangeTier([
        feature(patch),
        mod("packages/e2e/tests/auth/login-otp.spec.ts"),
      ]);
      expect(result.minimum, patch).toBe("ask");
      expect(result.testOnly ?? false).toBe(false);
    }
  });

  it("EARS-1: a tag edit touching an @host: tag selects CI projects — ask", () => {
    for (const patch of [
      "@@ -9 +9 @@\n-  @EARS-1 @happy\n+  @EARS-1 @happy @host:doctor",
      "@@ -9 +9 @@\n-  @EARS-1 @host:academy\n+  @EARS-1",
      "@@ -9 +9 @@\n-  @EARS-1 @host:academy\n+  @EARS-1 @host:doctor",
      // moved from one scenario to another: the patch-wide set is unchanged
      "@@ -9,3 +9,3 @@\n-  @EARS-1 @host:admin\n+  @EARS-1\n   Scenario: One\n@@ -20,3 +20,3 @@\n-  @EARS-2\n+  @EARS-2 @host:admin\n   Scenario: Two",
    ])
      expect(classifyChangeTier([feature(patch)]).minimum, patch).toBe("ask");
    expect(
      classifyChangeTier([
        feature(
          "@@ -9 +9 @@\n-  @EARS-1 @host:doctor @host:academy\n+  @host:academy @EARS-1 @EARS-2 @host:doctor",
        ),
      ]).testOnly,
    ).toBe(true);
  });

  it("EARS-1: `# language:` and `#` lines inside a doc string are not comments — ask", () => {
    for (const patch of [
      "@@ -1 +1 @@\n-# language: en\n+# language: ru",
      '@@ -20,4 +20,4 @@\n     """\n-    # heading\n+    # other heading\n     """',
      '@@ -20,3 +20,3 @@\n     """\n     body\n-    # heading\n+    # other heading',
      '@@ -19,4 +19,4 @@\n     Given the mail body\n     """\n-    # heading\n+    # other heading',
    ])
      expect(classifyChangeTier([feature(patch)]).minimum, patch).toBe("ask");
    expect(
      classifyChangeTier([
        feature(
          '@@ -19,6 +19,7 @@\n     Given the mail body\n     """\n     body\n     """\n+    # a real comment',
        ),
      ]).testOnly,
    ).toBe(true);
  });

  it("EARS-1: a spec .feature without a patch, or added, stays ask (text unproven / new spec)", () => {
    expect(classifyChangeTier([feature()]).minimum).toBe("ask");
    expect(classifyChangeTier([feature(TAG_ONLY_PATCH, "added")]).minimum).toBe(
      "ask",
    );
  });

  it("EARS-1: CI / config / dependency files stay ask even when they look like tests", () => {
    for (const path of [
      "tools/lint/guard-tests/change-tier.spec.ts",
      "packages/e2e/package.json",
      "packages/e2e/playwright.config.ts",
      ".github/workflows/e2e.yml",
    ])
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe("ask");
  });

  it("EARS-1: a test change alongside runtime code is not test-only", () => {
    const result = classifyChangeTier([
      copy,
      mod("apps/doctor/e2e/home.spec.ts"),
    ]);
    expect(result.minimum).toBe("ship");
    expect(result.testOnly ?? false).toBe(false);
  });

  it("EARS-2: a modified ADR or skill alongside code still forces ask", () => {
    for (const path of [
      "apps/docs/content/adr/0013-x.md",
      "apps/docs/content/skills/x/SKILL.md",
    ]) {
      const result = classifyChangeTier([copy, mod(path)]);
      expect(result.minimum, path).toBe("ask");
      expect(result.reasons, path).toContain(`ask path: ${path}`);
    }
  });

  it("EARS-2: a modified spec doc follows the code's tier", () => {
    for (const path of [
      "apps/docs/content/specs/features/001-x/001-design.md",
      "apps/docs/content/specs/features/001-x/001-requirements.md",
    ]) {
      expect(classifyChangeTier([copy, mod(path, 60, 40)]).minimum, path).toBe(
        "ship",
      );
      expect(
        classifyChangeTier([mod("apps/portal/lib/x.ts"), mod(path)]).minimum,
        path,
      ).toBe("show");
      expect(
        classifyChangeTier([mod("apps/api/src/x.ts"), mod(path)]).minimum,
        path,
      ).toBe("ask");
    }
  });

  it("EARS-2: an added spec / ADR / skill, a docs-only change, or instruction files stay ask", () => {
    const spec = "apps/docs/content/specs/features/001-x/001-design.md";
    expect(classifyChangeTier([copy, added(spec)]).minimum).toBe("ask");
    expect(classifyChangeTier([mod(spec)]).minimum).toBe("ask");
    expect(
      classifyChangeTier([mod(spec), mod("apps/portal/e2e/x.spec.ts")]).minimum,
    ).toBe("ask");
    expect(
      classifyChangeTier([
        copy,
        { ...mod(spec), status: "renamed", previousPath: `${spec}.old` },
      ]).minimum,
    ).toBe("ask");
    for (const path of [
      "AGENTS.md",
      "CLAUDE.md",
      "apps/docs/content/agent-discipline.md",
      ".claude/rules/change-tiers.md",
    ])
      expect(classifyChangeTier([copy, mod(path)]).minimum, path).toBe("ask");
  });

  it("EARS-3: DEBT.md and package / module README.md are on the Ship allowlist", () => {
    for (const path of [
      "DEBT.md",
      "packages/design-system/README.md",
      "apps/portal/README.md",
      "apps/api/src/auth/README.md",
      "packages/db/README.md",
    ])
      expect(classifyChangeTier([copy, mod(path)]).minimum, path).toBe("ship");
    for (const path of [
      "packages/design-system/design-source/README.md",
      "apps/docs/content/specs/product/x/README.md",
    ])
      expect(classifyChangeTier([mod(path)]).minimum, path).toBe("ask");
  });

  it("EARS-3: .feature has one status — non-runtime, a test when its text is unchanged", () => {
    expect(isNonRuntimePath(feature().path)).toBe(true);
    expect(classifyChangeTier([feature(TAG_ONLY_PATCH)]).testOnly).toBe(true);
  });

  it("normalises the REST patch onto the tier file", () => {
    expect(
      normalizeTierFiles([
        {
          filename: "a.feature",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-@a\n+@b",
        },
      ]),
    ).toEqual([
      {
        path: "a.feature",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-@a\n+@b",
      },
    ]);
  });
});

describe("#2807: change-tier guard reads .feature patches", () => {
  const dirs: string[] = [];
  afterAll(() =>
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
  );
  const path = "apps/docs/content/specs/features/003-x/003-scenarios.feature";
  function run(body: string, patch: string) {
    const root = mkdtempSync(join(tmpdir(), "change-tier-"));
    dirs.push(root);
    const gh = join(root, "gh");
    mkdirSync(gh);
    const files = [
      { path, additions: 1, deletions: 1, changeType: "MODIFIED" },
    ];
    writeFileSync(
      join(gh, "pr-view-2807.json"),
      JSON.stringify({ number: 2807, body, changedFiles: 1, files }),
    );
    writeFileSync(
      join(gh, "pr-files-2807.json"),
      JSON.stringify([
        [
          {
            filename: path,
            status: "modified",
            additions: 1,
            deletions: 1,
            patch,
          },
        ],
      ]),
    );
    return runGuard("change-tier-lint.ts", root, {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "2807",
        PR_BODY: body,
        LINT_GH_FIXTURE_DIR: gh,
      },
    });
  }
  const TEST_ONLY = "Change-tier: ship — test-only: binds 003 steps";

  it("passes a test-only ship declaration over a tag-only .feature edit", () => {
    const { code, stdout } = run(TEST_ONLY, "@@ -1 +1 @@\n-  @a\n+  @a @b");
    expect(code).toBe(0);
    expect(stdout).toContain("tier ship (minimum ship, test-only)");
  });

  it("blocks ship when the .feature scenario text changed", () => {
    const { code, stderr } = run(
      TEST_ONLY,
      "@@ -1 +1 @@\n-    Given a\n+    Given b",
    );
    expect(code).toBe(1);
    expect(stderr).toContain("scenario text");
  });
});

describe("#2808: auth, server endpoints and server actions are Ask paths", () => {
  const AUTH_SERVER = [
    "packages/auth-flow/src/flow/login.ts",
    "apps/portal/lib/auth/session.ts",
    "apps/doctor/app/(auth)/login/page.tsx",
    "apps/portal/app/api/auth/callback/route.ts",
    "apps/portal/app/actions/register.ts",
    "apps/admin/app/login/page.tsx",
    "apps/portal/app/register/page.tsx",
    "apps/admin/providers/auth-provider.ts",
    "apps/admin/lib/admin-session-cache.ts",
    "apps/portal/app/feed/route.ts",
    "apps/admin/app/api/events/list.ts",
    "apps/portal/lib/session-auth.ts",
    "apps/portal/components/register-action.ts",
    "apps/portal/components/submitAction.tsx",
  ];

  it.each(AUTH_SERVER)("%s forces minimum ask", (path) => {
    expect(classifyChangeTier([mod(path)]).minimum).toBe("ask");
  });

  it("a plain UI route file (page/layout/loading/error) stays show", () => {
    for (const path of [
      "apps/portal/app/feed/page.tsx",
      "apps/doctor/app/events/layout.tsx",
      "apps/portal/app/feed/loading.tsx",
      "apps/portal/app/feed/error.tsx",
    ])
      expect(classifyChangeTier([mod(path)]).minimum).toBe("show");
  });

  it("an interaction / transaction UI file is not a server action", () => {
    expect(
      classifyChangeTier([mod("packages/ui/src/interaction-states.tsx")])
        .minimum,
    ).not.toBe("ask");
  });

  it("a test under an auth / server path does not raise the tier", () => {
    expect(
      classifyChangeTier([mod("packages/auth-flow/src/flow/login.test.ts")])
        .minimum,
    ).toBe("ship");
  });
});

describe("#2819: CI runner scripts under e2e/ are not test paths", () => {
  it("EARS-1: a PR changing only an e2e runner script is neither test-only nor ship", () => {
    for (const path of [
      "apps/doctor/e2e/run-ci-tiers.mjs",
      "packages/e2e/bin/check-host-tags.ts",
    ]) {
      const result = classifyChangeTier([mod(path)]);
      expect(result.minimum, path).toBe("show");
      expect(result.testOnly ?? false, path).toBe(false);
      expect(isNonRuntimePath(path), path).toBe(false);
    }
  });

  it("EARS-1: e2e support, steps, lib and evidence helpers stay test-only", () => {
    for (const path of [
      "apps/doctor/e2e/support/session.ts",
      "packages/e2e/tests/steps/auth.steps.ts",
      "packages/e2e/lib/mail.ts",
      "apps/doctor/e2e/ui-evidence-home.mjs",
      "packages/e2e/admin/sign-in.ts",
    ]) {
      const result = classifyChangeTier([mod(path)]);
      expect(result.minimum, path).toBe("ship");
      expect(result.testOnly, path).toBe(true);
    }
  });
});
