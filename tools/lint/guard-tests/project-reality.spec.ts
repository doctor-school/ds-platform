import { describe, expect, it } from "vitest";

import {
  PROJECT_REALITY_HEADING,
  evaluateProjectReality,
  reconcileMessage,
  releaseFromProbe,
  renderProjectReality,
  shaMatches,
  shortSha,
  type ProjectRealityProbe,
  type ReleaseInfo,
} from "../../project-reality";

/**
 * Unit cover for the `## Project reality` seam (#927, W1). Mirrors
 * `main-sync.spec.ts`: the gh/git/health I/O (`probeProjectReality`) is a
 * subprocess/network seam; the classifier (`evaluateProjectReality`) and the
 * message formatters are pure and tested here with FABRICATED probe objects —
 * no git/FS/network. Covers every §6 status branch: deployed⋈health agree /
 * disagree / Deployment-missing-but-health-present / all-unreachable, plus the
 * merged-not-deployed delta and platform-agnostic rendering.
 */

const probe = (over: Partial<ProjectRealityProbe> = {}): ProjectRealityProbe => ({
  deploymentSha: null,
  deploymentState: null,
  deploymentFound: false,
  healthSha: null,
  releaseTag: null,
  releasePublishedAt: null,
  mergedNotDeployed: null,
  ...over,
});

describe("project-reality shaMatches()", () => {
  it("matches a full 40-char SHA against its abbreviated /v1/health version", () => {
    expect(shaMatches("b9d81e6a1c2d3e4f5061728394a5b6c7d8e9f0a1", "b9d81e6")).toBe(
      true,
    );
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(shaMatches("B9D81E6 ", "b9d81e6")).toBe(true);
  });

  it("rejects a genuine divergence", () => {
    expect(shaMatches("b9d81e6", "1234567")).toBe(false);
  });
});

describe("project-reality shortSha()", () => {
  it("abbreviates a long SHA to 7 chars", () => {
    expect(shortSha("b9d81e6a1c2d")).toBe("b9d81e6");
  });
  it("leaves an already-short SHA untouched", () => {
    expect(shortSha("b9d81e6")).toBe("b9d81e6");
  });
});

describe("project-reality evaluateProjectReality()", () => {
  it("Deployment SHA ⋈ health SHA agree → agree (carries the delta)", () => {
    const s = evaluateProjectReality(
      probe({
        deploymentSha: "b9d81e6a1c2d",
        healthSha: "b9d81e6",
        mergedNotDeployed: 3,
      }),
    );
    expect(s.kind).toBe("agree");
    expect(s.kind === "agree" && s.mergedNotDeployed).toBe(3);
  });

  it("Deployment SHA ≠ health SHA → disagree (carries both)", () => {
    const s = evaluateProjectReality(
      probe({ deploymentSha: "aaaaaaa", healthSha: "bbbbbbb" }),
    );
    expect(s.kind).toBe("disagree");
    expect(s.kind === "disagree" && s.deploymentSha).toBe("aaaaaaa");
    expect(s.kind === "disagree" && s.healthSha).toBe("bbbbbbb");
  });

  it("Deployment missing but health present → deployed-unrecorded", () => {
    const s = evaluateProjectReality(
      probe({ deploymentSha: null, healthSha: "b9d81e6", mergedNotDeployed: 0 }),
    );
    expect(s.kind).toBe("deployed-unrecorded");
    expect(s.kind === "deployed-unrecorded" && s.healthSha).toBe("b9d81e6");
  });

  it("Deployment present but health unreachable → deployment-only (graceful degrade)", () => {
    const s = evaluateProjectReality(
      probe({
        deploymentSha: "b9d81e6",
        deploymentState: "success",
        healthSha: null,
      }),
    );
    expect(s.kind).toBe("deployment-only");
    expect(s.kind === "deployment-only" && s.deploymentState).toBe("success");
  });

  it("neither Deployment nor health reachable → unreachable", () => {
    const s = evaluateProjectReality(
      probe({
        deploymentSha: null,
        healthSha: null,
        deploymentError: "gh api failed",
        healthError: "timeout",
      }),
    );
    expect(s.kind).toBe("unreachable");
  });
});

describe("project-reality reconcileMessage()", () => {
  it("agree → no banner", () => {
    expect(
      reconcileMessage(
        evaluateProjectReality(
          probe({ deploymentSha: "b9d81e6", healthSha: "b9d81e6" }),
        ),
      ),
    ).toBe(null);
  });

  it("deployment-only → no loud reconcile banner (soft inline degrade only)", () => {
    expect(
      reconcileMessage(
        evaluateProjectReality(probe({ deploymentSha: "b9d81e6" })),
      ),
    ).toBe(null);
  });

  it("disagree → a banner about record-vs-reality", () => {
    const msg = reconcileMessage(
      evaluateProjectReality(
        probe({ deploymentSha: "aaaaaaa", healthSha: "bbbbbbb" }),
      ),
    );
    expect(msg).toMatch(/disagree/i);
  });

  it("deployed-unrecorded → a banner naming the skipped record cycle", () => {
    const msg = reconcileMessage(
      evaluateProjectReality(probe({ healthSha: "b9d81e6" })),
    );
    expect(msg).toMatch(/unrecorded/i);
  });

  it("unreachable → a banner telling the reader to check GitHub before stating scope", () => {
    const msg = reconcileMessage(evaluateProjectReality(probe()));
    expect(msg).toMatch(/could not be derived/i);
  });
});

