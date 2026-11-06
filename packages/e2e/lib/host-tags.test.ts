import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { authLimitTagsFor } from "./default-auth-limits.js";

import {
  HOST_TAG_VALUES,
  featureHostTags,
  hostTagCounts,
  hostTagViolation,
  tagExpressionFor,
  ordinaryStorefrontTagsFor,
  PR_CI_DOOR_RUN_TAG,
  prCiDoorTags,
  SIGN_IN_HOST_BINDING_TAG,
  signInHostTags,
  publicProjectRefusalPattern,
  publicProjectRefusalTitles,
} from "./host-tags.js";

describe("030 dedicated exact-three selection", () => {
  it("EARS-19: selects the two refusals and explicit Doctor journey, never the adjacent retirement original", () => {
    expect(publicProjectRefusalTitles).toEqual([
      "A project without results cannot be published",
      "A result link outside doctor.school is refused",
      "The doctor storefront has no projects",
    ]);
    for (const title of publicProjectRefusalTitles)
      expect(
        publicProjectRefusalPattern.test(
          `academy Feature ${title} @host:academy`,
        ),
      ).toBe(true);
    expect(
      publicProjectRefusalPattern.test(
        "An output kind in use cannot be retired @host:academy",
      ),
    ).toBe(false);
    expect(
      publicProjectRefusalPattern.test(
        "A result link outside doctorXschool is refused",
      ),
    ).toBe(false);
  });
});

/**
 * The structural half of the host-selection contract (regression-contour tech
 * spec §6.1, Issue #2067). The projects select POSITIVELY — `@host:academy or
 * @host:both` — so a feature file that carries no host tag is selected by NO
 * project and its scenarios silently stop existing. That is exactly the failure
 * a green `bddgen` must not be able to hide, so an untagged file is a
 * generation-time ERROR naming the file, not a warning.
 */
const feature = (body: string) =>
  `# a header comment\n# and a second one\n\n${body}`;

describe("featureHostTags", () => {
  it("reads the tag block directly above `Feature:`, past comments and blanks", () => {
    expect(featureHostTags(feature("@host:both\nFeature: X\n"))).toEqual([
      "@host:both",
    ]);
    expect(
      featureHostTags(
        "@smoke @host:doctor\n# a comment between\n\nFeature: X\n",
      ),
    ).toEqual(["@host:doctor"]);
  });

  it("ignores SCENARIO-level host tags — only the Feature-level block counts", () => {
    expect(
      featureHostTags(
        "@host:academy\nFeature: X\n\n  @host:admin\n  Scenario: Y\n",
      ),
    ).toEqual(["@host:academy"]);
  });
});

describe("ordinary storefront selection", () => {
  it("EARS-1: composes public contour exclusion after the unchanged auth-only selector for local and stage runs", () => {
    const require = createRequire(import.meta.url);
    const parse = createRequire(require.resolve("playwright-bdd"))(
      "@cucumber/tag-expressions",
    ).default as (value: string) => { evaluate(tags: string[]): boolean };
    for (const env of [
      {},
      { E2E_PORTAL_URL: "https://pr-3756.stage.doctor.school" },
    ]) {
      const auth = authLimitTagsFor("doctor", env);
      expect(auth).not.toContain("@public-feed-entry");
      const ordinary = parse(ordinaryStorefrontTagsFor(auth));
      expect(ordinary.evaluate(["@host:doctor", "@public-feed-entry"])).toBe(
        false,
      );
      expect(
        ordinary.evaluate(["@host:doctor", "@public-specialty-catalog"]),
      ).toBe(true);
    }
    const dedicated = parse("@host:doctor and @public-feed-entry");
    expect(dedicated.evaluate(["@host:doctor", "@public-feed-entry"])).toBe(
      true,
    );
    expect(dedicated.evaluate(["@host:academy", "@public-feed-entry"])).toBe(
      false,
    );
  });
});

