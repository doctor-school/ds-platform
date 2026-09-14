import { describe, expect, it } from "vitest";

import {
  HOST_TAG_VALUES,
  featureHostTags,
  hostTagCounts,
  hostTagViolation,
  tagExpressionFor,
} from "./host-tags.js";

/**
 * The structural half of the host-selection contract (regression-contour tech
 * spec §6.1, Issue #2067). The projects select POSITIVELY — `@host:academy or
 * @host:both` — so a feature file that carries no host tag is selected by NO
 * project and its scenarios silently stop existing. That is exactly the failure
 * a green `bddgen` must not be able to hide, so an untagged file is a
 * generation-time ERROR naming the file, not a warning.
 */
const feature = (body: string) => `# a header comment\n# and a second one\n\n${body}`;

describe("featureHostTags", () => {
  it("reads the tag block directly above `Feature:`, past comments and blanks", () => {
    expect(featureHostTags(feature("@host:both\nFeature: X\n"))).toEqual([
      "@host:both",
    ]);
    expect(
      featureHostTags("@smoke @host:doctor\n# a comment between\n\nFeature: X\n"),
    ).toEqual(["@host:doctor"]);
  });

  it("ignores SCENARIO-level host tags — only the Feature-level block counts", () => {
    expect(
      featureHostTags("@host:academy\nFeature: X\n\n  @host:admin\n  Scenario: Y\n"),
    ).toEqual(["@host:academy"]);
  });
});

describe("hostTagViolation", () => {
  it("accepts every value of the vocabulary", () => {
    for (const value of HOST_TAG_VALUES) {
      expect(hostTagViolation(feature(`@host:${value}\nFeature: X\n`))).toBeNull();
    }
  });

  it("rejects a file with no host tag at all", () => {
    expect(hostTagViolation(feature("Feature: X\n"))).toContain("no @host: tag");
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
