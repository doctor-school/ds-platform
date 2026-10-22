import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/route-mount-lint.ts` (#2002 slice D).
 *
 * The guard is the ROUTE-MOUNT check of the one-code-two-storefronts plan (tech
 * spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3, «Route
 * mount» bullet): a route file whose path the registry assigns to a package
 * imports that package's page export and, from the host, only its host-config
 * module; any other import or a body beyond mount + config fails. The negative
 * fixture the spec names verbatim — fetch-and-branch logic written straight
 * into `page.tsx` — is `red-fetch-and-branch`.
 *
 * The tree half mirrors slice A: every `apps/{portal,doctor}/app/**\/{page,layout}.tsx`
 * needs an exact-path row in «Route-file registry», every row must name a live
 * file, and a glob row is itself a finding. The honest limit is the
 * `pull_request` half: a diff touching a `wave N` route file is flagged with the
 * row quoted, because that page still carries inline host logic the guard does
 * not read.
 *
 * Each case points `LINT_FIXTURE_ROOT` at a mini repo tree and asserts the exit
 * code (0 pass / 1 fail) plus a stable message substring. Engineering-task, so
 * the test ids are `2002:` rather than EARS ids.
 */
const GUARD = "route-mount-lint.ts";
const dir = (name: string) => caseDir("route-mount", name);
const gh = (name: string) => ghDir("route-mount", name);

/**
 * Ambient CI values must be overridden: the `unit` job runs inside a real
 * `pull_request` event, which would otherwise pull the honest-limit branch into
 * the tree-only cases.
 */
const TREE_ONLY = { GITHUB_EVENT_NAME: "push", PR_NUMBER: "" };

