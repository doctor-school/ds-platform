import { describe, expect, it } from "vitest";

import {
  classify,
  evaluateRationale,
  findMegaBlockers,
  findSiblingByEars,
  formatReport,
  mentionsIssue,
  parseProseBlockers,
  subsystemName,
  type DepRef,
  type IssueInput,
  type SiblingIssue,
  type Triage,
} from "../../backlog-triage";

/**
 * Unit cover for `backlog-triage.ts`'s pure seams (#497). The graph-resolution
 * `gh` I/O is a subprocess seam behind the entry-point guard; the CLASSIFIER and
 * the PROSE PARSER are pure and tested here — a fixture Issue-graph in →
 * ready/blocked classification out, no network.
 *
 * Driver: readiness/blocked must be COMPUTED from the dependency graph, never
 * asserted from a label (AGENTS.md §3.5, memory
 * `feedback_blocked_is_computed_not_labeled`). The board-mirrored cases:
 *   - #454 / #383 → blocked (open dep / absent owning-subsystem SSOT)
 *   - #468 / #400 → takeable (all deps closed, decision-debt notwithstanding)
 */

const issue = (
  number: number,
  labels: string[] = [],
  title = `Issue ${number}`,
): IssueInput => ({ number, title, labels });

describe("backlog-triage classify()", () => {
  it("all deps closed → takeable, even when decision-debt labelled", () => {
    const deps: DepRef[] = [
      { source: "prose", number: 460, state: "closed", title: "ids pipeline" },
    ];
    const t = classify(issue(468, ["tooling", "decision-debt"]), deps);
    expect(t.readiness).toBe("takeable");
    expect(t.reasons).toHaveLength(0);
    expect(t.isDecisionDebt).toBe(true);
  });

  it("no deps at all → takeable (decision-debt is NOT a blocker)", () => {
    const t = classify(issue(400, ["tooling", "decision-debt"]), []);
    expect(t.readiness).toBe("takeable");
    expect(t.reasons).toHaveLength(0);
  });

  it("an OPEN blocking issue → blocked + names the specific open dep", () => {
    const deps: DepRef[] = [
      {
        source: "prose",
        number: 220,
        state: "open",
        title: "[003] Auth — post-v1 backlog",
      },
    ];
    const t = classify(issue(454, ["feature:003", "decision-debt"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons).toHaveLength(1);
    expect(t.reasons[0]!.kind).toBe("open-issue");
    expect(t.reasons[0]!.number).toBe(220);
    expect(t.reasons[0]!.text).toContain("#220");
  });

  it("an absent owning-subsystem → blocked with a distinct reason kind", () => {
    const deps: DepRef[] = [
      { source: "prose", subsystem: "ADR-0009 retention.ts SSOT" },
      {
        source: "prose",
        subsystem: "First confirmed retention scenario from observability",
      },
    ];
    const t = classify(issue(383, ["feature:003", "decision-debt"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons).toHaveLength(2);
    expect(t.reasons.every((r) => r.kind === "absent-subsystem")).toBe(true);
    expect(t.reasons[0]!.text).toContain("retention.ts SSOT");
  });

  it("a CLOSED blocking issue is resolved — not a blocker", () => {
    const deps: DepRef[] = [
      { source: "native-blocked-by", number: 177, state: "closed" },
    ];
    expect(classify(issue(175), deps).readiness).toBe("takeable");
  });

  it("dedupes the same open dep discovered via native AND prose", () => {
    const deps: DepRef[] = [
      { source: "native-blocked-by", number: 220, state: "open" },
      { source: "prose", number: 220, state: "open" },
    ];
    const t = classify(issue(454), deps);
    expect(t.reasons).toHaveLength(1);
  });

  it("dedupes a repeated absent subsystem case-insensitively", () => {
    const deps: DepRef[] = [
      { source: "prose", subsystem: "retention.ts SSOT" },
      { source: "prose", subsystem: "Retention.ts SSOT" },
    ];
    expect(classify(issue(1), deps).reasons).toHaveLength(1);
  });

  it("an unknown-state dep is treated conservatively as non-blocking", () => {
    const deps: DepRef[] = [
      { source: "prose", number: 999, state: "unknown" },
    ];
    expect(classify(issue(1), deps).readiness).toBe("takeable");
  });

  it("an EARS prose-ref resolved to a CLOSED sibling → takeable + resolution note (#622/#551 shape)", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 1, number: 550, state: "closed", title: "EARS-1" },
    ];
    const t = classify(issue(551, ["feature:004-event-page-listing"]), deps);
    expect(t.readiness).toBe("takeable");
    expect(t.reasons).toHaveLength(0);
    expect(t.notes).toEqual(["prose ref resolved: EARS-1 closed as #550"]);
  });

  it("multiple EARS prose-refs all CLOSED → takeable with one note each (#557 shape)", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 7, number: 556, state: "closed" },
      { source: "prose", ears: 1, number: 550, state: "closed" },
    ];
    const t = classify(issue(557, ["feature:004-event-page-listing"]), deps);
    expect(t.readiness).toBe("takeable");
    expect(t.notes).toEqual([
      "prose ref resolved: EARS-7 closed as #556",
      "prose ref resolved: EARS-1 closed as #550",
    ]);
  });

  it("an EARS prose-ref whose sibling is still OPEN → blocked, named as that sibling", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 9, number: 558, state: "open", title: "EARS-9" },
    ];
    const t = classify(issue(1, ["feature:004-event-page-listing"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons).toHaveLength(1);
    expect(t.reasons[0]!.kind).toBe("open-issue");
    expect(t.reasons[0]!.text).toContain("EARS-9 → #558");
  });

  it("mixed EARS refs — one CLOSED, one OPEN → blocked (ALL must be closed)", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 1, number: 550, state: "closed" },
      { source: "prose", ears: 9, number: 558, state: "open" },
    ];
    const t = classify(issue(1, ["feature:004-event-page-listing"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons).toHaveLength(1);
    expect(t.reasons[0]!.number).toBe(558);
  });

  it("an EARS prose-ref with no sibling match falls back to absent-subsystem → blocked", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 1, subsystem: "EARS-1 (the event page shell)" },
    ];
    const t = classify(issue(1, ["feature:004-event-page-listing"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons[0]!.kind).toBe("absent-subsystem");
  });

  it("dedupes a repeated EARS resolution note", () => {
    const deps: DepRef[] = [
      { source: "prose", ears: 1, number: 550, state: "closed" },
      { source: "prose", ears: 1, number: 550, state: "closed" },
    ];
    expect(classify(issue(1), deps).notes).toHaveLength(1);
  });
});

