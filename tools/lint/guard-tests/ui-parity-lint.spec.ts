import { describe, expect, it } from "vitest";

import {
  bodyEvidenceVerdict,
  latestModeAComparisonVerdict,
} from "../ui-parity-lint";
import { caseDir, ghDir, runGuard } from "./run-guard";

const completeBody = `
canvas-source: design-source/webinars-listing.dc.html
canvas-state: mode=past
canvas-render-desktop-light: https://example.test/desktop-light.png
canvas-render-desktop-dark: https://example.test/desktop-dark.png
canvas-render-mobile-light: https://example.test/mobile-light.png
canvas-render-mobile-dark: https://example.test/mobile-dark.png
canvas-interactions: https://example.test/interactions.png — hover, active and focus-visible driven
`;

describe("ui-parity body evidence", () => {
  it("red: the insufficient #1625 wording is not evidence", () => {
    expect(
      bodyEvidenceVerdict(
        "desktop/mobile × light/dark inspected; tests, tokens and a11y green",
      ).ok,
    ).toBe(false);
  });

  it("red: missing canvas path or exact state fails", () => {
    expect(
      bodyEvidenceVerdict(completeBody.replace(/canvas-source:.*\n/, "")).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(completeBody.replace("mode=past", "inspected")).ok,
    ).toBe(false);
  });

  it("red: every desktop/mobile × light/dark artifact is distinct and required", () => {
    expect(
      bodyEvidenceVerdict(
        completeBody.replace(/canvas-render-mobile-dark:.*\n/, ""),
      ).ok,
    ).toBe(false);
    expect(
      bodyEvidenceVerdict(
        completeBody.replace(
          "https://example.test/mobile-dark.png",
          "https://example.test/mobile-light.png",
        ),
      ).ok,
    ).toBe(false);
  });

  it("red: interaction evidence needs an artifact or a reasoned no-interactions N/A", () => {
    expect(
      bodyEvidenceVerdict(
        completeBody.replace(
          /canvas-interactions:.*\n/,
          "canvas-interactions: N/A\n",
        ),
      ).ok,
    ).toBe(false);
  });

  it("green: complete artifact set and reasoned non-interactive N/A pass", () => {
    expect(bodyEvidenceVerdict(completeBody).ok).toBe(true);
    expect(
      bodyEvidenceVerdict(
        completeBody.replace(
          /canvas-interactions:.*\n/,
          "canvas-interactions: N/A — canvas state contains no interactive elements or states\n",
        ),
      ).ok,
    ).toBe(true);
  });
});

describe("ui-parity Mode (a) comparison", () => {
  const review = (body: string, submittedAt: string) => ({ body, submittedAt });

  it("red: missing or vague latest review comparison fails", () => {
    expect(latestModeAComparisonVerdict([], completeBody).ok).toBe(false);
    expect(
      latestModeAComparisonVerdict(
        [
          review(
            "## Mode (a) Review — PR #1625\n\nCanvas inspected; tests/tokens/a11y green.\n\nVERDICT: APPROVE",
            "2026-08-30T01:00:00Z",
          ),
        ],
        completeBody,
      ).ok,
    ).toBe(false);
  });

  it("red: a newer vague review invalidates an older complete comparison", () => {
    const complete = `## Mode (a) Review — PR #1625

### Canvas parity comparison
canvas-source: design-source/webinars-listing.dc.html
canvas-state: mode=past
canvas-artifacts-compared: desktop-light, desktop-dark, mobile-light, mobile-dark, interactions
canvas-source-applicability: approved webinars-listing canvas applies to the touched portal webinars surface
canvas-comparison-result: MATCH — element-by-element geometry, values, presentation and driven states match

VERDICT: APPROVE`;
    expect(
      latestModeAComparisonVerdict(
        [
          review(complete, "2026-08-30T01:00:00Z"),
          review(
            "## Mode (a) Review — PR #1625\n\nLooks fine.\n\nVERDICT: APPROVE",
            "2026-08-30T02:00:00Z",
          ),
        ],
        completeBody,
      ).ok,
    ).toBe(false);
  });

  it("red: exact source/state without source applicability still fails purpose-fit", () => {
    const reviewBody = `## Mode (a) Review — PR #1625

canvas-source: design-source/webinars-listing.dc.html
canvas-state: mode=past
canvas-artifacts-compared: desktop-light, desktop-dark, mobile-light, mobile-dark, interactions
canvas-comparison-result: MATCH — element-by-element geometry and states match

VERDICT: APPROVE`;
    expect(
      latestModeAComparisonVerdict(
        [{ body: reviewBody, submittedAt: "2026-08-30T02:00:00Z" }],
        completeBody,
      ).ok,
    ).toBe(false);
  });

  it("green: latest Mode (a) explicitly compares the submitted set to the same canvas/state", () => {
    const result = latestModeAComparisonVerdict(
      [
        review(
          `## Mode (a) Review — PR #1625

### Canvas parity comparison
canvas-source: design-source/webinars-listing.dc.html
canvas-state: mode=past
canvas-artifacts-compared: desktop-light, desktop-dark, mobile-light, mobile-dark, interactions
canvas-source-applicability: approved webinars-listing canvas applies to the touched portal webinars surface
canvas-comparison-result: MATCH — element-by-element geometry, values, presentation and driven states match

VERDICT: APPROVE`,
          "2026-08-30T02:00:00Z",
        ),
      ],
      completeBody,
    );
    expect(result.ok).toBe(true);
  });
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
    expect(stderr).toContain("lacks canvas parity evidence");
  });
});
