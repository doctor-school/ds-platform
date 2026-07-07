import { describe, expect, it } from "vitest";

import {
  classify,
  findSiblingByEars,
  parseProseBlockers,
  subsystemName,
  type DepRef,
  type IssueInput,
  type SiblingIssue,
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
