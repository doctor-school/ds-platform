import { describe, expect, it } from "vitest";

import {
  dedupeRefs,
  extractApprovalClaims,
  extractCompletenessClaims,
  extractOwnerDirectiveClaims,
  extractRefs,
  extractTaskKindSurface,
  hasOwnerQuoteEvidence,
  parseClaim,
  resolveProvenance,
  verdictFor,
  verifyApprovalClaims,
  verifyCompletenessClaims,
  verifyOwnerDirectiveClaims,
  verifyRefs,
  verifyTaskKindSurface,
} from "../../gh/handoff-verify.mjs";

/**
 * Unit cover for `tools/gh/handoff-verify.mjs` (#743) — the deterministic
 * handoff-premise gate. Only the pure half (ref extraction, claim parsing,
 * verdict logic) is tested; the `gh`/`git` side goes through an injectable
 * runner, so nothing here shells out (same harness pattern as
 * task-worktree.spec.ts — imports the pure exports, never fires `main()`).
 */

/** Fake runner: canned gh JSON per (issue|pr, N), canned git exit codes. */
function fakeRunner(opts: {
  issues?: Record<number, "OPEN" | "CLOSED">;
  prs?: Record<number, "OPEN" | "CLOSED" | "MERGED">;
  ancestorShas?: string[];
  knownShas?: string[];
  branches?: Record<string, string>; // branch -> head sha
  provenance?: Record<number, { body: string; comments: { body: string }[] }>;
  issueMeta?: Record<number, { labels: { name: string }[]; body: string }>;
}) {
  const calls: string[][] = [];
  return {
    calls,
    gh(args: string[]) {
      calls.push(["gh", ...args]);
      const [kind, , n] = args; // "issue"|"pr", "view", "<n>"
      if (args.includes("labels,body")) {
        const meta = (opts.issueMeta ?? {})[Number(n)];
        if (!meta) return { status: 1, stdout: "", stderr: "GraphQL: not found (404)" };
        return { status: 0, stdout: JSON.stringify(meta), stderr: "" };
      }
      if (args.includes("body,comments")) {
        const prov = (opts.provenance ?? {})[Number(n)];
        if (!prov) return { status: 1, stdout: "", stderr: "GraphQL: not found (404)" };
        return { status: 0, stdout: JSON.stringify(prov), stderr: "" };
      }
      const table = kind === "pr" ? (opts.prs ?? {}) : (opts.issues ?? {});
      const state = table[Number(n)];
      if (!state) return { status: 1, stdout: "", stderr: "GraphQL: not found (404)" };
      return { status: 0, stdout: JSON.stringify({ state }), stderr: "" };
    },
    git(args: string[]) {
      calls.push(["git", ...args]);
      if (args[0] === "rev-parse") {
        const ref = args[3] ?? "";
        for (const [branch, sha] of Object.entries(opts.branches ?? {})) {
          if (ref === `refs/remotes/origin/${branch}` || ref === `refs/heads/${branch}`)
            return { status: 0, stdout: `${sha}\n`, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      }
      if (args[0] === "cat-file") {
        const sha = args[2].replace(/\^\{commit\}$/, "");
        const known = [...(opts.knownShas ?? []), ...(opts.ancestorShas ?? [])];
        return { status: known.includes(sha) ? 0 : 1, stdout: "", stderr: "" };
      }
      if (args[0] === "merge-base") {
        const sha = args[2];
        return { status: (opts.ancestorShas ?? []).includes(sha) ? 0 : 1, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected git call: ${args.join(" ")}` };
    },
  };
}

describe("handoff-verify extractRefs()", () => {
  it("extracts #N, PR #N, PR N and issue N forms with kind hints", () => {
    const refs = extractRefs("Merged PR #744; issue 747 closed; see #750 and PR 746.");
    expect(refs.map((r) => [r.kind, r.value])).toEqual([
      ["pr", 744],
      ["issue", 747],
      ["number", 750],
      ["pr", 746],
    ]);
  });

  it("does NOT extract bare numbers without a #/PR/issue marker", () => {
    expect(extractRefs("wave of 3 cycles, 120000 tokens, at 15:30")).toEqual([]);
  });

  it("extracts branch names on the repo <prefix>/<N>-<slug> convention", () => {
    const refs = extractRefs("branch tooling/743-handoff-verify is unmerged");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "branch", value: "tooling/743-handoff-verify" });
  });

  it("extracts 7-40 hex SHAs but requires a digit AND an a-f letter", () => {
    const refs = extractRefs("commit 4a89d2b landed; not 1234567; not decadea... but 2db24e4 yes");
    expect(refs.map((r) => r.value)).toEqual(["4a89d2b", "2db24e4"]);
    expect(refs.every((r) => r.kind === "sha")).toBe(true);
  });

  it("does not re-extract a hex-looking token inside a captured branch name", () => {
    const refs = extractRefs("see fix/123-deadbee1-thing");
    expect(refs).toEqual([
      expect.objectContaining({ kind: "branch", value: "fix/123-deadbee1-thing" }),
    ]);
  });

  it("carries the line so claims can be parsed per-occurrence", () => {
    const refs = extractRefs("line1 #10 merged\nline2 #10");
    expect(refs.map((r) => r.lineNo)).toEqual([1, 2]);
  });
});

describe("handoff-verify parseClaim()", () => {
  it("parses EN status keywords", () => {
    expect(parseClaim("PR #744 was merged")).toBe("merged");
    expect(parseClaim("#744 still OPEN")).toBe("open");
    expect(parseClaim("issue 747 closed")).toBe("closed");
    expect(parseClaim("#747 is Done")).toBe("closed");
    expect(parseClaim("branch is unmerged")).toBe("unmerged");
    expect(parseClaim("PR #12 not merged yet")).toBe("unmerged");
  });

  it("parses RU status keywords incl. ё-normalization", () => {
    expect(parseClaim("PR #744 смёржен")).toBe("merged");
    expect(parseClaim("#744 влит в main")).toBe("merged");
    expect(parseClaim("issue 747 закрыт")).toBe("closed");
    expect(parseClaim("#748 открыт")).toBe("open");
  });

  it("negated-merge wins over its positive substring", () => {
    expect(parseClaim("PR #12 не влит")).toBe("unmerged");
    expect(parseClaim("#12 не смёржен")).toBe("unmerged");
  });

  it("returns null when no status keyword is present", () => {
    expect(parseClaim("continue from #744 next session")).toBeNull();
  });
});

describe("handoff-verify verdictFor()", () => {
  it("matching claim → PASS; mismatching → STALE; no claim → INFO", () => {
    expect(verdictFor("merged", "merged")).toBe("PASS");
    expect(verdictFor("open", "closed")).toBe("STALE");
    expect(verdictFor(null, "open")).toBe("INFO");
  });

  it("closed claim accepts a merged PR, but merged claim rejects closed-unmerged", () => {
    expect(verdictFor("closed", "merged")).toBe("PASS");
    expect(verdictFor("merged", "closed")).toBe("STALE");
  });

  it("open/unmerged cross-accept for the git-ref domain", () => {
    expect(verdictFor("open", "unmerged")).toBe("PASS");
    expect(verdictFor("unmerged", "open")).toBe("PASS");
    expect(verdictFor("unmerged", "merged")).toBe("STALE");
  });

  it("not-found is STALE regardless of claim (incl. no claim)", () => {
    expect(verdictFor("merged", "not-found")).toBe("STALE");
    expect(verdictFor(null, "not-found")).toBe("STALE");
  });
});

describe("handoff-verify dedupeRefs()", () => {
  it("collapses repeated refs; claim rows subsume the claim-less occurrence", () => {
    const entries = dedupeRefs(extractRefs("#10 merged\nresume from #10\n#10 закрыт"));
    expect(entries).toHaveLength(1);
    expect(entries[0].claims.sort()).toEqual(["closed", "merged"]);
  });

  it("keeps one null claim when a ref has only claim-less occurrences", () => {
    const entries = dedupeRefs(extractRefs("resume from #10\nsee also #10"));
    expect(entries).toEqual([expect.objectContaining({ claims: [null] })]);
  });

  it("upgrades an unhinted #N to the hinted kind seen elsewhere", () => {
    const entries = dedupeRefs(extractRefs("#744 landed\nPR #744 merged"));
    expect(entries).toEqual([expect.objectContaining({ kind: "pr", value: 744 })]);
  });
});

describe("handoff-verify verifyRefs() with an injected runner", () => {
  it("issue claimed open but actually closed → STALE, exit-relevant count set", () => {
    const runner = fakeRunner({ issues: { 747: "CLOSED" } });
    const { rows, stale } = verifyRefs(extractRefs("issue 747 is open"), runner);
    expect(rows).toEqual([
      { verdict: "STALE", ref: "#747", claim: "open", actual: "closed" },
    ]);
    expect(stale).toBe(1);
  });

  it("PR claimed merged and actually merged → PASS", () => {
    const runner = fakeRunner({ prs: { 744: "MERGED" } });
    const { rows, stale } = verifyRefs(extractRefs("PR #744 merged"), runner);
    expect(rows).toEqual([
      { verdict: "PASS", ref: "#744", claim: "merged", actual: "merged" },
    ]);
    expect(stale).toBe(0);
  });

  it("unhinted #N falls back issue → pr on resolution", () => {
    const runner = fakeRunner({ prs: { 744: "MERGED" } }); // no issue 744
    const { rows } = verifyRefs(extractRefs("#744 merged"), runner);
    expect(rows[0]).toMatchObject({ verdict: "PASS", actual: "merged" });
  });

  it("gh 404 on both issue and pr → STALE not-found", () => {
    const runner = fakeRunner({});
    const { rows, stale } = verifyRefs(extractRefs("#999 closed"), runner);
    expect(rows[0]).toMatchObject({ verdict: "STALE", actual: "not-found" });
    expect(stale).toBe(1);
  });

  it("sha ancestry: ancestor of origin/main → merged PASS; known-but-unmerged → STALE vs merged claim", () => {
    const runner = fakeRunner({
      ancestorShas: ["4a89d2b"],
      knownShas: ["aaaa111"],
    });
    const merged = verifyRefs(extractRefs("commit 4a89d2b merged"), runner);
    expect(merged.rows[0]).toMatchObject({ verdict: "PASS", actual: "merged" });
    const unmerged = verifyRefs(extractRefs("commit aaaa111 влит"), runner);
    expect(unmerged.rows[0]).toMatchObject({ verdict: "STALE", actual: "unmerged" });
  });

  it("unknown sha → STALE not-found", () => {
    const { rows } = verifyRefs(extractRefs("commit bbbb222 merged"), fakeRunner({}));
    expect(rows[0]).toMatchObject({ verdict: "STALE", actual: "not-found" });
  });

  it("branch resolves via origin then ancestry; claim-less ref → INFO with actual printed", () => {
    const runner = fakeRunner({
      branches: { "feat/1-x": "cafe123" },
      knownShas: ["cafe123"],
    });
    const { rows, stale } = verifyRefs(extractRefs("continue on feat/1-x"), runner);
    expect(rows).toEqual([
      { verdict: "INFO", ref: "feat/1-x", claim: null, actual: "unmerged" },
    ]);
    expect(stale).toBe(0);
  });

  it("deleted branch (unresolvable) → STALE not-found", () => {
    const { rows } = verifyRefs(
      extractRefs("branch tooling/9-gone merged"),
      fakeRunner({}),
    );
    expect(rows[0]).toMatchObject({ verdict: "STALE", actual: "not-found" });
  });

  it("caches state lookups: one gh call for a ref repeated with two claims", () => {
    const runner = fakeRunner({ prs: { 5: "MERGED" } });
    const { rows } = verifyRefs(extractRefs("PR #5 merged\nPR #5 closed"), runner);
    expect(rows).toHaveLength(2);
    const ghViewCalls = runner.calls.filter((c) => c[0] === "gh");
    // issue-first fallback for "pr" hint is pr-first: exactly one pr view call.
    expect(ghViewCalls).toHaveLength(1);
  });
});

describe("handoff-verify extractApprovalClaims()", () => {
  it("extracts an EN owner-approved claim about an issue ref", () => {
    const claims = extractApprovalClaims("epic #778 is owner-approved, build it");
    expect(claims).toEqual([expect.objectContaining({ issue: 778, lineNo: 1 })]);
  });

  it("extracts a RU claim line (эпик #N согласован владельцем)", () => {
    const claims = extractApprovalClaims("эпик #806 согласован владельцем");
    expect(claims).toEqual([expect.objectContaining({ issue: 806 })]);
  });

  it("does NOT fire on Mode-a APPROVE lines without an owner token", () => {
    expect(extractApprovalClaims("Mode-a APPROVE on #744")).toEqual([]);
    expect(extractApprovalClaims("Mode (a) APPROVE — PR #744")).toEqual([]);
  });

  it("does NOT fire on plain approved/settled without an owner token", () => {
    expect(extractApprovalClaims("#744 approved and merged")).toEqual([]);
    expect(extractApprovalClaims("design for #744 is settled")).toEqual([]);
  });

  it("CODEOWNERS is not an owner token", () => {
    expect(extractApprovalClaims("#744 approved per CODEOWNERS")).toEqual([]);
  });

  it("requires an issue ref on the claim line", () => {
    expect(extractApprovalClaims("the epic is owner-approved")).toEqual([]);
  });

  it("dedupes per issue across lines", () => {
    const claims = extractApprovalClaims(
      "#10 owner-approved\nвладелец одобрил #10 и #11",
    );
    expect(claims.map((c) => c.issue)).toEqual([10, 11]);
  });
});

describe("handoff-verify approval provenance with an injected runner", () => {
  it("discovery-only provenance → STALE no-owner-provenance + stderr hint (AC1)", () => {
    const runner = fakeRunner({
      provenance: {
        778: {
          body: "Discovery: agent brainstorm produced this epic decomposition.",
          comments: [{ body: "Follow-up: WBS drafted in the session." }],
        },
      },
    });
    const claims = extractApprovalClaims("epic #778 owner-approved");
    const { rows, stale, hints } = verifyApprovalClaims(claims, runner);
    expect(rows).toEqual([
      {
        verdict: "STALE",
        ref: "#778",
        claim: "owner-approved",
        actual: "no-owner-provenance",
      },
    ]);
    expect(stale).toBe(1);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("#778");
    expect(hints[0]).toContain("no quotable owner turn");
  });

  it("owner-quoted «…» line in a comment → PASS (AC2)", () => {
    const runner = fakeRunner({
      provenance: {
        779: {
          body: "Epic body.",
          comments: [{ body: "Владелец: «делаем вариант Б, без Школ»." }],
        },
      },
    });
    const { rows, stale } = verifyApprovalClaims(
      extractApprovalClaims("#779 согласован владельцем"),
      runner,
    );
    expect(rows).toEqual([
      {
        verdict: "PASS",
        ref: "#779",
        claim: "owner-approved",
        actual: "owner-quoted",
      },
    ]);
    expect(stale).toBe(0);
  });

  it("Stage-A: GO marker in the body → PASS", () => {
    const runner = fakeRunner({
      provenance: { 780: { body: "Stage-A: GO (variant 2)", comments: [] } },
    });
    expect(resolveProvenance(runner, 780)).toBe("owner-quoted");
  });

  it("Stage-B: GO marker in a comment → PASS", () => {
    const runner = fakeRunner({
      provenance: {
        781: { body: "x", comments: [{ body: "Stage-B: GO" }] },
      },
    });
    expect(resolveProvenance(runner, 781)).toBe("owner-quoted");
  });

  it("owner token WITHOUT a quoted span is not provenance", () => {
    const runner = fakeRunner({
      provenance: {
        782: { body: "the owner probably wants this", comments: [] },
      },
    });
    expect(resolveProvenance(runner, 782)).toBe("no-owner-provenance");
  });

  it("gh 404 → STALE not-found", () => {
    const { rows, stale } = verifyApprovalClaims(
      extractApprovalClaims("#999 owner-approved"),
      fakeRunner({}),
    );
    expect(rows[0]).toMatchObject({ verdict: "STALE", actual: "not-found" });
    expect(stale).toBe(1);
  });
});

describe("handoff-verify extractTaskKindSurface()", () => {
  it("returns null when no implementation-class kind is declared (skip gate)", () => {
    expect(extractTaskKindSurface("Groom session: triage #768 before dispatch")).toBeNull();
  });

  it("fires on an IMPLEMENTATION declaration and collects issue refs", () => {
    expect(extractTaskKindSurface("Session: IMPLEMENTATION / orchestrate #768 and #770")).toEqual({
      issues: [768, 770],
    });
  });

  it("fires on a feature-iteration declaration", () => {
    expect(extractTaskKindSurface("kind: feature-iteration — build #900")).toEqual({
      issues: [900],
    });
  });
});

describe("handoff-verify verifyTaskKindSurface() with injected runner + readSpecDir (#778)", () => {
  const FEATURE = [{ name: "feature" }];
  // #768/#776 shape: user-facing portal auth surface owned by spec 003.
  const uiBody =
    "Remediate apps/portal/app/(auth)/register per specs/features/003-user-authentication/003-requirements-en.md";

  it("FIRE: impl-kind + feature issue + user-facing + spec has no NNN-product.md → one WARN, non-blocking exit 0 (AC1)", () => {
    const runner = fakeRunner({ issueMeta: { 768: { labels: FEATURE, body: uiBody } } });
    const input = extractTaskKindSurface("Session: IMPLEMENTATION / orchestrate #768");
    const readSpecDir = (slug: string) => {
      expect(slug).toBe("003-user-authentication");
      return ["003-design.md", "003-requirements-en.md", "003-requirements-ru.md", "003-scenarios.feature"];
    };
    const result = verifyTaskKindSurface(input, { runner, readSpecDir });
    expect(result.rows).toEqual([
      { verdict: "WARN", ref: "#768", claim: "user-facing", actual: "no-prd:003-user-authentication" },
    ]);
    expect(result.warn).toBe(1);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]).toContain("003-product.md");
    expect(result.hints[0]).toContain("do-product-discovery");
    // Non-blocking: the pipeline exposes only `warn`, never a `stale`
    // contribution — main() computes exit = stale > 0 ? 1 : 0, so a WARN-only
    // run exits 0.
    expect(result).not.toHaveProperty("stale");
  });

  it("PASS when the owning spec DOES carry a <NNN>-product.md PRD (AC2)", () => {
    const runner = fakeRunner({ issueMeta: { 768: { labels: FEATURE, body: uiBody } } });
    const readSpecDir = () => ["003-design.md", "003-requirements-en.md", "003-product.md"];
    const result = verifyTaskKindSurface(extractTaskKindSurface("IMPLEMENTATION #768"), {
      runner,
      readSpecDir,
    });
    expect(result.rows).toEqual([
      { verdict: "PASS", ref: "#768", claim: "user-facing", actual: "prd-present:003-user-authentication" },
    ]);
    expect(result.warn).toBe(0);
    expect(result.hints).toHaveLength(0);
  });

  it("PASS/skip a backend-only issue (no apps/*/(app|src) path token in body)", () => {
    const runner = fakeRunner({
      issueMeta: {
        800: { labels: FEATURE, body: "Backend handler in packages/api per specs/features/003-user-authentication/003-design.md" },
      },
    });
    const result = verifyTaskKindSurface(extractTaskKindSurface("IMPLEMENTATION #800"), {
      runner,
      readSpecDir: () => [],
    });
    expect(result.rows).toEqual([]);
    expect(result.warn).toBe(0);
  });

  it("SKIP the whole check when the handoff declares no implementation-class kind", () => {
    const result = verifyTaskKindSurface(
      extractTaskKindSurface("Groom / triage #768 — no dispatch yet"),
      { runner: fakeRunner({ issueMeta: { 768: { labels: FEATURE, body: uiBody } } }), readSpecDir: () => [] },
    );
    expect(result.rows).toEqual([]);
    expect(result.warn).toBe(0);
  });

  it("SKIP a non-feature-labelled issue (no WARN even when user-facing)", () => {
    const runner = fakeRunner({ issueMeta: { 768: { labels: [{ name: "tooling" }], body: uiBody } } });
    const result = verifyTaskKindSurface(extractTaskKindSurface("IMPLEMENTATION #768"), {
      runner,
      readSpecDir: () => ["003-design.md"],
    });
    expect(result.rows).toEqual([]);
    expect(result.warn).toBe(0);
  });

  it("SKIP silently when the named issue 404s (not an open issue)", () => {
    const result = verifyTaskKindSurface(extractTaskKindSurface("IMPLEMENTATION #999"), {
      runner: fakeRunner({}),
      readSpecDir: () => [],
    });
    expect(result.rows).toEqual([]);
    expect(result.warn).toBe(0);
  });
});

describe("handoff-verify extractCompletenessClaims() (#989 Detector A)", () => {
  it("extracts the conservative EN completeness phrases", () => {
    expect(
      extractCompletenessClaims(
        "tooling cluster fully drained\nbacklog is empty now\nall merged\nnothing left to review\ncluster complete",
      ).map((c) => c.phrase),
    ).toEqual([
      "cluster fully drained",
      "backlog is empty",
      "all merged",
      "nothing left",
      "cluster complete",
    ]);
  });

  it("extracts RU phrases incl. ё-normalization and safe inflections", () => {
    expect(
      extractCompletenessClaims(
        "всё вычищено\nхвост пуст\nкластер полностью закрыт",
      ).map((c) => c.phrase),
    ).toEqual(["все вычищен", "хвост пуст", "полностью закрыт"]);
    expect(extractCompletenessClaims("все вычищены")).toHaveLength(1);
    expect(extractCompletenessClaims("тема полностью закрыта")).toHaveLength(1);
  });

  it("one claim per line (first pattern wins), deduped by phrase across lines", () => {
    const claims = extractCompletenessClaims(
      "backlog empty, nothing left\nbacklog empty again",
    );
    expect(claims).toEqual([
      expect.objectContaining({ phrase: "backlog empty", lineNo: 1 }),
    ]);
  });

  it("a clean handoff produces NO claims (AC — no new WARNs)", () => {
    expect(
      extractCompletenessClaims(
        "Resume #944: PR #1012 merged, branch tooling/944-x deleted.\nNext: dispatch Mode-a on #1013, then merge when green.\nAll three PRs listed above are named individually.",
      ),
    ).toEqual([]);
  });
});

describe("handoff-verify verifyCompletenessClaims() (#989 Detector A)", () => {
  it("WARN row per claim + backlog:triage hint, non-blocking (no stale)", () => {
    const result = verifyCompletenessClaims(
      extractCompletenessClaims("the tooling cluster fully drained"),
    );
    expect(result.rows).toEqual([
      { verdict: "WARN", ref: "L1", claim: "set-complete", actual: "not-ref-checkable" },
    ]);
    expect(result.warn).toBe(1);
    expect(result.hints[0]).toContain("'cluster fully drained'");
    expect(result.hints[0]).toContain("pnpm backlog:triage");
    expect(result).not.toHaveProperty("stale");
  });

  it("empty input → no rows, warn 0", () => {
    expect(verifyCompletenessClaims([])).toEqual({ rows: [], hints: [], warn: 0 });
  });
});

describe("handoff-verify extractOwnerDirectiveClaims() (#989 Detector B)", () => {
  it("fires on the session-1c4b7478 opener (live failing fixture)", () => {
    const claims = extractOwnerDirectiveClaims(
      "Owner-directed (2026-07-16): prune the matured tooling cluster. Prune first, implement second.",
    );
    expect(claims).toEqual([
      expect.objectContaining({ phrase: "Owner-directed", lineNo: 1 }),
    ]);
  });

  it("fires on RU framings (по указанию владельца / одобрено владельцем)", () => {
    expect(
      extractOwnerDirectiveClaims("Действуем по указанию владельца."),
    ).toHaveLength(1);
    expect(
      extractOwnerDirectiveClaims("Решение одобрено владельцем ранее."),
    ).toHaveLength(1);
  });

  it("does NOT fire on issue-ref-tied approval claims (#806's domain — no double-fire)", () => {
    expect(extractOwnerDirectiveClaims("epic #778 is owner-approved, build it")).toEqual([]);
    expect(extractOwnerDirectiveClaims("эпик #806 согласован владельцем")).toEqual([]);
  });

  it("DOES fire on free-text owner-approved with no issue ref on the line", () => {
    expect(
      extractOwnerDirectiveClaims("the plan is owner-approved, proceed"),
    ).toEqual([expect.objectContaining({ phrase: "owner-approved" })]);
  });

  it("does not fire on plain owner mentions or Mode-a verdicts", () => {
    expect(extractOwnerDirectiveClaims("hand back to the owner for Stage-B")).toEqual([]);
    expect(extractOwnerDirectiveClaims("Mode-a APPROVE recorded")).toEqual([]);
  });
});

describe("handoff-verify hasOwnerQuoteEvidence() (#989 Detector B)", () => {
  it("guillemet «…» span anywhere → true", () => {
    expect(
      hasOwnerQuoteEvidence("plan\nOwner quote (2026-07-16): «Одобряю, оркеструй волны…»\nnext"),
    ).toBe(true);
  });

  it("attribution line (Owner quote / цитата) with a straight or curly quote → true", () => {
    expect(hasOwnerQuoteEvidence('Owner quote: "go ahead with wave 2"')).toBe(true);
    expect(hasOwnerQuoteEvidence("цитата владельца: “делаем”")).toBe(true);
  });

  it("no quoted span → false; unattributed straight quotes are NOT evidence", () => {
    expect(hasOwnerQuoteEvidence("Owner-directed: prune first")).toBe(false);
    expect(hasOwnerQuoteEvidence('run "pnpm test" then merge')).toBe(false);
  });
});

describe("handoff-verify verifyOwnerDirectiveClaims() (#989 Detector B)", () => {
  const opener =
    "Owner-directed (2026-07-16): prune the matured tooling cluster. Prune first, implement second.";

  it("live fixture: unquoted Owner-directed opener MUST WARN, non-blocking", () => {
    const result = verifyOwnerDirectiveClaims(
      extractOwnerDirectiveClaims(opener),
      hasOwnerQuoteEvidence(opener),
    );
    expect(result.rows).toEqual([
      { verdict: "WARN", ref: "L1", claim: "owner-directive", actual: "no-owner-quote" },
    ]);
    expect(result.warn).toBe(1);
    expect(result.hints[0]).toContain("'Owner-directed'");
    expect(result.hints[0]).toContain("UNCONFIRMED");
    expect(result).not.toHaveProperty("stale");
  });

  it("positive fixture: directive + verbatim owner quote → PASS, no WARN", () => {
    const text = `${opener}\nOwner quote (2026-07-16): «Одобряю, оркеструй волны…»`;
    const result = verifyOwnerDirectiveClaims(
      extractOwnerDirectiveClaims(text),
      hasOwnerQuoteEvidence(text),
    );
    expect(result.rows).toEqual([
      { verdict: "PASS", ref: "L1", claim: "owner-directive", actual: "owner-quote-present" },
    ]);
    expect(result.warn).toBe(0);
    expect(result.hints).toEqual([]);
  });

  it("quote-only handoff (no directive framing) → no rows at all", () => {
    const text = "Owner quote (2026-07-16): «Одобряю, оркеструй волны…»";
    const result = verifyOwnerDirectiveClaims(
      extractOwnerDirectiveClaims(text),
      hasOwnerQuoteEvidence(text),
    );
    expect(result).toEqual({ rows: [], hints: [], warn: 0 });
  });

  it("clean handoff with no directive phrases → no new WARNs (AC)", () => {
    const text = "Resume #944: PR #1012 merged. Next: Mode-a on #1013.";
    const result = verifyOwnerDirectiveClaims(
      extractOwnerDirectiveClaims(text),
      hasOwnerQuoteEvidence(text),
    );
    expect(result).toEqual({ rows: [], hints: [], warn: 0 });
  });
});