describe("route-mount-lint", () => {
  it("2002: green — a `mounted` page that only mounts the package with its host config, a `wave N` page with inline logic and a `permanent` layout → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), { env: TREE_ONLY });
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("2002: red — fetch-and-branch logic written straight into a `mounted` `page.tsx` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-fetch-and-branch"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/events/page.tsx");
    expect(stderr).toContain("body beyond mount + config");
  });

  it("2002: red — a `mounted` page importing host logic (`@/lib/session`) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-foreign-import"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("foreign import");
    expect(stderr).toContain("@/lib/session");
  });

  it('2074: green — a `mounted` page with one sibling server-action binding (`"use server"`, package + host-config imports, `return <packageFn>(<HOST_CONFIG>, …)`) → exit 0', () => {
    const { code, stdout } = runGuard(GUARD, dir("green-binding"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("1 server-action binding");
  });

  it("2074: red — a statement beyond the single `return` in a binding export → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-binding-extra-statement"),
      { env: TREE_ONLY },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("beyond the server-action binding");
  });

  it("2074: red — a binding importing host logic (`@/lib/session`) → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-binding-foreign-import"),
      {
        env: TREE_ONLY,
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("foreign import `@/lib/session`");
  });

  it("2074: red — a binding whose export returns a call of anything but a package function → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-binding-non-package-call"),
      { env: TREE_ONLY },
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "`renderLocally` is not imported from `@ds/events-storefront`",
    );
  });

  it('2074: red — a sibling without the `"use server"` directive is not a binding → exit 1', () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-no-directive"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain('`"use server"`');
  });

  it("2074: red — a binding parameter shadowing the package function with a default arrow (fetch, branching, dynamic import) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-param-shadow"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("parameter `renderEventsBlock`");
  });

  it("2074: red — a binding parameter with a default value computing a fetch → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-param-default"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("parameter `session` has a default value");
  });

  it("2074: red — an `if` inside an arrow-function argument of a binding → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-arrow-branch"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("argument `() =>");
  });

  it("2074: red — a mounted page whose route-prop parameter has a default value computing a fetch → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-mount-param-default"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain("parameter `searchParams` has a default value");
  });

  it("2074: red — a binding argument that is an arrow mutating its input → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-arrow-mutate"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("argument `() =>");
  });

  it("2074: red — a binding argument that reads a member (`input.slug`) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-member-arg"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("argument `input.slug`");
  });

  it("2074: red — a mounted page destructuring its route props under a computed key → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-mount-param-computed-key"),
      { env: TREE_ONLY },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain("route-prop element");
  });

  it("2074: red — a mounted page collecting its route props with a rest element → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-mount-param-rest"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain("route-prop element `...searchParams`");
  });

  it("2074: red — the page body destructures the awaited route props with a default computing a fetch → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-mount-body-destructure-default"),
      { env: TREE_ONLY },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain("parameter `q` has a default value");
  });

  it("2074: red — the page body destructures the awaited route props under a computed key → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-mount-body-computed-key"),
      { env: TREE_ONLY },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain("awaited route-prop element");
  });

  it("2074: red — the page body renames an awaited route prop onto the mount import's name → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-mount-body-shadow"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
    expect(stderr).toContain(
      "awaited route-prop element `q: EventsListingPage`",
    );
  });

  it("2074: red — a binding exporting an action the page does not import → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-second-export"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain(
      "`unusedSecondAction` is not imported by the route file",
    );
  });

  it("2074: red — a binding whose action is a default export → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-binding-default-export"),
      {
        env: TREE_ONLY,
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("a default export");
  });

  it("2074: red — a binding export declaring a `this` parameter → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-this-param"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("a `this` parameter");
  });

  it("2074: red — a binding passing a type-only import as an argument → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-binding-type-arg"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/app/webinars/retry-block-action.ts");
    expect(stderr).toContain("argument `EventsBlockRetryInput`");
  });

  it.each([
    ["red-mount-prop-tagged-template", "attribute `session`"],
    ["red-mount-prop-env", "attribute `hostFlag`"],
    ["red-mount-prop-inline-override", "attribute `config`"],
    ["red-mount-prop-arrow", "attribute `retry`"],
    ["red-mount-nested-jsx", "attribute `slot`"],
    ["red-mount-spread-attribute", "a spread attribute"],
    ["red-mount-children", "the mount has children"],
  ])(
    "2074: red — a mount prop outside the allowlist (%s) → exit 1",
    (name, needle) => {
      const { code, stderr } = runGuard(GUARD, dir(name), { env: TREE_ONLY });
      expect(code).toBe(1);
      expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
      expect(stderr).toContain(needle);
    },
  );

  it.each([
    ["red-segment-tagged-template", "segment config `revalidate`"],
    ["red-segment-getter-metadata", "`metadata` member `get title"],
  ])(
    "2074: red — a segment-config export outside the allowlist (%s) → exit 1",
    (name, needle) => {
      const { code, stderr } = runGuard(GUARD, dir(name), { env: TREE_ONLY });
      expect(code).toBe(1);
      expect(stderr).toContain("apps/portal/app/webinars/page.tsx");
      expect(stderr).toContain(needle);
    },
  );

  it("2002: red — a route file with no registry row → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unregistered"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/foo/page.tsx");
    expect(stderr).toContain("no route-file registry row");
  });

  it("3170: red — an unregistered `apps/login/app/**/page.tsx` (the sign-in host is in scope) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unregistered-login"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/login/app/login/page.tsx");
    expect(stderr).toContain("no route-file registry row");
  });

  it("2002: red — a stale row naming a route file that no longer exists → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-stale-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/gone/page.tsx");
    expect(stderr).toContain("stale row");
  });

  it("2002: red — a row written as a glob instead of an exact path → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-glob-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("glob row");
  });

  it("2074: honest limit — a PR touching a `wave N` route file is annotated with the row quoted, never blocked → exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("warn-until-wave-touch"), {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "400",
        LINT_GH_FIXTURE_DIR: gh("warn-until-wave-touch"),
      },
    });
    expect(code).toBe(0);
    expect(stderr).toContain("honest limit (annotation, not blocking)");
    expect(stderr).toContain("apps/doctor/app/(auth)/login/page.tsx");
    expect(stderr).toContain("wave 1 (#2027)");
  });
});
