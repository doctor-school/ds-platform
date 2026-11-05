import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyScenarioChanges } from "./scenario-changes.mjs";

describe("classifyScenarioChanges (#3345)", () => {
  it("selects generation for a spec scenario file, which the code classifier counts as docs", () => {
    assert.equal(
      classifyScenarioChanges([
        "apps/docs/content/specs/features/003-user-authentication/003-scenarios.feature",
      ]),
      true,
    );
  });

  it("does not select generation for prose-only spec changes", () => {
    assert.equal(
      classifyScenarioChanges([
        "apps/docs/content/specs/features/003-user-authentication/requirements.md",
        "apps/docs/content/adr/0015-sign-in-host.md",
      ]),
      false,
    );
  });

  it("fails open on an empty changed-file set", () => {
    assert.equal(classifyScenarioChanges([]), true);
  });
});
