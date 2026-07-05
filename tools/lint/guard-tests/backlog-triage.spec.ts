import { describe, expect, it } from "vitest";

import {
  classify,
  parseProseBlockers,
  subsystemName,
  type DepRef,
  type IssueInput,
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
