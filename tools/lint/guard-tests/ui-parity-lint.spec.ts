import { describe, expect, it } from "vitest";

import {
  bodyEvidenceVerdict,
  latestModeAComparisonVerdict,
} from "../ui-parity-lint";
import { caseDir, ghDir, runGuard } from "./run-guard";

const canvasRoot = caseDir("ui-parity", "canvas-source");
const commonEvidence = `
ui-render-desktop-light: https://example.test/desktop-light.png
ui-render-desktop-dark: https://example.test/desktop-dark.png
ui-render-mobile-light: https://example.test/mobile-light.png
ui-render-mobile-dark: https://example.test/mobile-dark.png
ui-interactions: https://example.test/interactions.png — hover, active and focus-visible driven
`;
const canvasBody = `
ui-source-kind: canvas
ui-source: design-source/existing.dc.html
ui-source-state: mode=past
${commonEvidence}`;
const approvedBody = `
ui-source-kind: approved-non-canvas
ui-source: #1282 and #1337 admin compositions with #1578 design-system states
ui-source-state: admin managed-relations selector composition: loading, empty, and filled states
ui-source-reason: no canvas owns this surface; these approved compositions and artifacts are authoritative
${commonEvidence}`;

describe("ui-parity body evidence", () => {
  it("red: the insufficient #1625 wording is not evidence", () => {
    expect(
      bodyEvidenceVerdict(
        "desktop/mobile × light/dark inspected; tests, tokens and a11y green",
        canvasRoot,
      ).ok,
    ).toBe(false);
  });

  it("red: canvas-derived #1346 requires an exact existing vendored canvas and state", () => {
    expect(
      bodyEvidenceVerdict(canvasBody.replace(/ui-source:.*\n/, ""), canvasRoot)
        .ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace("mode=past", "inspected"),
        canvasRoot,
      ).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace("existing.dc.html", "missing.dc.html"),
        canvasRoot,
      ).ok,
    ).toBe(false);
  });

  it("green: an exact existing vendored canvas and state pass", () => {
    expect(bodyEvidenceVerdict(canvasBody, canvasRoot).ok).toBe(true);
  });

  it("green: #1614-shaped approved non-canvas compositions pass", () => {
    expect(bodyEvidenceVerdict(approvedBody, canvasRoot).ok).toBe(true);
  });

  it("red: approved non-canvas evidence needs a durable reference, exact composition, and reason", () => {
    expect(
      bodyEvidenceVerdict(
        approvedBody.replace(
          "#1282 and #1337 admin compositions with #1578 design-system states",
          "approved designs",
        ),
        canvasRoot,
      ).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        approvedBody.replace(/ui-source-reason:.*\n/, ""),
        canvasRoot,
      ).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        approvedBody.replace(
          /ui-source-state:.*\n/,
          "ui-source-state: approved\n",
        ),
        canvasRoot,
      ).ok,
    ).toBe(false);
  });

  it("red: every desktop/mobile × light/dark artifact is distinct and required", () => {
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace(/ui-render-mobile-dark:.*\n/, ""),
        canvasRoot,
      ).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace(
          "https://example.test/mobile-dark.png",
          "https://example.test/mobile-light.png",
        ),
        canvasRoot,
      ).ok,
    ).toBe(false);
  });

  it("red: interaction evidence needs an artifact or a reasoned no-interactions N/A", () => {
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace(/ui-interactions:.*\n/, "ui-interactions: N/A\n"),
        canvasRoot,
      ).ok,
    ).toBe(false);
  });

  it("green: a reasoned non-interactive N/A passes", () => {
    expect(
      bodyEvidenceVerdict(
        canvasBody.replace(
          /ui-interactions:.*\n/,
          "ui-interactions: N/A — no interactive elements or states exist in this source state\n",
        ),
        canvasRoot,
      ).ok,
    ).toBe(true);
  });
});

describe("ui-parity Mode (a) comparison", () => {
  const review = (body: string, submittedAt: string) => ({ body, submittedAt });
  const completeReview = (sourceBody: string) => `## Mode (a) Review — PR #1625

ui-source-kind: ${sourceBody.match(/ui-source-kind:\s*(.*)/)?.[1]}
ui-source: ${sourceBody.match(/ui-source:\s*(.*)/)?.[1]}
ui-source-state: ${sourceBody.match(/ui-source-state:\s*(.*)/)?.[1]}
ui-artifacts-compared: desktop-light, desktop-dark, mobile-light, mobile-dark, interactions
ui-source-applicability: the approved source applies to this touched admin surface and its operator purpose
ui-comparison-result: MATCH — element-by-element geometry, values, presentation, and driven states match

VERDICT: APPROVE`;

  it("red: missing or vague latest review comparison fails", () => {
    expect(latestModeAComparisonVerdict([], canvasBody).ok).toBe(false);
    expect(
      latestModeAComparisonVerdict(
        [
          review(
            "## Mode (a) Review — PR #1625\n\nLooks fine.\n\nVERDICT: APPROVE",
            "2026-08-30T01:00:00Z",
          ),
        ],
        canvasBody,
      ).ok,
    ).toBe(false);
  });

  it("red: a newer vague review invalidates an older complete comparison", () => {
    expect(
      latestModeAComparisonVerdict(
        [
          review(completeReview(canvasBody), "2026-08-30T01:00:00Z"),
          review(
            "## Mode (a) Review — PR #1625\n\nLooks fine.\n\nVERDICT: APPROVE",
            "2026-08-30T02:00:00Z",
          ),
        ],
        canvasBody,
      ).ok,
    ).toBe(false);
  });

  it("red: exact source/state without source applicability still fails purpose-fit", () => {
    const incomplete = completeReview(canvasBody).replace(
      /ui-source-applicability:.*\n/,
      "",
    );
    expect(
      latestModeAComparisonVerdict(
        [review(incomplete, "2026-08-30T02:00:00Z")],
        canvasBody,
      ).ok,
    ).toBe(false);
  });

  it("red: surface applicability without an explicit purpose fit still fails", () => {
    const incomplete = completeReview(canvasBody).replace(
      /ui-source-applicability:.*\n/,
      "ui-source-applicability: the approved source applies to this touched surface\n",
    );
    expect(
      latestModeAComparisonVerdict(
        [review(incomplete, "2026-08-30T02:00:00Z")],
        canvasBody,
      ).ok,
    ).toBe(false);
  });

  it.each([
    ["canvas", canvasBody],
    ["approved non-canvas #1614 composition", approvedBody],
  ])(
    "green: Mode (a) compares the submitted %s source, 2x2 set, interactions, and purpose-fit",
    (_name, body) => {
      expect(
        latestModeAComparisonVerdict(
          [review(completeReview(body), "2026-08-30T02:00:00Z")],
          body,
        ).ok,
      ).toBe(true);
    },
  );
});

describe("ui-parity guard integration", () => {
  it("red fixture: #1625-style inspected wording fails the BLOCK guard", () => {
    const { code, stderr } = runGuard(
      "ui-parity-lint.ts",
      caseDir("ui-parity", "red-1625"),
      {
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          PR_NUMBER: "1625",
          LINT_GH_FIXTURE_DIR: ghDir("ui-parity", "red-1625"),
        },
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("lacks approved-source parity evidence");
  });
});