describe("backlog-triage parseProseBlockers()", () => {
  it("inline 'Blocked by … #N' extracts the issue ref (#454 shape)", () => {
    const body =
      "# Dependencies\n\nBlocked by the secondary-phone verify path (003 post-v1 backlog #220).\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([220]);
  });

  it("'Blocked by nothing (… #460)' yields NO blocker (#468 shape)", () => {
    const body =
      "# Dependencies\n\nBlocked by nothing (ids artifact landed in #460). Related: #460.\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("a '## Blocked by' section with subsystem bullets → subsystem blockers (#383 shape)", () => {
    const body = [
      "## Blocked by",
      "",
      "- **ADR-0009 `retention.ts` SSOT** — the retention duration is the TS object at `packages/db/schema/pd/retention.ts`. It does **not exist yet**.",
      "- **First confirmed retention scenario from observability** — the trigger ADR-0003 §3 names.",
      "",
      "## Out of scope",
      "",
      "- Integrity hash-chain — stays v2.",
    ].join("\n");
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(2);
    expect(b[0]!.issues).toEqual([]);
    expect(b[0]!.subsystem).toBe("ADR-0009 retention.ts SSOT");
    expect(b[1]!.subsystem).toContain("First confirmed retention scenario");
  });

  it("ignores 'Sub-issue of #N' / 'Successor to #N' / 'Parent epic: #N' lineage (#400 shape)", () => {
    const body =
      "## Dependencies\n\n- Parent epic: #340 (design-system showcase). Successor to #351.\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("ignores a mid-sentence, quoted 'Blocked by' MENTION (#497 self-description shape)", () => {
    const body =
      'Scope: resolve each native blocked_by link AND any prose "Blocked by #N" / named owning-subsystem reference to its actual state.\n';
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("a '## Blocked by' section whose only bullet is '- None currently.' → zero blockers (takeable)", () => {
    const body = "## Blocked by\n\n- None currently.\n\n## Notes\n\n- n/a\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("a section bullet that DOES cite an issue is an issue blocker, not a subsystem", () => {
    const body = "## Blocked by\n\n- Needs #512 to land first.\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([512]);
    expect(b[0]!.subsystem).toBeUndefined();
  });

  it("inline '**Blocked by:** EARS-1 (…)' extracts the EARS ref, no #issue (#551 shape)", () => {
    const body =
      "## Dependencies\n\n**Blocked by:** EARS-1 (the `PublicEventPage` endpoint + page shell must exist first). Native link set on the parent's sub-issue graph.\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([]);
    expect(b[0]!.ears).toEqual([1]);
  });

  it("a clause naming several EARS extracts all of them (#557 shape)", () => {
    const body =
      "## Dependencies\n\n**Blocked by:** EARS-7 (listing endpoint + route) and EARS-1 (the event page the card links to). Native links on the parent's sub-issue graph.\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.ears).toEqual([7, 1]);
  });

  it("an explicit #N ref still wins over EARS extraction (issue-ref path unchanged)", () => {
    const body = "## Blocked by\n\n- EARS-3 handled by #512.\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([512]);
    expect(b[0]!.ears).toBeUndefined();
  });
});

describe("backlog-triage findSiblingByEars()", () => {
  const sibs: SiblingIssue[] = [
    { number: 550, title: "[004] EARS-1: public event-page SSR read endpoint", state: "closed" },
    { number: 551, title: "[004] EARS-2: event-page content set", state: "open" },
    { number: 558, title: "[004] EARS-12: cross-surface live-state consistency", state: "open" },
  ];

  it("matches the sibling carrying EARS-N in its title", () => {
    expect(findSiblingByEars(sibs, 1)!.number).toBe(550);
    expect(findSiblingByEars(sibs, 2)!.number).toBe(551);
  });

  it("is word-bounded — EARS-1 never matches EARS-12", () => {
    expect(findSiblingByEars(sibs, 1)!.number).toBe(550);
    expect(findSiblingByEars(sibs, 12)!.number).toBe(558);
  });

  it("returns undefined when no sibling carries the EARS", () => {
    expect(findSiblingByEars(sibs, 9)).toBeUndefined();
  });
});

describe("backlog-triage subsystemName()", () => {
  it("keeps the head phrase, drops the dash gloss and markdown", () => {
    expect(
      subsystemName(
        "- **ADR-0009 `retention.ts` SSOT** — the retention duration (5y)…",
      ),
    ).toBe("ADR-0009 retention.ts SSOT");
  });
});

// ── #853 provenance check — blocked_by edges need a recorded rationale ───────

describe("backlog-triage mentionsIssue()", () => {
  it("matches the canonical #N ref", () => {
    expect(mentionsIssue("Blocked by #729 — prod release lands first.", 729)).toBe(
      true,
    );
  });

  it("is digit-bounded — #729 never matches #7290, #72 never matches inside #729", () => {
    expect(mentionsIssue("see #7290 for detail", 729)).toBe(false);
    expect(mentionsIssue("see #729 for detail", 72)).toBe(false);
  });

  it("matches full-URL cross-reference forms (/issues/N and /pull/N)", () => {
    expect(
      mentionsIssue("https://github.com/o/r/issues/729 explains why", 729),
    ).toBe(true);
    expect(mentionsIssue("landed via https://github.com/o/r/pull/729", 729)).toBe(
      true,
    );
    expect(mentionsIssue("https://github.com/o/r/issues/7290", 729)).toBe(false);
  });

  it("finds a mention anywhere in a multi-line body+comments text", () => {
    const text = "## Context\n\nnothing here\n\n---\ncomment: depends on #729.";
    expect(mentionsIssue(text, 729)).toBe(true);
    expect(mentionsIssue(text, 651)).toBe(false);
  });
});

describe("backlog-triage evaluateRationale()", () => {
  it("present when the BLOCKED side mentions the blocker", () => {
    expect(evaluateRationale(651, 729, "needs #729 first", "no refs")).toBe(
      "present",
    );
  });

  it("present when the BLOCKER side mentions the blocked issue", () => {
    expect(evaluateRationale(651, 729, "no refs", "unblocks #651 on close")).toBe(
      "present",
    );
  });

  it("absent when both texts were fetched and neither mentions the other (the #729 orphan shape)", () => {
    expect(
      evaluateRationale(651, 729, "tooling guard scope", "prod release plan"),
    ).toBe("absent");
  });

  it("unknown when a text could not be fetched — never a false orphan", () => {
    expect(evaluateRationale(651, 729, undefined, "prod release plan")).toBe(
      "unknown",
    );
    expect(evaluateRationale(651, 729, "tooling guard scope", undefined)).toBe(
      "unknown",
    );
    expect(evaluateRationale(651, 729, undefined, undefined)).toBe("unknown");
  });

  it("a fetched mention still wins over the other side's failed fetch", () => {
    expect(evaluateRationale(651, 729, "needs #729 first", undefined)).toBe(
      "present",
    );
  });
});

describe("backlog-triage classify() — provenance-orphan marker (#853)", () => {
  it("an open native edge with ABSENT rationale is flagged '⚠ no recorded rationale'", () => {
    const deps: DepRef[] = [
      {
        source: "native-blocked-by",
        number: 729,
        state: "open",
        title: "prod release",
        rationale: "absent",
      },
    ];
    const t = classify(issue(651, ["tooling"]), deps);
    expect(t.readiness).toBe("blocked");
    expect(t.reasons[0]!.text).toContain("⚠ no recorded rationale");
    expect(t.reasons[0]!.rationale).toBe("absent");
  });

  it("an edge with a recorded rationale prints unchanged — no marker", () => {
    const deps: DepRef[] = [
      {
        source: "native-blocked-by",
        number: 729,
        state: "open",
        title: "prod release",
        rationale: "present",
      },
    ];
    const t = classify(issue(651, ["tooling"]), deps);
    expect(t.reasons[0]!.text).toBe("blocked by open #729 (prod release)");
    expect(t.reasons[0]!.text).not.toContain("⚠");
  });

  it("an unknown/unevaluated rationale never flags — missing data is not an orphan verdict", () => {
    const unknownDep: DepRef[] = [
      { source: "native-blocked-by", number: 729, state: "open", rationale: "unknown" },
    ];
    expect(classify(issue(651), unknownDep).reasons[0]!.text).not.toContain("⚠");
    const unsetDep: DepRef[] = [
      { source: "native-blocked-by", number: 729, state: "open" },
    ];
    expect(classify(issue(651), unsetDep).reasons[0]!.text).not.toContain("⚠");
  });
});

describe("backlog-triage mega-blocker rollup (#853 — the pre-unwiring #729 fixture)", () => {
  /**
   * Reproduces the 2026-07-13 graph shape: the 12 tooling Issues from #853's
   * Context each carried a native `blocked_by → #729` edge with NO mention of
   * #729 on either side (rationale absent), while one extra issue (#900) had a
   * genuine, documented dependency on #729 (rationale present). The check must
   * flag every fake edge and roll the node up with a per-edge verdict.
   */
  const FAKE_BLOCKED = [651, 676, 699, 700, 706, 746, 778, 780, 785, 787, 800, 811];

  const megaFixture = (): Triage[] => {
    const triaged = FAKE_BLOCKED.map((n) =>
      classify(issue(n, ["tooling"], `tooling task ${n}`), [
        {
          source: "native-blocked-by",
          number: 729,
          state: "open",
          title: "prod release readiness",
          rationale: "absent",
        },
      ]),
    );
    triaged.push(
      classify(issue(900, ["tooling"], "genuinely dependent task"), [
        {
          source: "native-blocked-by",
          number: 729,
          state: "open",
          title: "prod release readiness",
          rationale: "present",
        },
      ]),
    );
    return triaged;
  };

  it("findMegaBlockers: #729 rolls up with all 13 edges and per-edge rationale", () => {
    const mega = findMegaBlockers(megaFixture());
    expect(mega).toHaveLength(1);
    expect(mega[0]!.number).toBe(729);
    expect(mega[0]!.edges).toHaveLength(13);
    const absent = mega[0]!.edges.filter((e) => e.rationale === "absent");
    expect(absent.map((e) => e.blocked)).toEqual(FAKE_BLOCKED);
    expect(
      mega[0]!.edges.find((e) => e.blocked === 900)!.rationale,
    ).toBe("present");
  });

  it("a node blocking fewer than 5 open issues gets no rollup", () => {
    const triaged = [651, 676, 699, 700].map((n) =>
      classify(issue(n), [
        { source: "native-blocked-by", number: 729, state: "open", rationale: "absent" },
      ]),
    );
    expect(findMegaBlockers(triaged)).toEqual([]);
  });

  it("closed-dep and subsystem reasons never count toward the rollup", () => {
    const triaged = [1, 2, 3, 4, 5, 6].map((n) =>
      classify(issue(n), [
        { source: "native-blocked-by", number: 729, state: "closed" },
        { source: "prose", subsystem: "retention.ts SSOT" },
      ]),
    );
    expect(findMegaBlockers(triaged)).toEqual([]);
  });

  it("formatReport: every fake #729 edge is flagged in Blocked AND the rollup prints per-edge present|ABSENT", () => {
    const report = formatReport(megaFixture());
    // (1) each provenance-orphan edge carries the inline marker …
    for (const n of FAKE_BLOCKED) {
      const line = report
        .split("\n")
        .find((l, i, all) => all[i - 1]?.includes(`- #${n} `) && l.includes("#729"));
      expect(line, `blocked line for #${n}`).toBeDefined();
      expect(line).toContain("⚠ no recorded rationale");
    }
    // … (2) the documented edge prints unchanged …
    const legit = report
      .split("\n")
      .find((l, i, all) => all[i - 1]?.includes("- #900 ") && l.includes("#729"));
    expect(legit).toBeDefined();
    expect(legit).not.toContain("⚠");
    // … (3) and the mega-blocker section rolls up the node with verdicts.
    expect(report).toContain("## Mega-blockers");
    expect(report).toContain("- #729 blocks 13 open issue(s) — 12 edge(s) with NO recorded rationale");
    for (const n of FAKE_BLOCKED) {
      expect(report).toContain(`↳ #${n} rationale: ABSENT ⚠`);
    }
    expect(report).toContain("↳ #900 rationale: present");
  });

  it("formatReport: no mega-blocker section when no node crosses the threshold", () => {
    const report = formatReport([
      classify(issue(651), [
        { source: "native-blocked-by", number: 729, state: "open", rationale: "absent" },
      ]),
    ]);
    expect(report).not.toContain("## Mega-blockers");
  });
});