describe("project-reality renderProjectReality()", () => {
  const rel = (over: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
    tag: null,
    publishedAt: null,
    ...over,
  });

  it("agree → heading, dated release, health-match indicator, delta nudge, scope pointer", () => {
    const status = evaluateProjectReality(
      probe({
        deploymentSha: "b9d81e6a",
        healthSha: "b9d81e6",
        mergedNotDeployed: 3,
      }),
    );
    const lines = renderProjectReality(
      status,
      rel({ tag: "release-2026.07.15-1", publishedAt: "2026-07-15T10:00:00Z" }),
    );
    const text = lines.join("\n");
    expect(lines[0]).toBe(PROJECT_REALITY_HEADING);
    expect(text).toContain("release-2026.07.15-1 (2026-07-15)");
    expect(text).toMatch(/health ✓ matches Deployment record/);
    expect(text).toContain("3 product PR(s) NOT yet on prod");
    expect(text).toContain("pnpm deploy:prod");
    expect(text).toContain("gh release list");
    // No loud banner on the happy path.
    expect(text).not.toContain("RECONCILE");
  });

  it("disagree → leads with the loud reconcile banner and both SHAs", () => {
    const status = evaluateProjectReality(
      probe({ deploymentSha: "aaaaaaa", healthSha: "bbbbbbb" }),
    );
    const lines = renderProjectReality(status, rel());
    expect(lines[0]).toContain("PROD-REALITY RECONCILE");
    expect(lines.join("\n")).toContain("DISAGREES");
  });

  it("deployed-unrecorded → banner + 'no production Deployment record' line", () => {
    const status = evaluateProjectReality(
      probe({ healthSha: "b9d81e6", mergedNotDeployed: 0 }),
    );
    const text = renderProjectReality(status, rel()).join("\n");
    expect(text).toContain("PROD-REALITY RECONCILE");
    expect(text).toContain("no production Deployment record");
    // Zero delta reads as level, not a nudge.
    expect(text).toContain("prod is level");
  });

  it("no release cut yet → the 'none yet' latest-release line", () => {
    const status = evaluateProjectReality(probe({ healthSha: "b9d81e6" }));
    const text = renderProjectReality(status, rel()).join("\n");
    expect(text).toContain("Latest release: (none yet");
  });

  it("uncomputable delta → prints the uncomputable notice, never throws", () => {
    const status = evaluateProjectReality(
      probe({ deploymentSha: "b9d81e6", healthSha: "b9d81e6", mergedNotDeployed: null }),
    );
    const text = renderProjectReality(status, rel()).join("\n");
    expect(text).toContain("delta uncomputable");
  });

  it("unreachable → banner, unknown deployed line, no delta line, still points at gh release list", () => {
    const status = evaluateProjectReality(probe());
    const lines = renderProjectReality(status, rel());
    const text = lines.join("\n");
    expect(text).toContain("PROD-REALITY RECONCILE");
    expect(text).toContain("neither the production GitHub Deployment nor /v1/health");
    expect(text).not.toContain("Merged since deploy:");
    expect(text).toContain("gh release list");
  });

  it("platform-agnostic: rendering uses forward-slash literals, no OS path separators", () => {
    const status = evaluateProjectReality(
      probe({ deploymentSha: "b9d81e6", healthSha: "b9d81e6", mergedNotDeployed: 1 }),
    );
    const text = renderProjectReality(
      status,
      rel({ tag: "release-2026.07.15-1", publishedAt: "2026-07-15T10:00:00Z" }),
    ).join("\n");
    expect(text).toContain("/v1/health");
    expect(text).not.toMatch(/\\/); // no backslashes leak into the section
  });
});

describe("project-reality releaseFromProbe()", () => {
  it("lifts the tag + publishedAt off the probe", () => {
    const r = releaseFromProbe(
      probe({ releaseTag: "release-2026.07.15-1", releasePublishedAt: "2026-07-15T10:00:00Z" }),
    );
    expect(r.tag).toBe("release-2026.07.15-1");
    expect(r.publishedAt).toBe("2026-07-15T10:00:00Z");
  });

  it("passes nulls through when no release exists yet", () => {
    const r = releaseFromProbe(probe());
    expect(r.tag).toBe(null);
    expect(r.publishedAt).toBe(null);
  });
});
