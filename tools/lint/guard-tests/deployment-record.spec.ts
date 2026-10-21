import { describe, expect, it } from "vitest";

// Pure seam exported from the GitHub-Deployment record tool (Issue #942, W2/L2).
// Importing it does NOT fire the script's I/O — the module exposes only pure
// helpers plus a never-throw I/O seam guarded behind an entry-point check, the
// same idiom as tools/deploy/release-notes.mjs. `buildDeploymentPayload` assembles
// the two `gh api` bodies (Deployment + status) deterministically with no I/O and
// no `Date.now()` (the caller injects `nowIso`), so it is unit-testable offline.
import {
  buildDeploymentPayload,
  recordDeployment,
} from "../../deploy/deployment-record.mjs";

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

// #3158: the release workflow writes the ONE Deployment record for success and
// failure alike, carrying the owner's quote (spec
// 2026-10-16-release-pipeline-off-workstation §3 item 3).
describe("deployment-record — state + owner quote (#3158)", () => {
  const QUOTE = "Да, катим 0a1b2c на прод";

  it("state defaults to success and ownerQuote to null (the workstation path)", () => {
    const { deployment, status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-2026.10.21-1",
      notesText: "note",
      healthUrl: HEALTH,
      nowIso: NOW,
    });
    expect(status.state).toBe("success");
    expect(deployment.payload.ownerQuote).toBeNull();
    expect(deployment.description).toBe(
      `release release-2026.10.21-1 @ ${SHA.slice(0, 12)}`,
    );
  });

  it("the owner quote lands in the deployment description and payload", () => {
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: "release-2026.10.21-1",
      notesText: "note",
      healthUrl: HEALTH,
      nowIso: NOW,
      ownerQuote: QUOTE,
    });
    expect(deployment.payload.ownerQuote).toBe(QUOTE);
    expect(deployment.description).toContain(`«${QUOTE}»`);
    expect(deployment.description.length).toBeLessThanOrEqual(140);
  });

  it("a long quote is truncated in the description, kept whole in the payload", () => {
    const long = "к".repeat(400);
    const { deployment } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: "",
      healthUrl: HEALTH,
      nowIso: NOW,
      ownerQuote: long,
    });
    expect(deployment.description.length).toBeLessThanOrEqual(140);
    expect(deployment.payload.ownerQuote).toBe(long);
  });

  it("state failure → a failure status naming the failed release", () => {
    const { deployment, status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: "## 🚀 Релиз на PROD\nbody",
      healthUrl: HEALTH,
      nowIso: NOW,
      state: "failure",
      ownerQuote: QUOTE,
    });
    expect(status.state).toBe("failure");
    expect(status.description).toBe(`release failed @ ${SHA.slice(0, 12)}`);
    expect(
      deployment.description.startsWith(
        `failed release (untagged) @ ${SHA.slice(0, 12)}`,
      ),
    ).toBe(true);
    expect(deployment.payload.state).toBe("failure");
  });

  it("state error → the lost-contact record: verdict unknown, re-dispatch records it", () => {
    const { deployment, status } = buildDeploymentPayload({
      sha: SHA,
      releaseTag: null,
      notesText: "",
      healthUrl: HEALTH,
      nowIso: NOW,
      state: "error",
      ownerQuote: QUOTE,
    });
    expect(status.state).toBe("error");
    expect(status.description).toBe(
      `verdict unknown @ ${SHA.slice(0, 12)}: lost contact; re-dispatch the SHA to record it`,
    );
    expect(status.description.length).toBeLessThanOrEqual(140);
    expect(
      deployment.description.startsWith(
        `unknown release (untagged) @ ${SHA.slice(0, 12)}`,
      ),
    ).toBe(true);
    expect(deployment.payload.state).toBe("error");
    expect(deployment.payload.ownerQuote).toBe(QUOTE);
  });

  it("an unknown state is refused", () => {
    expect(() =>
      buildDeploymentPayload({
        sha: SHA,
        releaseTag: null,
        notesText: "",
        healthUrl: HEALTH,
        nowIso: NOW,
        state: "inactive",
      }),
    ).toThrow(/state/);
  });
});

describe("deployment-record — recordDeployment (#3158, moved from prod.mjs)", () => {
  const PREV = "b".repeat(40);
  const make = () => {
    const calls = { record: [], digest: [], tag: 0, log: [] };
    const deps = {
      latestReleaseTag: () => {
        calls.tag += 1;
        return "release-2026.10.21-1";
      },
      composeDigest: async (args) => {
        calls.digest.push(args);
        return { text: "## digest" };
      },
      createDeploymentRecord: (args) => {
        calls.record.push(args);
        return { ok: true, deploymentId: 7 };
      },
    };
    return { calls, deps, log: (l: string) => calls.log.push(l) };
  };

  it("success: latest tag + notes over prev..sha + the quote", async () => {
    const { calls, deps, log } = make();
    const res = await recordDeployment({
      prevSha: PREV,
      sha: SHA,
      state: "success",
      ownerQuote: "go",
      healthUrl: HEALTH,
      log,
      deps,
    });
    expect(res).toEqual({ ok: true, deploymentId: 7 });
    expect(calls.digest[0]).toMatchObject({ prevSha: PREV, newSha: SHA });
    expect(calls.record[0]).toMatchObject({
      sha: SHA,
      releaseTag: "release-2026.10.21-1",
      notesText: "## digest",
      state: "success",
      ownerQuote: "go",
    });
  });

  it("failure: no release tag is attributed (nothing was cut), notes still composed", async () => {
    const { calls, deps, log } = make();
    await recordDeployment({
      prevSha: PREV,
      sha: SHA,
      state: "failure",
      ownerQuote: "go",
      healthUrl: HEALTH,
      log,
      deps,
    });
    expect(calls.tag).toBe(0);
    expect(calls.record[0]).toMatchObject({
      releaseTag: null,
      state: "failure",
    });
  });

  it("no range (first deploy / same SHA) → empty notes, no digest call", async () => {
    const { calls, deps, log } = make();
    await recordDeployment({
      prevSha: null,
      sha: SHA,
      state: "success",
      healthUrl: HEALTH,
      log,
      deps,
    });
    expect(calls.digest).toHaveLength(0);
    expect(calls.record[0].notesText).toBe("");
  });

  it("never throws: a failing record seam only warns", async () => {
    const { calls, deps, log } = make();
    deps.createDeploymentRecord = () => {
      throw new Error("boom");
    };
    const res = await recordDeployment({
      prevSha: PREV,
      sha: SHA,
      state: "success",
      healthUrl: HEALTH,
      log,
      deps,
    });
    expect(res.ok).toBe(false);
    expect(calls.log.join("\n")).toMatch(/boom/);
  });
});
