import { describe, expect, it } from "vitest";

import {
  checksAllGreen,
  claimLabel,
  latestChecks,
  titleScopeIssue,
  classify,
  closesRefs,
  findLikelyDone,
  findOrphans,
  findStalled,
  findWaitForReuse,
  formatLikelyDone,
  formatOrphans,
  formatReleaseRotation,
  formatStalled,
  formatWaitForReuse,
  parseCapabilityRegistry,
  parseReuseField,
  parseStalledDays,
  releaseRotation,
  type OrphanInput,
  type StalledIssue,
  classifyPrBoardRows,
  detectClaim,
  evaluateRationale,
  findMegaBlockers,
  findSiblingByEars,
  formatClaimAge,
  formatPrBoardHygiene,
  formatReport,
  isStartClaimComment,
  isStopStateComment,
  mentionsIssue,
  parseProseBlockers,
  queueAnnotationFor,
  subsystemName,
  trackQueueHeads,
  type ClaimComment,
  type DepRef,
  type IssueInput,
  type PrBoardRow,
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

  // ── #919 the canonical empty-Dependencies placeholder is NO blocker ─────────
  // `**Blocked by:** — · **Blocks:** —` (em-dash) is the template's "nothing
  // here" marker. It must yield ZERO blockers (item takeable); the `· **Blocks:**
  // —` tail must never be swallowed into the Blocked-by clause and parsed as a
  // bogus subsystem name (#896/#897/#898/#902/#904/#905 falsely reported blocked).
  it("inline '**Blocked by:** — · **Blocks:** —' (em-dash) yields NO blocker (#919 shape)", () => {
    const body =
      "## Dependencies\n\n**Blocked by:** — · **Blocks:** —\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("the en-dash placeholder '**Blocked by:** – · **Blocks:** –' yields NO blocker (#919)", () => {
    const body = "## Dependencies\n\n**Blocked by:** – · **Blocks:** –\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("the hyphen placeholder '**Blocked by:** - · **Blocks:** -' yields NO blocker (#919)", () => {
    const body = "## Dependencies\n\n**Blocked by:** - · **Blocks:** -\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("an 'n/a' placeholder yields NO blocker (#919)", () => {
    const body = "## Dependencies\n\n**Blocked by:** n/a · **Blocks:** n/a\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  it("a section bullet that is a bare em-dash placeholder → zero blockers (#919)", () => {
    const body = "## Blocked by\n\n- —\n\n## Notes\n\n- something.\n";
    expect(parseProseBlockers(body)).toEqual([]);
  });

  // NEGATIVE LOCK (#919 Mode-a): a REAL dash-bearing blocker in the SAME combined
  // `· **Blocks:** —` line MUST still parse — this is the regression fence that a
  // loosened (substring) no-blocker anchor would break while the 5 positives pass.
  it("inline '**Blocked by:** #872 — needs ESP · **Blocks:** —' still parses the #872 blocker (#919 negative lock)", () => {
    const body =
      "## Dependencies\n\n**Blocked by:** #872 — needs ESP · **Blocks:** —\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([872]);
  });

  // NIT (#919 Mode-a): the `**Blocks:**` split boundary requires the `**`
  // emphasis, so a blocker clause whose prose contains the bare word "blocks"
  // is NOT truncated and its #ref survives.
  it("a blocker clause containing the bare word 'blocks' is not truncated (#919 split-boundary NIT)", () => {
    const body = "## Dependencies\n\n**Blocked by:** the content-blocks refactor #873.\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([873]);
  });

  // ── #1264: the DASH + PARENTHESISED empty-marker forms the repo actually ────
  // writes. Each survived normalisation and was classified as a named absent
  // owning subsystem, i.e. blocked — hiding five takeable Issues (#1188 #1221
  // #1222 #1238 #1240). One case per marker form in the docstring contract.
  const emptyMarkerForms: Array<[string, string]> = [
    ["em-dash + bare parenthesised none (#1221/#1222/#1240)", "— (none)"],
    ["… with a trailing period (#1221/#1222)", "— (none)."],
    ["a QUALIFIED tail after the marker word (#1238)", "— (none technical)"],
    [
      "a long qualified tail with inner punctuation (#1188)",
      "— (none known yet; the spec will surface backend dependencies, e.g. the ingestion worker)",
    ],
    ["en-dash + parenthesised", "– (none)"],
    ["hyphen + parenthesised", "- (none)"],
    ["dash + unparenthesised bare word", "— none"],
    ["dash + 'nothing'", "— nothing"],
    ["dash + 'n/a'", "— n/a"],
    ["dash + 'tbd'", "— tbd"],
    ["parenthesised with NO leading dash", "(none)"],
    ["upper-case marker word", "— (NONE)"],
  ];

  for (const [label, marker] of emptyMarkerForms) {
    it(`inline '**Blocked by:** ${marker}' yields NO blocker — ${label} (#1264)`, () => {
      const body = `## Dependencies\n\n**Blocked by:** ${marker}\n**Blocks:** ${marker}\n`;
      expect(parseProseBlockers(body)).toEqual([]);
    });

    it(`the combined '· **Blocks:**' Dependencies line with ${marker} yields NO blocker (#1264)`, () => {
      const body = `## Dependencies\n\n**Blocked by:** ${marker} · **Blocks:** ${marker}\n`;
      expect(parseProseBlockers(body)).toEqual([]);
    });

    it(`a '## Blocked by' section bullet '- ${marker}' yields NO blocker (#1264)`, () => {
      const body = `## Blocked by\n\n- ${marker}\n\n## Notes\n\n- something.\n`;
      expect(parseProseBlockers(body)).toEqual([]);
    });
  }

  // NEGATIVE LOCK (#1264) — THE important case. The failure this fix must not
  // introduce is the opposite one: over-matching would silently free genuinely
  // blocked rows. A REAL prose subsystem blocker stays a blocker.
  it("a REAL prose subsystem blocker is still classified blocked (#383 shape — #1264 negative lock)", () => {
    const body =
      "## Dependencies\n\n**Blocked by:** ADR-0009 retention.ts SSOT · **Blocks:** — (none)\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([]);
    expect(b[0]!.subsystem).toBe("ADR-0009 retention.ts SSOT");
  });

  it("a '## Blocked by' section bullet naming a real subsystem still blocks (#1264 negative lock)", () => {
    const body =
      "## Blocked by\n\n- ADR-0009 retention.ts SSOT\n- the notification-none-of-the-above worker\n\n## Notes\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(2);
    expect(b.map((x) => x.subsystem)).toEqual([
      "ADR-0009 retention.ts SSOT",
      "the notification-none-of-the-above worker",
    ]);
  });

  it("a dash-prefixed clause naming a REAL issue ref still parses that ref (#1264 negative lock)", () => {
    const body = "## Dependencies\n\n**Blocked by:** — #1173 (prod DNS cutover)\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.issues).toEqual([1173]);
  });

  it("'none' as a PREFIX of a real word never reads as the empty marker (#1264 word-boundary lock)", () => {
    const body = "## Dependencies\n\n**Blocked by:** nonexistent-user cleanup job\n";
    const b = parseProseBlockers(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.subsystem).toBe("nonexistent-user cleanup job");
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

// ── #811 parallel-session claim signal — IN-FLIGHT-ELSEWHERE ─────────────────
// Pure-function cover: plain-object probes in, ClaimSignal / report label out.
// No fs, no git, no paths — platform-agnostic by construction (CI runs Linux).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-13T12:00:00Z");

const comment = (body: string, atMsAgo: number): ClaimComment => ({
  body,
  createdAtMs: NOW - atMsAgo,
});

describe("backlog-triage detectClaim() (#811)", () => {
  it("a worktree .claude/worktrees/<N> present ⇒ IN-FLIGHT-ELSEWHERE (worktree)", () => {
    const c = detectClaim({ worktreeMtimeMs: NOW - 2 * HOUR, nowMs: NOW });
    expect(c).not.toBeNull();
    expect(c!.source).toBe("worktree");
    expect(claimLabel(c!)).toBe("IN-FLIGHT-ELSEWHERE (worktree, age 2h)");
  });

  it("a start/claim comment NEWER than the last stop-state ⇒ IN-FLIGHT-ELSEWHERE (start-comment)", () => {
    const c = detectClaim({
      comments: [
        comment("**Where I stopped:** after PR #700 merged.", 3 * DAY),
        comment("claim: session 2026-07-13 — taking the guard half", 1 * DAY),
      ],
      nowMs: NOW,
    });
    expect(c).not.toBeNull();
    expect(c!.source).toBe("start-comment");
    expect(claimLabel(c!)).toBe("IN-FLIGHT-ELSEWHERE (start-comment, age 1d)");
  });

  it("a stop-state NEWER than the last start-comment releases the claim ⇒ takeable (null)", () => {
    const c = detectClaim({
      comments: [
        comment("Starting on this now — plan: extend the classifier.", 2 * DAY),
        comment(
          "**Where I stopped:** classifier extended, PR pending.\n**What remains:** wire report.",
          1 * HOUR,
        ),
      ],
      nowMs: NOW,
    });
    expect(c).toBeNull();
  });

  it("no signal at all ⇒ null — the item stays plainly takeable", () => {
    expect(detectClaim({ nowMs: NOW })).toBeNull();
    expect(
      detectClaim({
        comments: [comment("Result: shipped in #700. Board set to Done.", HOUR)],
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("an ABANDONED worktree still flags — age surfaced, never auto-suppressed", () => {
    const c = detectClaim({ worktreeMtimeMs: NOW - 6 * DAY, nowMs: NOW });
    expect(c).not.toBeNull();
    expect(claimLabel(c!)).toBe("IN-FLIGHT-ELSEWHERE (worktree, age 6d)");
  });

  it("both signals present ⇒ the FRESHEST wins", () => {
    const c = detectClaim({
      worktreeMtimeMs: NOW - 5 * DAY,
      comments: [comment("claim: taking this", 10 * 60_000)],
      nowMs: NOW,
    });
    expect(c!.source).toBe("start-comment");
    expect(claimLabel(c!)).toBe("IN-FLIGHT-ELSEWHERE (start-comment, age 10m)");
  });

  it("a future worktree mtime (clock skew) clamps to age 0, never negative", () => {
    const c = detectClaim({ worktreeMtimeMs: NOW + HOUR, nowMs: NOW });
    expect(c!.ageMs).toBe(0);
    expect(claimLabel(c!)).toBe("IN-FLIGHT-ELSEWHERE (worktree, age <1m)");
  });
});

describe("backlog-triage claim-comment shape detection (#811)", () => {
  it("start/claim openers match on the first non-empty line", () => {
    expect(isStartClaimComment("claim: session abc — taking #811")).toBe(true);
    expect(isStartClaimComment("**Claim:** worktree created.")).toBe(true);
    expect(isStartClaimComment("Starting work — plan: extend classify().")).toBe(true);
    expect(isStartClaimComment("\n\nTaking this one for the wave-2 batch.")).toBe(true);
    expect(isStartClaimComment("In progress — see worktree 811.")).toBe(true);
  });

  it("a mid-comment 'starting' or a result comment never claims", () => {
    expect(isStartClaimComment("Result: done. Next session starting point: L45.")).toBe(false);
    expect(isStartClaimComment("Blocked by #729 — parked.")).toBe(false);
    expect(isStartClaimComment("")).toBe(false);
  });

  it("the four-field stop-state shape is detected by its canonical opener", () => {
    expect(
      isStopStateComment("**Where I stopped:** last commit abc123.\n**What remains:** tests."),
    ).toBe(true);
    expect(isStopStateComment("where I stopped: mid-review")).toBe(true);
    expect(isStopStateComment("claim: taking this")).toBe(false);
    expect(isStopStateComment("")).toBe(false);
  });
});

describe("backlog-triage formatClaimAge() (#811)", () => {
  it("renders minutes, hours, days at the expected boundaries", () => {
    expect(formatClaimAge(30_000)).toBe("<1m");
    expect(formatClaimAge(34 * 60_000)).toBe("34m");
    expect(formatClaimAge(2 * HOUR)).toBe("2h");
    expect(formatClaimAge(23 * HOUR)).toBe("23h");
    expect(formatClaimAge(3 * DAY)).toBe("3d");
  });
});

describe("backlog-triage formatReport() — IN-FLIGHT-ELSEWHERE rows (#811)", () => {
  it("a takeable item with a claim moves to 'In flight elsewhere' with the age-carrying label", () => {
    const claimed = classify(issue(811, ["tooling"], "claim signal"), []);
    claimed.claim = { source: "worktree", ageMs: 2 * HOUR };
    const free = classify(issue(700, ["tooling"], "free task"), []);
    const report = formatReport([claimed, free]);

    expect(report).toContain("## In flight elsewhere (1)");
    expect(report).toContain(
      "- #811 IN-FLIGHT-ELSEWHERE (worktree, age 2h) — claim signal",
    );
    expect(report).toContain("## Takeable (1)");
    expect(report).toContain("- #700 free task");
    expect(report).toContain("1 takeable, 1 in-flight-elsewhere, 0 blocked");
    // The claimed row is OUT of the takeable list.
    expect(report).not.toContain("- #811 claim signal");
  });

  it("no claims ⇒ report shape unchanged (no in-flight section, no count segment)", () => {
    const report = formatReport([classify(issue(700, [], "free task"), [])]);
    expect(report).not.toContain("In flight elsewhere");
    expect(report).not.toContain("in-flight-elsewhere");
    expect(report).toContain("1 takeable, 0 blocked");
  });
});

describe("backlog-triage queue grouping (#1855)", () => {
  const MILESTONES = [
    { title: "Витрина R1 — MVP витрины", due_on: "2026-09-06T00:00:00Z", state: "open" },
    { title: "Витрина R3 — Эфиры", due_on: "2026-09-21T00:00:00Z", state: "open" },
    { title: "Витрина · Позже", due_on: null, state: "open" },
    { title: "Академия R1 — Каталог", due_on: "2026-10-07T00:00:00Z", state: "open" },
    { title: "Platform ops & hardening", due_on: null, state: "open" },
  ];

  it("queueAnnotationFor maps each rule outcome onto the report's position tag", () => {
    expect(
      queueAnnotationFor(
        { title: "форма", labels: ["track:doctor"], milestone: "Витрина R1 — MVP витрины" },
        MILESTONES,
      ),
    ).toEqual({ position: "QUEUE-HEAD", head: "Витрина R1 — MVP витрины" });

    expect(
      queueAnnotationFor(
        { title: "города", labels: ["track:doctor"], milestone: "Витрина R3 — Эфиры" },
        MILESTONES,
      ),
    ).toEqual({ position: "AHEAD-OF-QUEUE", head: "Витрина R1 — MVP витрины" });

    expect(
      queueAnnotationFor(
        {
          title: "tooling: guard",
          labels: ["track:platform"],
          milestone: "Platform ops & hardening",
        },
        MILESTONES,
      ).position,
    ).toBe("PLATFORM");

    expect(
      queueAnnotationFor(
        { title: "epic: two-site IA", labels: ["track:doctor"], milestone: null },
        MILESTONES,
      ).position,
    ).toBe("EPIC");
  });

  it("trackQueueHeads reports the current release milestone of each product track", () => {
    expect(trackQueueHeads(MILESTONES)).toEqual([
      { track: "track:doctor", head: "Витрина R1 — MVP витрины" },
      { track: "track:academy", head: "Академия R1 — Каталог" },
    ]);
  });

  it("formatReport prints QUEUE-HEAD rows before AHEAD-OF-QUEUE ones, tagged with the head", () => {
    const head = classify(issue(900, ["tooling"], "форма регистрации"), []);
    head.queue = { position: "QUEUE-HEAD", head: "Витрина R1 — MVP витрины" };
    const ahead = classify(issue(800, ["tooling"], "справочник городов"), []);
    ahead.queue = { position: "AHEAD-OF-QUEUE", head: "Витрина R1 — MVP витрины" };

    const report = formatReport([ahead, head], trackQueueHeads(MILESTONES));

    expect(report).toContain("- #900 [QUEUE-HEAD] форма регистрации");
    expect(report).toContain(
      "- #800 [AHEAD-OF-QUEUE (head: Витрина R1 — MVP витрины)] справочник городов",
    );
    // ordering: the queue head is listed above the row that jumps it
    expect(report.indexOf("- #900")).toBeLessThan(report.indexOf("- #800"));
    // the ahead-of-queue row is TAGGED, never hidden
    expect(report).toContain("## Takeable (2)");
    // per-track head summary + the litmus line
    expect(report).toContain("queue head: track:doctor → Витрина R1 — MVP витрины");
    expect(report).toContain("queue head: track:academy → Академия R1 — Каталог");
    expect(report).toContain("блокирует ли это регистрацию врача");
  });

  it("no milestones (gh failure) ⇒ no queue summary and the report still renders", () => {
    const report = formatReport([classify(issue(700, [], "free task"), [])]);
    expect(report).not.toContain("queue head:");
    expect(report).toContain("- #700 free task");
  });

  it("no milestones ⇒ NO annotation at all, never a blanket AHEAD-OF-QUEUE (#1857)", () => {
    // The `gh api milestones` read is best-effort and degrades to []; tagging
    // every takeable row `[AHEAD-OF-QUEUE (head: none)]` would report a verdict
    // the tool never computed.
    expect(
      queueAnnotationFor(
        { title: "форма", labels: ["track:doctor"], milestone: "Витрина R1 — MVP витрины" },
        [],
      ),
    ).toBeNull();
    expect(
      queueAnnotationFor({ title: "города", labels: ["track:doctor"], milestone: null }, []),
    ).toBeNull();
  });

  it("a track with no open release milestone gets no annotation either (#1857)", () => {
    const academyOnly = [
      { title: "Академия R1 — Каталог", due_on: "2026-10-07T00:00:00Z", state: "open" },
    ];
    expect(
      queueAnnotationFor(
        { title: "города", labels: ["track:doctor"], milestone: "Витрина R3 — Эфиры" },
        academyOnly,
      ),
    ).toBeNull();
  });

  it("an un-annotated row renders bare — no tag, no [AHEAD-OF-QUEUE] (#1857)", () => {
    const bare = classify(issue(700, ["tooling"], "справочник городов"), []);
    const report = formatReport([bare], []);
    expect(report).toContain("- #700 справочник городов");
    expect(report).not.toContain("AHEAD-OF-QUEUE");
  });
});

describe("PR board hygiene (#1140)", () => {
  const row = (
    number: number,
    state: string,
    hasAssignee = true,
    hasMilestone = true,
  ): PrBoardRow => ({ number, state, hasAssignee, hasMilestone });

  describe("classifyPrBoardRows()", () => {
    it("flags MERGED and CLOSED rows as dead (case-insensitive state)", () => {
      const h = classifyPrBoardRows([
        row(10, "MERGED"),
        row(11, "closed"),
        row(12, "OPEN"),
      ]);
      expect(h.dead).toEqual([
        { number: 10, state: "MERGED" },
        { number: 11, state: "CLOSED" },
      ]);
      expect(h.unfielded).toEqual([]);
    });

    it("flags OPEN rows missing assignee and/or milestone, naming each", () => {
      const h = classifyPrBoardRows([
        row(20, "OPEN", false, true),
        row(21, "OPEN", true, false),
        row(22, "OPEN", false, false),
        row(23, "OPEN", true, true),
      ]);
      expect(h.unfielded).toEqual([
        { number: 20, missing: ["assignee"] },
        { number: 21, missing: ["milestone"] },
        { number: 22, missing: ["assignee", "milestone"] },
      ]);
      expect(h.dead).toEqual([]);
    });

    it("a dead row is never also checked for fields (merged PRs need none)", () => {
      const h = classifyPrBoardRows([row(30, "MERGED", false, false)]);
      expect(h.dead).toEqual([{ number: 30, state: "MERGED" }]);
      expect(h.unfielded).toEqual([]);
    });

    it("sorts both lists ascending by PR number", () => {
      const h = classifyPrBoardRows([
        row(9, "CLOSED"),
        row(3, "MERGED"),
        row(8, "OPEN", false, true),
        row(2, "OPEN", true, false),
      ]);
      expect(h.dead.map((r) => r.number)).toEqual([3, 9]);
      expect(h.unfielded.map((r) => r.number)).toEqual([2, 8]);
    });
  });

  describe("formatPrBoardHygiene()", () => {
    it("is SILENT (empty string) when the board is clean", () => {
      expect(
        formatPrBoardHygiene(
          classifyPrBoardRows([row(1, "OPEN", true, true)]),
        ),
      ).toBe("");
      expect(formatPrBoardHygiene({ dead: [], unfielded: [] })).toBe("");
    });

    it("renders both sub-blocks with a combined count in the heading", () => {
      const out = formatPrBoardHygiene(
        classifyPrBoardRows([
          row(10, "MERGED"),
          row(20, "OPEN", false, true),
        ]),
      );
      expect(out).toContain("## PR board hygiene (2)");
      expect(out).toContain("### Dead rows (1)");
      expect(out).toContain("- PR #10: MERGED (dead row)");
      expect(out).toContain("### Under-fielded open PRs (1)");
      expect(out).toContain("- PR #20: missing assignee");
    });

    it("omits a sub-block that has no rows", () => {
      const out = formatPrBoardHygiene(
        classifyPrBoardRows([row(10, "MERGED")]),
      );
      expect(out).toContain("### Dead rows (1)");
      expect(out).not.toContain("Under-fielded");
    });
  });
});

/**
 * Grooming sections (#1873) — the deterministic half of a backlog groom.
 * Fixture-driven: no `gh`, no filesystem, no platform-specific paths.
 */
describe("grooming sections (#1873)", () => {
  describe("parseReuseField", () => {
    it("parses canon / extract-from / new, including a multi-path value", () => {
      expect(
        parseReuseField(
          "## Reuse\n\nReuse: canon: tools/backlog-triage.ts (extend), apps/docs/content/skills/x.md\n",
        ),
      ).toEqual([
        { kind: "canon", path: "tools/backlog-triage.ts" },
        { kind: "canon", path: "apps/docs/content/skills/x.md" },
      ]);
      expect(
        parseReuseField("Reuse: extract-from: packages/room/src/a.tsx (#1722)"),
      ).toEqual([
        { kind: "extract-from", path: "packages/room/src/a.tsx", issue: 1722 },
      ]);
      expect(parseReuseField("Reuse: new: nothing canonical yet")).toEqual([
        { kind: "new", path: "" },
      ]);
    });

    it("ignores prose mentioning reuse and non-path values", () => {
      expect(parseReuseField("We should reuse the room shell somehow.")).toEqual(
        [],
      );
      expect(parseReuseField("Reuse: canon: RoomShell")).toEqual([]);
    });
  });

  describe("parseCapabilityRegistry", () => {
    const md = [
      "| Capability | Canonical location | Kind | Extraction / debt |",
      "| ---------- | ------------------ | ---- | ----------------- |",
      "| Live room UI | `packages/room` over `apps/portal/app/webinars` | app-local | tracked by **#1722** (open) |",
      "| Event card | `packages/design-system/src/primitives/webinar-card.tsx` | shared package | landed (#1517) |",
    ].join("\n");

    it("skips header + separator rows and collects every #N in the row", () => {
      const rows = parseCapabilityRegistry(md);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.capability).toBe("Live room UI");
      expect(rows[0]!.canonical).toContain("packages/room");
      expect(rows[0]!.issues).toEqual([1722]);
      expect(rows[1]!.issues).toEqual([1517]);
    });
  });

  describe("findWaitForReuse", () => {
    const registry = parseCapabilityRegistry(
      [
        "| Capability | Canonical location | Kind | Extraction / debt |",
        "| --- | --- | --- | --- |",
        "| Live room UI | `packages/room` | shared package | tracked by #1722 (open) |",
      ].join("\n"),
    );
    const building = {
      number: 1722,
      title: "Extract packages/room",
      track: "track:doctor",
      reuse: parseReuseField("Reuse: canon: packages/room"),
      building: true,
    };

    it("holds a track:academy Issue whose canon path the doctor track is building", () => {
      const rows = findWaitForReuse(
        [
          {
            number: 1900,
            title: "Academy room re-seat",
            track: "track:academy",
            reuse: parseReuseField("Reuse: canon: packages/room"),
            building: false,
          },
          building,
        ],
        registry,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        number: 1900,
        blocker: 1722,
        blockerTrack: "track:doctor",
        path: "packages/room",
        via: "registry",
      });
    });

    it("matches via the paired Issue's own Reuse: field when it is being built", () => {
      const rows = findWaitForReuse(
        [
          {
            number: 1900,
            title: "Academy calendar",
            track: "track:academy",
            reuse: parseReuseField("Reuse: canon: packages/calendar"),
            building: false,
          },
          {
            number: 1901,
            title: "Doctor calendar",
            track: "track:doctor",
            reuse: parseReuseField("Reuse: canon: packages/calendar"),
            building: true,
          },
        ],
        [],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blocker: 1901, via: "reuse-field" });
    });

    it("does not hold a `new:` ref, a same-track pair, or an unclaimed twin", () => {
      const base = { number: 1900, title: "A", building: false };
      expect(
        findWaitForReuse(
          [
            {
              ...base,
              track: "track:academy",
              reuse: parseReuseField("Reuse: new: greenfield"),
            },
            building,
          ],
          registry,
        ),
      ).toEqual([]);
      expect(
        findWaitForReuse(
          [
            {
              ...base,
              track: "track:doctor",
              reuse: parseReuseField("Reuse: canon: packages/room"),
            },
            building,
          ],
          registry,
        ),
      ).toEqual([]);
      expect(
        findWaitForReuse(
          [
            {
              ...base,
              track: "track:academy",
              reuse: parseReuseField("Reuse: canon: packages/calendar"),
            },
            {
              number: 1901,
              title: "B",
              track: "track:doctor",
              reuse: parseReuseField("Reuse: canon: packages/calendar"),
              building: false,
            },
          ],
          [],
        ),
      ).toEqual([]);
    });
  });

  describe("formatReport + wait-for-reuse", () => {
    const triage = (number: number): Triage => ({
      number,
      title: `Issue ${number}`,
      readiness: "takeable",
      reasons: [],
      notes: [],
      isDecisionDebt: false,
      stream: "product",
      noKindLabel: false,
    });

    it("lists a WAIT-FOR-REUSE row in its own section and NOT under Takeable", () => {
      const out = formatReport(
        [triage(1900), triage(1901)],
        [],
        [
          {
            number: 1900,
            title: "Academy room re-seat",
            track: "track:academy",
            path: "packages/room",
            blocker: 1722,
            blockerTrack: "track:doctor",
            via: "registry",
          },
        ],
      );
      expect(out).toContain("## Wait for reuse (1)");
      expect(out).toContain("### track:academy (1)");
      expect(out).toContain(
        "- #1900 WAIT-FOR-REUSE (#1722, track:doctor) via registry — `packages/room`",
      );
      expect(out).toContain("## Takeable (1)");
      expect(out).toContain("- #1901");
      expect(out).not.toContain("- #1900 Issue 1900");
    });

    it("prints exactly one `none` line for an empty section", () => {
      expect(formatWaitForReuse([])).toContain("\nnone");
      expect(formatOrphans([])).toContain("\nnone");
      expect(formatStalled([])).toContain("\nnone");
      expect(formatLikelyDone([])).toContain("\nnone");
      expect(formatReleaseRotation([])).toContain("\nnone");
    });
  });

  describe("findOrphans", () => {
    const heads = [
      { track: "track:academy", head: "Академия R1 — Архив записей" },
      { track: "track:doctor", head: "Витрина R1 — MVP витрины" },
    ];
    const row = (over: Partial<OrphanInput> = {}): OrphanInput => ({
      number: 1900,
      title: "Some work",
      labels: ["track:academy", "feature"],
      milestone: "Академия R3 — Города",
      hasNativeBlockedBy: false,
      hasParent: false,
      ...over,
    });

    it("flags an unattached off-head Issue with all three reason tokens", () => {
      const out = findOrphans([row()], heads);
      expect(out).toHaveLength(1);
      expect(out[0]!.reasons).toEqual([
        "no-blocker",
        "no-parent",
        "off-head (Академия R3 — Города)",
      ]);
      expect(formatOrphans(out)).toContain("### track:academy (1)");
    });

    it("never flags an attached, head-milestoned, epic/gate or headless-track Issue", () => {
      expect(findOrphans([row({ hasNativeBlockedBy: true })], heads)).toEqual(
        [],
      );
      expect(findOrphans([row({ hasParent: true })], heads)).toEqual([]);
      expect(
        findOrphans([row({ milestone: "Академия R1 — Архив записей" })], heads),
      ).toEqual([]);
      expect(findOrphans([row({ title: "epic: academy" })], heads)).toEqual([]);
      expect(findOrphans([row({ title: "gate: design" })], heads)).toEqual([]);
      expect(findOrphans([row()], [])).toEqual([]);
    });

    it("degrades to ONE skipped line when the board scan (the parent probe) failed", () => {
      // Without the board scan `hasParent` is false for every Issue, so the
      // section would tell the lead to re-link ~114 already-parented Issues.
      const out = findOrphans([row()], heads);
      const degraded = formatOrphans(out, false);
      expect(degraded).toContain("## Orphans (skipped)");
      expect(degraded).toContain("skipped — board scan failed (see Warnings)");
      expect(degraded).not.toContain("### track:academy");
      expect(degraded).not.toContain("no-parent`]");
      expect(degraded.split("\n")).toHaveLength(3);
      // The healthy path is unchanged.
      expect(formatOrphans(out, true)).toContain("### track:academy (1)");
    });
  });

  describe("closesRefs / checksAllGreen", () => {
    it("reads every closing keyword and ignores a plain mention", () => {
      expect(
        closesRefs("Closes #12\nFixes #7\nResolves #99\nsee #500"),
      ).toEqual([7, 12, 99]);
    });

    it("takes the LATEST run per check name and refuses a zero-check PR", () => {
      expect(
        checksAllGreen([
          {
            name: "ci",
            status: "COMPLETED",
            conclusion: "FAILURE",
            completedAt: "2026-09-05T06:00:00Z",
          },
          {
            name: "ci",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            completedAt: "2026-09-05T07:00:00Z",
          },
        ]),
      ).toBe(true);
      expect(
        checksAllGreen([
          {
            name: "ci",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            completedAt: "2026-09-05T07:00:00Z",
          },
          { name: "guards", status: "IN_PROGRESS", conclusion: null },
        ]),
      ).toBe(false);
      expect(checksAllGreen([])).toBe(false);
    });

    it("reads an in-flight re-run as NOT green even behind an older COMPLETED SUCCESS", () => {
      // The live payload for a running check: non-terminal status AND the
      // `0001-` placeholder `completedAt`, which sorts BEHIND the green attempt
      // it supersedes (review finding on PR #1875).
      const inFlight = [
        {
          name: "core",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          startedAt: "2026-09-05T06:00:00Z",
          completedAt: "2026-09-05T06:30:00Z",
        },
        {
          name: "core",
          status: "IN_PROGRESS",
          conclusion: null,
          startedAt: "2026-09-05T07:00:00Z",
          completedAt: "0001-01-01T00:00:00Z",
        },
      ];
      expect(checksAllGreen(inFlight)).toBe(false);
      expect(latestChecks(inFlight)).toHaveLength(1);
      expect(latestChecks(inFlight)[0]!.status).toBe("IN_PROGRESS");
      for (const state of ["QUEUED", "PENDING", "WAITING", "REQUESTED"]) {
        expect(
          checksAllGreen([
            {
              name: "core",
              status: state,
              conclusion: "SUCCESS",
              startedAt: "2026-09-05T07:00:00Z",
            },
          ]),
        ).toBe(false);
      }
      // …and a genuinely finished re-run still reads green.
      expect(
        checksAllGreen([
          {
            name: "core",
            status: "COMPLETED",
            conclusion: "FAILURE",
            startedAt: "2026-09-05T06:00:00Z",
            completedAt: "2026-09-05T06:30:00Z",
          },
          {
            name: "core",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            startedAt: "2026-09-05T07:00:00Z",
            completedAt: "2026-09-05T07:30:00Z",
          },
        ]),
      ).toBe(true);
    });
  });

  describe("findStalled / findLikelyDone", () => {
    const issue = (over: Partial<StalledIssue> = {}): StalledIssue => ({
      number: 1900,
      title: "Some work",
      labels: ["track:doctor"],
      claimAgeMs: null,
      ...over,
    });
    const DAY = 24 * 60 * 60 * 1000;
    const green = [
      {
        name: "ci",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-09-05T07:00:00Z",
      },
    ];

    it("flags a merged `Closes #N` whose Issue is still open (c) + Likely done", () => {
      const merged = [
        { number: 1880, title: "feat: thing", body: "Closes #1900" },
      ];
      const rows = findStalled({
        issues: [issue()],
        openPrs: [],
        mergedPrs: merged,
        stalledDays: 3,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe("MERGED-BUT-OPEN");
      expect(rows[0]!.number).toBe(1900);
      expect(formatStalled(rows)).toContain("### track:doctor (1)");
      expect(findLikelyDone([issue()], merged)).toEqual([
        { number: 1900, title: "Some work", track: "track:doctor", prs: [1880] },
      ]);
      // A closed Issue is not MERGED-BUT-OPEN — the keyword did its job.
      expect(
        findStalled({
          issues: [],
          openPrs: [],
          mergedPrs: merged,
          stalledDays: 3,
        }),
      ).toEqual([]);
    });

    it("flags a stale claim only past the threshold and only without an open PR", () => {
      const stale = {
        issues: [issue({ claimAgeMs: 5 * DAY })],
        openPrs: [],
        mergedPrs: [],
        stalledDays: 3,
      };
      expect(findStalled(stale)[0]!.kind).toBe("STALE-CLAIM");
      expect(findStalled({ ...stale, stalledDays: 7 })).toEqual([]);
      expect(
        findStalled({
          ...stale,
          openPrs: [
            {
              number: 42,
              title: "feat: x",
              body: "Closes #1900",
              headRefOid: "abc",
              reviews: [],
              checks: [],
            },
          ],
        }),
      ).toEqual([]);
    });

    it("flags a head-pinned APPROVE + green PR as READY-TO-LAND; a stale pin or red CI is nothing", () => {
      const pr = {
        number: 1868,
        title: "tooling: thing",
        body: "Closes #1900",
        headRefOid: "deadbeefcafe",
        reviews: [
          {
            body: "## Mode (a) Review\n\nVERDICT: APPROVE\n",
            commit_id: "deadbeefcafe",
            submitted_at: "2026-09-05T07:30:00Z",
          },
        ],
        checks: green,
      };
      const rows = findStalled({
        issues: [issue()],
        openPrs: [pr],
        mergedPrs: [],
        stalledDays: 3,
      });
      expect(rows.map((r) => r.kind)).toEqual(["READY-TO-LAND"]);
      expect(rows[0]!.number).toBe(1868);
      expect(rows[0]!.track).toBe("track:doctor");
      expect(rows[0]!.detail).toContain("closes #1900");
      expect(
        findStalled({
          issues: [issue()],
          openPrs: [{ ...pr, headRefOid: "0000000newhead" }],
          mergedPrs: [],
          stalledDays: 3,
        }),
      ).toEqual([]);
      expect(
        findStalled({
          issues: [issue()],
          openPrs: [
            {
              ...pr,
              checks: [
                { name: "ci", status: "COMPLETED", conclusion: "FAILURE" },
              ],
            },
          ],
          mergedPrs: [],
          stalledDays: 3,
        }),
      ).toEqual([]);
    });

    it("Likely done takes a `type(N):` title scope and REFUSES a bare mention or an epic", () => {
      expect(titleScopeIssue("tooling(1873): thing")).toBe(1873);
      expect(titleScopeIssue("feat(1722-slug)!: thing")).toBe(1722);
      expect(titleScopeIssue("feat: no scope")).toBeNull();

      // Positive: the Issue is the Conventional-Commit scope of a merged PR.
      const scoped = [
        { number: 1881, title: "feat(1900): the slice", body: "no keyword" },
      ];
      expect(findLikelyDone([issue()], scoped)).toEqual([
        { number: 1900, title: "Some work", track: "track:doctor", prs: [1881] },
      ]);

      // Negative: a bare `#N` mention is roadmap/board prose, not delivery
      // (the rule that flagged 106 of 191 open Issues — review on PR #1875).
      expect(
        findLikelyDone([issue()], [
          {
            number: 1882,
            title: "tooling(1848): roadmap course-correction",
            body: "board dates on the chain: #1900 stays behind #1899",
          },
        ]),
      ).toEqual([]);

      // Negative: an epic is a long-lived container every slice PR names.
      expect(
        findLikelyDone([issue({ title: "epic: academy surface" })], [
          { number: 1883, title: "feat(1900): a slice", body: "Closes #1900" },
        ]),
      ).toEqual([]);
      expect(
        findLikelyDone([issue({ title: "gate: Stage-B for 017" })], scoped),
      ).toEqual([]);

      expect(formatLikelyDone(findLikelyDone([issue()], scoped))).toContain(
        "delivered by merged PR #1881",
      );
    });
  });

  describe("releaseRotation", () => {
    const milestones = [
      {
        title: "Витрина R1 — MVP витрины",
        due_on: "2026-09-10T00:00:00Z",
        state: "open",
      },
      {
        title: "Витрина R2 — Профиль",
        due_on: "2026-09-24T00:00:00Z",
        state: "open",
      },
      {
        title: "Витрина R0 — Прошлый",
        due_on: "2026-08-01T00:00:00Z",
        state: "open",
      },
      { title: "Витрина · Позже", due_on: null, state: "open" },
    ];
    const now = Date.parse("2026-09-05T00:00:00Z");

    it("orders a track's milestones and flags EMPTY-NEXT / ALL-CLOSED-STILL-OPEN / POZHE", () => {
      const doctor = releaseRotation(
        milestones,
        [
          { milestone: "Витрина R2 — Профиль" },
          { milestone: "Витрина · Позже" },
          { milestone: "Витрина · Позже" },
        ],
        now,
      ).find((t) => t.track === "track:doctor")!;
      expect(doctor.head).toBe("Витрина R0 — Прошлый");
      expect(doctor.rows.map((r) => r.title)).toEqual([
        "Витрина R0 — Прошлый",
        "Витрина R1 — MVP витрины",
        "Витрина R2 — Профиль",
        "Витрина · Позже",
      ]);
      expect(doctor.rows[0]!.flags).toEqual([
        "QUEUE-HEAD",
        "ALL-CLOSED-STILL-OPEN",
      ]);
      expect(doctor.rows[1]!.flags).toEqual(["EMPTY-NEXT"]);
      expect(doctor.rows[2]!.flags).toEqual([]);
      expect(doctor.rows[3]!.flags).toEqual(["POZHE: 2"]);
      const out = formatReleaseRotation([doctor]);
      expect(out).toContain("### track:doctor (head: Витрина R0 — Прошлый)");
      expect(out).toContain("[EMPTY-NEXT]");
    });

    it("does not flag EMPTY-NEXT when the next release is filled", () => {
      const doctor = releaseRotation(
        milestones,
        [{ milestone: "Витрина R1 — MVP витрины" }],
        now,
      ).find((t) => t.track === "track:doctor")!;
      expect(doctor.rows[1]!.flags).toEqual([]);
    });

    it("buckets a non-track milestone under track:platform", () => {
      expect(
        releaseRotation(
          [{ title: "Platform ops & hardening", due_on: null, state: "open" }],
          [],
          now,
        ).map((t) => t.track),
      ).toEqual(["track:platform"]);
    });
  });

  describe("parseStalledDays", () => {
    it("defaults to 3, accepts an explicit value, rejects garbage", () => {
      expect(parseStalledDays([])).toBe(3);
      expect(parseStalledDays(["--stalled-days", "7"])).toBe(7);
      expect(parseStalledDays(["--stalled-days", "-2"])).toBe(3);
      expect(parseStalledDays(["--stalled-days"])).toBe(3);
    });
  });
});
