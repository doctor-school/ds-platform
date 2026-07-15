import { describe, expect, it } from "vitest";

// Pure seam exported from the GitHub-Deployment record tool (Issue #942, W2/L2).
// Importing it does NOT fire the script's I/O — the module exposes only pure
// helpers plus a never-throw I/O seam guarded behind an entry-point check, the
// same idiom as tools/deploy/release-notes.mjs. `buildDeploymentPayload` assembles
// the two `gh api` bodies (Deployment + status) deterministically with no I/O and
// no `Date.now()` (the caller injects `nowIso`), so it is unit-testable offline.
import { buildDeploymentPayload } from "../../deploy/deployment-record.mjs";

const SHA = "a".repeat(40);
const HEALTH = "https://api.doctor.school/v1/health";
const NOW = "2026-07-15T12:34:56.000Z";

describe("deployment-record — buildDeploymentPayload (pure)", () => {
  it("deployment body wire shape (production · no auto_merge · no contexts · ref=sha)", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-2026.07.15-1",
      notesText: "note",
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(deployment.environment).toBe("production");
    expect(deployment.auto_merge).toBe(false);
    expect(deployment.required_contexts).toEqual([]);
    expect(deployment.ref).toBe(SHA);
    expect(deployment.description.length).toBeLessThanOrEqual(140);
  });

  it("payload.notes carries the notesText verbatim; releaseTag + deployedAt persisted", () => {
    const notes =
      "## 🚀 Релиз на PROD\nПервая фича для врачей.\nВторая строка `$(whoami)`.";
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: notes,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    // Persisting the release-notes text into the Deployment payload IS the spec
    // §D3 "persist the release-notes payload into the Deployment".
    expect(deployment.payload.notes).toBe(notes);
    expect(deployment.payload.releaseTag).toBe("release-x");
    expect(deployment.payload.deployedAt).toBe(NOW);
  });

  it("notesText null → payload.notes is the empty string (first-deploy case)", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: null,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(deployment.payload.notes).toBe("");
  });

  it("status body: success · log_url=healthUrl · production · description truncated ≤140", () => {
    const long = "x".repeat(400);
    const { status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: long,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(status.state).toBe("success");
    expect(status.log_url).toBe(HEALTH);
    expect(status.environment).toBe("production");
    expect(status.description.length).toBeLessThanOrEqual(140);
  });

  it("status.description = first non-empty line of notesText", () => {
    const { status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: "\n\nFirst real line\nsecond line ignored",
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(status.description).toBe("First real line");
  });

  it("untagged fallback: releaseTag null → description says (untagged), payload.releaseTag null", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: "",
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(deployment.description).toContain("(untagged)");
    expect(deployment.payload.releaseTag).toBeNull();
  });

  it("nowIso is echoed verbatim into payload.deployedAt (ISO stamp shape)", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: "",
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(deployment.payload.deployedAt).toBe(NOW);
    expect(deployment.payload.deployedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});

// #949 — GitHub's Deployment(-status) `description` column is a legacy 3-byte
// `utf8` type that rejects 4-byte Unicode (astral-plane code points, i.e. emoji)
// with a 422. The release-notes digest first line is `## 🚀 Релиз на PROD`; the 🚀
// (U+1F680) is a 4-byte char, so the status POST failed. Both `description` fields
// must be sanitized; `payload.notes` (a JSON blob column) must keep the emoji.
const hasAstral = (s: string) =>
  [...s].some((c) => (c.codePointAt(0) ?? 0) > 0xffff);

describe("deployment-record — 4-byte Unicode stripped from descriptions (#949)", () => {
  const DIGEST =
    "## 🚀 Релиз на PROD\nПервая фича для врачей 🎉.\nВторая строка.";

  it("status.description carries no 4-byte code point (the real 422 input)", () => {
    const { status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: DIGEST,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(
      [...status.description].every((c) => (c.codePointAt(0) ?? 0) <= 0xffff),
    ).toBe(true);
    expect(hasAstral(status.description)).toBe(false);
    // Cyrillic (BMP) survives — only astral chars are dropped.
    expect(status.description).toContain("Релиз на PROD");
    expect(status.description.length).toBeLessThanOrEqual(140);
  });

  it("deployment.description carries no 4-byte code point (defense — ASCII by construction)", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: DIGEST,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(hasAstral(deployment.description)).toBe(false);
    expect(deployment.description.length).toBeLessThanOrEqual(140);
  });

  it("payload.notes keeps the emoji verbatim (astral survives in the JSON blob)", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-x",
      notesText: DIGEST,
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(deployment.payload.notes).toBe(DIGEST);
    expect(hasAstral(deployment.payload.notes)).toBe(true);
  });
});
