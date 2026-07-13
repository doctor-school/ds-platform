import { describe, expect, it } from "vitest";

import {
  dedupeRefs,
  extractApprovalClaims,
  extractRefs,
  parseClaim,
  resolveProvenance,
  verdictFor,
  verifyApprovalClaims,
  verifyRefs,
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
}) {
  const calls: string[][] = [];
  return {
    calls,
    gh(args: string[]) {
      calls.push(["gh", ...args]);
      const [kind, , n] = args; // "issue"|"pr", "view", "<n>"
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
