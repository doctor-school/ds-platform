import { describe, expect, it } from "vitest";

import {
  type ApprovedSourceManifest,
  bodyEvidenceVerdict,
  latestModeAComparisonVerdict,
} from "../ui-parity-lint";
import { caseDir, ghDir, runGuard } from "./run-guard";

const canvasRoot = caseDir("ui-parity", "canvas-source");
const webFile = "apps/admin/app/events/[id]/page.tsx";
const approvedFile = "apps/admin/components/recordings-panel.tsx";
const mobileFile = "apps/mobile/src/screens/home.tsx";
const approvedManifest: ApprovedSourceManifest = {
  version: 1,
  sources: {
    "admin-refine-compositions-v1": {
      evidenceProfiles: ["responsive-web"],
      surfacePaths: [approvedFile],
      states: ["recordings-tab"],
      approvalProvenance: [
        "https://github.com/doctor-school/ds-platform/issues/1337#issuecomment-5315895726",
      ],
    },
    "mixed-approved-v1": {
      evidenceProfiles: ["native-mobile", "responsive-web"],
      surfacePaths: [webFile, mobileFile],
      states: ["shared-approved-composition"],
      approvalProvenance: [
        "https://github.com/doctor-school/ds-platform/issues/1282#issuecomment-5314581672",
      ],
    },
  },
};
const webEvidence = `
ui-evidence-profile: responsive-web
ui-render-desktop-light: https://example.test/desktop-light.png
ui-render-desktop-dark: https://example.test/desktop-dark.png
ui-render-mobile-light: https://example.test/mobile-light.png
ui-render-mobile-dark: https://example.test/mobile-dark.png
ui-interactions: https://example.test/interactions.png — hover, active and focus-visible driven
`;
const nativeEvidence = `
ui-evidence-profile: native-mobile
ui-render-phone-light: https://example.test/phone-light.png
ui-render-phone-dark: https://example.test/phone-dark.png
ui-render-tablet-light: https://example.test/tablet-light.png
ui-render-tablet-dark: https://example.test/tablet-dark.png
ui-interactions: https://example.test/interactions.png — pressed, focus and disabled states driven
`;
const canvasBody = `
ui-source-kind: canvas
ui-source: design-source/existing.dc.html
ui-source-state: mode=past
${webEvidence}`;
const approvedBody = `
ui-source-kind: approved-non-canvas
ui-source: admin-refine-compositions-v1
ui-source-state: recordings-tab
${webEvidence}`;
const mixedApprovedBody = `
ui-source-kind: approved-non-canvas
ui-source: mixed-approved-v1
ui-source-state: shared-approved-composition
ui-evidence-profile: native-mobile, responsive-web
${webEvidence.replace("ui-evidence-profile: responsive-web\n", "")}
${nativeEvidence.replace("ui-evidence-profile: native-mobile\n", "")}`;

const verdict = (
  body: string,
  paths = [approvedFile],
  manifest = approvedManifest,
) => bodyEvidenceVerdict(body, canvasRoot, paths, manifest);

