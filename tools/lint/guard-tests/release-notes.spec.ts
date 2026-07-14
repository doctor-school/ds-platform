import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Pure seams exported from the aggregated PROD release-note digest (Issue #868).
// Importing them does NOT fire the script's `main()` — it is guarded behind an
// entry-point check, the same idiom as tools/ci/post-product-note.mjs. The digest
// reuses that per-PR delivery's seams (extractNote / noteIsReal /
// labelsAreProductKind / envFooter) and adds two of its own, covered here.
import {
  buildDigest,
  buildTechnicalReleaseLine,
  extractPrNumbers,
} from "../../deploy/release-notes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "..", "deploy", "release-notes.mjs");

const PROD_FOOTER = "🚀 Среда: PROD — выкачено на продакшен.";
const HEX_A = "a".repeat(40);
const HEX_B = "b".repeat(40);

/** Run the script as a subprocess with a controlled env, returning code + streams. */
function runScript(
  args: string[],
  env: Record<string, string | undefined>,
): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    // Clean env so a stray DELIVERY_ENV / webhook in the shell can't leak in.
    env: { PATH: process.env.PATH, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ── extractPrNumbers (pure) ─────────────────────────────────────────────────
describe("release-notes — extractPrNumbers (pure)", () => {
  it("a single `(#5)` → [5]", () => {
    expect(extractPrNumbers(["feat: thing (#5)"])).toEqual([5]);
  });

  it("multiple `(#N)` in one subject → the LAST (the squash-merge number)", () => {
    // `"... (#651) (#875)"` refers to PR #875 — the merge number is appended last.
    expect(extractPrNumbers(["tooling(ci): re-run guards (#651) (#875)"])).toEqual([
      875,
    ]);
  });

  it("a subject with no `(#N)` is skipped", () => {
    expect(extractPrNumbers(["chore: no pr ref here"])).toEqual([]);
    expect(extractPrNumbers(["feat: a (#1)", "raw commit"])).toEqual([1]);
  });

  it("dedupes repeated numbers, order preserved by first appearance", () => {
    expect(
      extractPrNumbers(["feat: a (#7)", "fix: b (#3)", "revert (#7)"]),
    ).toEqual([7, 3]);
  });

  it("non-array input → []", () => {
    expect(extractPrNumbers(undefined as unknown as string[])).toEqual([]);
  });
});

// ── buildDigest (pure) ──────────────────────────────────────────────────────
describe("release-notes — buildDigest (pure)", () => {
  const notes = [
    { note: "Первая фича для врачей.", title: "feat: one", url: "https://x/1" },
    { note: "Починили вход по SMS.", title: "fix: two", url: "https://x/2" },
  ];

  it("includes both note texts and both linked titles, with the header", () => {
    const { text } = buildDigest({ notes, newSha: HEX_A, footer: PROD_FOOTER });
    expect(text).toContain("## 🚀 Релиз на PROD");
    expect(text).toContain("Первая фича для врачей.");
    expect(text).toContain("Починили вход по SMS.");
    expect(text).toContain("[feat: one](https://x/1)");
    expect(text).toContain("[fix: two](https://x/2)");
    expect(text).toContain(HEX_A.slice(0, 12));
  });

  it("the footer is the LAST line", () => {
    const { text } = buildDigest({ notes, newSha: HEX_A, footer: PROD_FOOTER });
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toBe(PROD_FOOTER);
  });

  it("a note with `$(whoami)` / backticks appears VERBATIM (injection-safe)", () => {
    const evil = "Опасная заметка `$(whoami)` и $(rm -rf /).";
    const { text } = buildDigest({
      notes: [{ note: evil, title: "feat: x", url: "https://x/9" }],
      newSha: HEX_A,
      footer: PROD_FOOTER,
    });
    expect(text).toContain(evil);
  });
});

// ── buildTechnicalReleaseLine (pure) ────────────────────────────────────────
describe("release-notes — buildTechnicalReleaseLine (pure)", () => {
  it("mentions «Технический релиз», the short SHA, footer last", () => {
    const { text } = buildTechnicalReleaseLine({
      newSha: HEX_B,
      footer: PROD_FOOTER,
    });
    expect(text).toContain("Технический релиз");
    expect(text).toContain(HEX_B.slice(0, 12));
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toBe(PROD_FOOTER);
  });
});

// ── subprocess invariants (hermetic: every case skips/throws BEFORE git/gh) ──
describe("release-notes — main() ordering invariants (subprocess)", () => {
  it("first deploy (`--prev-sha none`, NO DELIVERY_ENV) → exit 0, skip (marker never turns a clean skip red)", () => {
    const { code, stdout } = runScript(
      ["--dry-run", "--prev-sha", "none", "--new-sha", HEX_A],
      {}, // no DELIVERY_ENV — the green skip must precede the fail-loud
    );
    expect(code).toBe(0);
    expect(stdout).toContain("first deploy");
  });

  it("prev == new (redeploy, NO DELIVERY_ENV) → exit 0, skip «redeploy» (before the env check)", () => {
    const { code, stdout } = runScript(
      ["--dry-run", "--prev-sha", HEX_A, "--new-sha", HEX_A],
      {},
    );
    expect(code).toBe(0);
    expect(stdout).toContain("redeploy");
  });

  it("unknown DELIVERY_ENV with a real range + webhook → exit 1 (env check precedes git/gh/network)", () => {
    // Webhook set, NOT dry-run, prev != new, both valid hex → the ONLY thing that
    // stops this from touching git/gh is the DELIVERY_ENV fail-loud, which must be
    // ordered before any range work. Deterministic + offline.
    const { code, stderr } = runScript(
      ["--prev-sha", HEX_A, "--new-sha", HEX_B],
      {
        MATTERMOST_WEBHOOK_URL: "https://mattermost.invalid/hooks/x",
        DELIVERY_ENV: "staging",
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("DELIVERY_ENV");
  });

  it("no webhook + not dry-run → exit 0, «not configured» (before the env check)", () => {
    const { code, stdout } = runScript(["--prev-sha", HEX_A, "--new-sha", HEX_B], {
      // no MATTERMOST_WEBHOOK_URL, no DELIVERY_ENV
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not configured");
  });
});