describe("the sign-in-host binding (#3345)", () => {
  const require = createRequire(import.meta.url);
  const parse = createRequire(require.resolve("playwright-bdd"))(
    "@cucumber/tag-expressions",
  ).default as (value: string) => { evaluate(tags: string[]): boolean };

  it("the login project selects exactly the bound scenarios of the ordinary contour", () => {
    expect(SIGN_IN_HOST_BINDING_TAG).toBe("@host:login");
    const login = parse(signInHostTags());
    expect(login.evaluate(["@host:academy", "@host:login"])).toBe(true);
    expect(login.evaluate(["@host:academy"])).toBe(false);
    expect(login.evaluate(["@host:academy", "@quarantine:login(#3771)"])).toBe(
      false,
    );
    // The dedicated contours stay where they are provisioned.
    expect(
      login.evaluate(["@host:academy", "@host:login", "@default-auth-limits"]),
    ).toBe(false);
    expect(
      login.evaluate(["@host:academy", "@host:login", "@public-feed-entry"]),
    ).toBe(false);
  });

  it("#3345 item 4: the PR-CI door tier selects only the bindings tagged for it; the stage login project still runs both classes", () => {
    expect(PR_CI_DOOR_RUN_TAG).toBe("@pr-ci:login");
    const prCi = parse(prCiDoorTags());
    const login = parse(signInHostTags());
    const tagged = ["@host:academy", "@host:login", "@pr-ci:login"];
    const stageOnly = [
      "@host:academy",
      "@host:login",
      "@stage-only:login(mail)",
    ];
    expect(prCi.evaluate(tagged)).toBe(true);
    expect(prCi.evaluate(stageOnly)).toBe(false);
    expect(prCi.evaluate(["@host:academy", "@pr-ci:login"])).toBe(false);
    expect(prCi.evaluate([...tagged, "@default-auth-limits"])).toBe(false);
    expect(login.evaluate(tagged)).toBe(true);
    expect(login.evaluate(stageOnly)).toBe(true);
  });

  it("a storefront project no longer runs a bound scenario twice, except on the default-auth-limits contour", () => {
    const ordinary = parse(
      ordinaryStorefrontTagsFor(authLimitTagsFor("academy", {})),
    );
    expect(ordinary.evaluate(["@host:academy", "@host:login"])).toBe(false);
    expect(ordinary.evaluate(["@host:academy"])).toBe(true);
    expect(
      ordinary.evaluate(["@host:academy", "@quarantine:login(#3771)"]),
    ).toBe(true);
    const contour = parse(
      ordinaryStorefrontTagsFor(
        authLimitTagsFor("academy", {
          E2E_AUTH_LIMIT_TIER: "default",
          E2E_PORTAL_URL: "http://localhost:3101",
        }),
      ),
    );
    expect(
      contour.evaluate([
        "@host:academy",
        "@host:login",
        "@default-auth-limits",
      ]),
    ).toBe(true);
  });

  it("is a SCENARIO-level binding — no Feature is declared on the sign-in host", () => {
    expect(hostTagViolation(feature("@host:login\nFeature: X\n"))).toContain(
      "unknown host tag @host:login",
    );
  });
});

describe("hostTagViolation", () => {
  it("accepts every value of the vocabulary", () => {
    for (const value of HOST_TAG_VALUES) {
      expect(
        hostTagViolation(feature(`@host:${value}\nFeature: X\n`)),
      ).toBeNull();
    }
  });

  it("rejects a file with no host tag at all", () => {
    expect(hostTagViolation(feature("Feature: X\n"))).toContain(
      "no @host: tag",
    );
  });

  it("rejects a file carrying two host tags", () => {
    expect(
      hostTagViolation(feature("@host:academy @host:doctor\nFeature: X\n")),
    ).toContain("@host:academy, @host:doctor");
  });

  it("rejects an unknown host value", () => {
    expect(hostTagViolation(feature("@host:portal\nFeature: X\n"))).toContain(
      "@host:portal",
    );
  });
});

describe("tagExpressionFor", () => {
  it("selects a storefront positively, plus the shared features", () => {
    expect(tagExpressionFor("academy")).toBe("@host:academy or @host:both");
    expect(tagExpressionFor("doctor")).toBe("@host:doctor or @host:both");
  });
});

describe("hostTagCounts", () => {
  it("counts the feature files each host tag claims", () => {
    expect(
      hostTagCounts([
        feature("@host:academy\nFeature: A\n"),
        feature("@host:academy\nFeature: B\n"),
        feature("@host:doctor\nFeature: C\n"),
        feature("@host:both\nFeature: D\n"),
        feature("@host:admin\nFeature: E\n"),
      ]),
    ).toEqual({ academy: 2, doctor: 1, both: 1, admin: 1 });
  });

  it("reports a zero for every vocabulary value with no file", () => {
    expect(hostTagCounts([])).toEqual({
      academy: 0,
      doctor: 0,
      both: 0,
      admin: 0,
    });
  });

  it("skips a file the violation check rejects rather than miscounting it", () => {
    // An unknown value, two tags and a missing tag are the CLI's ERROR path; a
    // count that silently absorbed them would report a suite size nobody runs.
    expect(
      hostTagCounts([
        feature("@host:portal\nFeature: A\n"),
        feature("@host:academy @host:doctor\nFeature: B\n"),
        feature("Feature: C\n"),
        feature("@host:doctor\nFeature: D\n"),
      ]),
    ).toEqual({ academy: 0, doctor: 1, both: 0, admin: 0 });
  });
});