describe("ui-parity body evidence", () => {
  it("red: #1625 inspected wording is not evidence", () => {
    expect(verdict("desktop/mobile x light/dark inspected").ok).toBe(false);
  });

  it("red: canvas requires an existing file and a mechanically declared key=value state", () => {
    expect(
      verdict(canvasBody.replace("existing.dc.html", "missing.dc.html")).ok,
    ).toBe(false);
    expect(
      verdict(canvasBody.replace("mode=past", "mode=does-not-exist")).ok,
    ).toBe(false);
  });

  it("green: exact existing canvas and declared state pass", () => {
    expect(verdict(canvasBody).ok).toBe(true);
  });

  it("green: exact owner-comment base-approved manifest source passes", () => {
    expect(verdict(approvedBody).ok).toBe(true);
  });

  it("red: nonexistent or self-added/unapproved manifest ids fail", () => {
    expect(
      verdict(
        approvedBody.replace("admin-refine-compositions-v1", "not-approved"),
      ).ok,
    ).toBe(false);
    const selfAdded = structuredClone(approvedManifest);
    selfAdded.sources["self-added"] =
      selfAdded.sources["admin-refine-compositions-v1"];
    expect(
      verdict(
        approvedBody.replace("admin-refine-compositions-v1", "self-added"),
        [approvedFile],
        approvedManifest,
      ).ok,
    ).toBe(false);
  });

  it("red: approved source scope mismatch and undeclared state fail", () => {
    expect(
      verdict(approvedBody, ["apps/portal/app/webinars/page.tsx"]).ok,
    ).toBe(false);
    expect(
      verdict(
        approvedBody.replace(
          "recordings-tab",
          "recordings-panel/unknown",
        ),
      ).ok,
    ).toBe(false);
  });

  it.each([
    "apps/admin/app/events/[id]/page.tsx",
    "apps/admin/components/lifecycle-actions.tsx",
    "apps/admin/messages/ru.json",
  ])("red: unrelated multipurpose file %s cannot claim the recordings source", (path) => {
    expect(verdict(approvedBody, [path]).ok).toBe(false);
  });

  it.each([
    "https://github.com/doctor-school/ds-platform/issues/1282",
    "https://github.com/doctor-school/ds-platform/pull/1614",
    "https://github.com/doctor-school/ds-platform/pull/1575#issuecomment-5434237585",
  ])("red: manifest provenance %s is not an exact owner decision comment", (url) => {
    const invalid = structuredClone(approvedManifest);
    invalid.sources["admin-refine-compositions-v1"].approvalProvenance = [url];
    expect(verdict(approvedBody, [approvedFile], invalid).ok).toBe(false);
  });

  it("green: approved non-canvas source can require mixed evidence profiles", () => {
    expect(verdict(mixedApprovedBody, [webFile, mobileFile]).ok).toBe(true);
  });

  it("red: approved-source profiles require exact missing/extra coverage", () => {
    const missing = structuredClone(approvedManifest);
    missing.sources["mixed-approved-v1"].evidenceProfiles = ["responsive-web"];
    const extra = structuredClone(approvedManifest);
    extra.sources["admin-refine-compositions-v1"].evidenceProfiles = [
      "native-mobile",
      "responsive-web",
    ];
    expect(
      verdict(mixedApprovedBody, [webFile, mobileFile], missing).ok,
    ).toBe(false);
    expect(verdict(approvedBody, [approvedFile], extra).ok).toBe(false);
  });

  it("red: responsive-web requires four distinct desktop/mobile x theme links", () => {
    expect(
      verdict(canvasBody.replace(/ui-render-mobile-dark:.*\n/, "")).ok,
    ).toBe(false);
    expect(
      verdict(canvasBody.replace("mobile-dark.png", "mobile-light.png")).ok,
    ).toBe(false);
  });

  it("green: native-mobile requires phone/tablet x theme rather than desktop", () => {
    const native = canvasBody.replace(webEvidence, nativeEvidence);
    expect(verdict(native, [mobileFile]).ok).toBe(true);
    expect(verdict(canvasBody, [mobileFile]).ok).toBe(false);
  });

  it("red: mixed web/native changes require both declared profiles and both 2x2 sets", () => {
    expect(verdict(canvasBody, [webFile, mobileFile]).ok).toBe(false);
    const mixed = canvasBody
      .replace(
        webEvidence,
        `${webEvidence}${nativeEvidence.replace("ui-evidence-profile: native-mobile\n", "")}`,
      )
      .replace(
        "ui-evidence-profile: responsive-web",
        "ui-evidence-profile: native-mobile, responsive-web",
      );
    expect(verdict(mixed, [webFile, mobileFile]).ok).toBe(true);
  });

  it("red: interaction evidence needs an artifact or reasoned N/A", () => {
    expect(
      verdict(
        canvasBody.replace(/ui-interactions:.*\n/, "ui-interactions: N/A\n"),
      ).ok,
    ).toBe(false);
  });
});

describe("ui-parity Mode (a) comparison", () => {
  const review = (body: string, submittedAt: string) => ({ body, submittedAt });
  const completeReview = (
    sourceBody: string,
    artifacts = "desktop-light, desktop-dark, mobile-light, mobile-dark, interactions",
  ) => `## Mode (a) Review — PR #1625

ui-source-kind: ${sourceBody.match(/ui-source-kind:\s*(.*)/)?.[1]}
ui-source: ${sourceBody.match(/ui-source:\s*(.*)/)?.[1]}
ui-source-state: ${sourceBody.match(/ui-source-state:\s*(.*)/)?.[1]}
ui-evidence-profile: ${sourceBody.match(/ui-evidence-profile:\s*(.*)/)?.[1]}
ui-artifacts-compared: ${artifacts}
ui-source-applicability: this approved source applies to the touched admin surface and operator workflow purpose
ui-comparison-result: MATCH — element-by-element geometry, values, presentation, and driven states match

VERDICT: APPROVE`;

  it("red: latest review must bind source, state, profile and purpose fit", () => {
    expect(latestModeAComparisonVerdict([], canvasBody).ok).toBe(false);
    const missingProfile = completeReview(canvasBody).replace(
      /ui-evidence-profile:.*\n/,
      "",
    );
    expect(
      latestModeAComparisonVerdict(
        [review(missingProfile, "2026-08-30T02:00:00Z")],
        canvasBody,
      ).ok,
    ).toBe(false);
  });

  it("green: web and native reviews compare their profile-specific artifacts", () => {
    expect(
      latestModeAComparisonVerdict(
        [review(completeReview(canvasBody), "2026-08-30T02:00:00Z")],
        canvasBody,
      ).ok,
    ).toBe(true);
    const native = canvasBody.replace(webEvidence, nativeEvidence);
    const nativeReview = completeReview(
      native,
      "phone-light, phone-dark, tablet-light, tablet-dark, interactions",
    );
    expect(
      latestModeAComparisonVerdict(
        [review(nativeReview, "2026-08-30T02:00:00Z")],
        native,
      ).ok,
    ).toBe(true);
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
    expect(stderr).toContain("lacks approved-source parity evidence");
  });
});
