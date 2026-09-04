import { describe, expect, it } from "vitest";

import {
  buildMilestonesQuery,
  buildProjectItemsQuery,
  buildStatusMutation,
  CLAIM_STATUS,
  KNOWN,
  knownIdWarnings,
  LITMUS_LINE,
  milestonesPageWarning,
  parseAheadOfQueue,
  parseMilestones,
  pickProjectItem,
  queueHead,
  queuePosition,
  resolveStatusOption,
  trackOf,
  VALID_STATUS,
} from "../../gh/set-board-status.mjs";

/**
 * set-board-status — unit cover for `tools/gh/set-board-status.mjs`'s pure
 * seams (#993).
 *
 * The setter resolves a Projects v2 item via ONE targeted per-issue GraphQL
 * query (`issue(number:N){projectItems…}`) instead of paging the entire board
 * (`gh project item-list --limit 1000` burned hundreds of points of the
 * 5000/hr quota shared across all sessions). The impure half (gh spawns, the
 * mutation) is exercised live; query construction, item picking, option
 * resolution, and the known-id cross-check WARN are unit-tested here on the
 * established guard-test harness (pattern: merge-gate.spec.ts).
 */

/** A realistic projectItems.nodes fixture: the issue sits on two projects. */
const dsPlatformNode = {
  id: "PVTI_item_on_board",
  project: {
    id: KNOWN.projectId,
    number: 1,
    title: "DS Platform",
    field: {
      id: KNOWN.statusFieldId,
      name: "Status",
      options: [
        { id: "f75ad846", name: "Todo" },
        { id: "47fc9ee4", name: "In Progress" },
        { id: "f7f44e89", name: "Review" },
        { id: "98236657", name: "Done" },
      ],
    },
  },
};

const otherProjectNode = {
  id: "PVTI_item_elsewhere",
  project: { id: "PVT_other", number: 7, title: "Some Other Board", field: null },
};

describe("set-board-status buildProjectItemsQuery() (#993)", () => {
  it("builds a targeted per-issue query — repository/issue/projectItems, never a board-wide list", () => {
    const q = buildProjectItemsQuery(993);
    expect(q).toContain('repository(owner:"doctor-school",name:"ds-platform")');
    expect(q).toContain("issue(number:993)");
    expect(q).toContain("projectItems(first:10)");
    // the whole point of #993: no full-board item-list anywhere on the hot path
    expect(q).not.toContain("item-list");
    expect(q).not.toContain("items(first");
  });

  it("asks for everything the mutation needs in the one call (item id, project id, Status field + options)", () => {
    const q = buildProjectItemsQuery(1000);
    expect(q).toContain("project{id number title");
    expect(q).toContain('field(name:"Status")');
    expect(q).toContain("ProjectV2SingleSelectField");
    expect(q).toContain("options{id name}");
  });

  it("rejects a non-integer / non-positive issue number (the number is interpolated into the query)", () => {
    expect(() => buildProjectItemsQuery(0)).toThrow(/invalid issue number/);
    expect(() => buildProjectItemsQuery(-5)).toThrow(/invalid issue number/);
    expect(() => buildProjectItemsQuery(1.5)).toThrow(/invalid issue number/);
    // injection guard: strings never reach the query
    expect(() => buildProjectItemsQuery('1){x}"')).toThrow(/invalid issue number/);
  });
});

describe("set-board-status pickProjectItem() (#993)", () => {
  it("finds the item when the issue is on the board", () => {
    expect(pickProjectItem([dsPlatformNode], 1)).toBe(dsPlatformNode);
  });

  it("picks the project-1 item when the issue sits on multiple projects", () => {
    expect(pickProjectItem([otherProjectNode, dsPlatformNode], 1)).toBe(
      dsPlatformNode,
    );
  });

  it("returns null when the issue is not on the board (empty or foreign-project-only nodes)", () => {
    expect(pickProjectItem([], 1)).toBeNull();
    expect(pickProjectItem([otherProjectNode], 1)).toBeNull();
  });

  it("returns null for malformed input (missing nodes / project-less items)", () => {
    expect(pickProjectItem(null, 1)).toBeNull();
    expect(pickProjectItem(undefined, 1)).toBeNull();
    expect(pickProjectItem([{ id: "PVTI_x" }], 1)).toBeNull();
  });
});

describe("set-board-status resolveStatusOption() (#993)", () => {
  const options = dsPlatformNode.project.field.options;

  it("resolves every valid status name to its option", () => {
    for (const name of VALID_STATUS) {
      const option = resolveStatusOption(options, name);
      expect(option?.name).toBe(name);
      expect(option?.id).toBe(KNOWN.options[name as keyof typeof KNOWN.options]);
    }
  });

  it("returns null for an unknown status", () => {
    expect(resolveStatusOption(options, "Cancelled")).toBeNull();
    expect(resolveStatusOption(options, "done")).toBeNull(); // exact-name match only
  });

  it("returns null when options are absent", () => {
    expect(resolveStatusOption(undefined, "Done")).toBeNull();
    expect(resolveStatusOption(null, "Done")).toBeNull();
  });
});

describe("set-board-status knownIdWarnings() (#993)", () => {
  const resolvedClean = {
    projectId: KNOWN.projectId,
    statusFieldId: KNOWN.statusFieldId,
    options: dsPlatformNode.project.field.options,
  };

  it("is silent when the live-resolved ids match the documented constants", () => {
    expect(knownIdWarnings(resolvedClean)).toEqual([]);
  });

  it("WARNs on a project-id mismatch, naming both values", () => {
    const warnings = knownIdWarnings({ ...resolvedClean, projectId: "PVT_new" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PVT_new");
    expect(warnings[0]).toContain(KNOWN.projectId);
    expect(warnings[0]).toContain("using resolved value");
  });

  it("WARNs on a field-id mismatch", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      statusFieldId: "PVTSSF_new",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PVTSSF_new");
    expect(warnings[0]).toContain(KNOWN.statusFieldId);
  });

  it("WARNs per drifted option id, naming the option", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      options: [
        { id: "deadbeef", name: "Done" },
        { id: "f75ad846", name: "Todo" },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Done"');
    expect(warnings[0]).toContain("deadbeef");
  });

  it("does not WARN on an option name the constants do not document", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      options: [...resolvedClean.options, { id: "abc123", name: "Blocked" }],
    });
    expect(warnings).toEqual([]);
  });
});

describe("set-board-status buildStatusMutation() (#993)", () => {
  it("builds the updateProjectV2ItemFieldValue mutation from the resolved ids", () => {
    const m = buildStatusMutation(
      KNOWN.projectId,
      "PVTI_item_on_board",
      KNOWN.statusFieldId,
      "98236657",
    );
    expect(m).toContain("updateProjectV2ItemFieldValue");
    expect(m).toContain(`projectId:"${KNOWN.projectId}"`);
    expect(m).toContain('itemId:"PVTI_item_on_board"');
    expect(m).toContain(`fieldId:"${KNOWN.statusFieldId}"`);
    expect(m).toContain('singleSelectOptionId:"98236657"');
  });

  it("rejects empty or query-breaking id values (interpolation guard)", () => {
    expect(() => buildStatusMutation("", "i", "f", "o")).toThrow(/invalid projectId/);
    expect(() =>
      buildStatusMutation("PVT_x", 'i"}{', "f", "o"),
    ).toThrow(/invalid itemId/);
    // non-string ids never reach the mutation
    expect(() => buildStatusMutation("PVT_x", "i", null, "o")).toThrow(
      /invalid fieldId/,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * Queue-position guard (#1855) — the claim (`In Progress`) is where priority is
 * decided, so it refuses an Issue outside its track's queue-head milestone.
 * The rules live in tools/gh/lib/queue-position.mjs, re-exported by the setter.
 * ------------------------------------------------------------------------- */

const MILESTONES = [
  { title: "Витрина R1 — MVP витрины", due_on: "2026-09-06T00:00:00Z", state: "open" },
  { title: "Витрина R2 — Регистрация", due_on: "2026-09-07T00:00:00Z", state: "open" },
  { title: "Витрина R3 — Эфиры", due_on: "2026-09-21T00:00:00Z", state: "open" },
  { title: "Витрина R1.1 — Доделки MVP после запуска", due_on: null, state: "open" },
  { title: "Витрина · Позже", due_on: null, state: "open" },
  { title: "Академия R1 — Каталог", due_on: "2026-10-07T00:00:00Z", state: "open" },
  { title: "Академия · Позже", due_on: null, state: "open" },
  { title: "Platform ops & hardening", due_on: null, state: "open" },
];

describe("set-board-status trackOf() (#1855)", () => {
  it("returns the single track:* label an Issue carries", () => {
    expect(trackOf(["kind:tooling", "track:doctor"])).toBe("track:doctor");
    expect(trackOf(["track:academy"])).toBe("track:academy");
    expect(trackOf(["track:platform"])).toBe("track:platform");
  });

  it("accepts {name} label objects as gh returns them", () => {
    expect(trackOf([{ name: "track:doctor" }, { name: "kind:feat" }])).toBe("track:doctor");
  });

  it("is null with no track label, and deterministic when several are present", () => {
    expect(trackOf(["kind:chore"])).toBeNull();
    expect(trackOf([])).toBeNull();
    expect(trackOf(undefined)).toBeNull();
    // convention allows exactly one; several must not depend on array order
    expect(trackOf(["track:doctor", "track:academy"])).toBe(
      trackOf(["track:academy", "track:doctor"]),
    );
  });
});

describe("set-board-status queueHead() (#1855)", () => {
  it("is the open milestone with the earliest owner-set due_on", () => {
    expect(queueHead("track:doctor", MILESTONES)).toBe("Витрина R1 — MVP витрины");
    expect(queueHead("track:academy", MILESTONES)).toBe("Академия R1 — Каталог");
  });

  it("sorts an undated milestone after every dated one", () => {
    const undatedFirst = [
      { title: "Витрина R1.1 — Доделки MVP после запуска", due_on: null, state: "open" },
      { title: "Витрина R2 — Регистрация", due_on: "2026-09-07T00:00:00Z", state: "open" },
    ];
    expect(queueHead("track:doctor", undatedFirst)).toBe("Витрина R2 — Регистрация");
  });

  it("falls back to an undated milestone only when no dated one is open", () => {
    const undatedOnly = [
      { title: "Витрина R1.1 — Доделки MVP после запуска", due_on: null, state: "open" },
    ];
    expect(queueHead("track:doctor", undatedOnly)).toBe(
      "Витрина R1.1 — Доделки MVP после запуска",
    );
  });

  it("never picks a «· Позже» backlog milestone as the head", () => {
    const laterOnly = [{ title: "Витрина · Позже", due_on: null, state: "open" }];
    expect(queueHead("track:doctor", laterOnly)).toBeNull();
  });

  it("ignores closed milestones — a closed release is a shipped release", () => {
    const r1Closed = MILESTONES.map((m) =>
      m.title === "Витрина R1 — MVP витрины" ? { ...m, state: "closed" } : m,
    );
    expect(queueHead("track:doctor", r1Closed)).toBe("Витрина R2 — Регистрация");
  });

  it("has no queue for track:platform (no track release prefix) or unknown input", () => {
    expect(queueHead("track:platform", MILESTONES)).toBeNull();
    expect(queueHead(null, MILESTONES)).toBeNull();
    expect(queueHead("track:doctor", undefined)).toBeNull();
  });
});

describe("set-board-status queuePosition() (#1855)", () => {
  it("allows an Issue sitting in its track's queue head", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина R1 — MVP витрины", title: "form" },
      MILESTONES,
    );
    expect(p).toEqual({ ok: true, reason: "queue-head", head: "Витрина R1 — MVP витрины" });
  });

  it("refuses an Issue in a later release milestone, naming the head it jumps", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина R3 — Эфиры", title: "города" },
      MILESTONES,
    );
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("ahead-of-queue");
    expect(p.head).toBe("Витрина R1 — MVP витрины");
  });

  it("refuses an Issue parked in the «· Позже» backlog", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина · Позже", title: "nice to have" },
      MILESTONES,
    );
    expect(p.ok).toBe(false);
    expect(p.head).toBe("Витрина R1 — MVP витрины");
  });

  it("allows the non-roadmap «Platform ops & hardening» milestone", () => {
    const p = queuePosition(
      {
        track: "track:platform",
        milestone: "Platform ops & hardening",
        title: "tooling: guard",
      },
      MILESTONES,
    );
    expect(p).toMatchObject({ ok: true, reason: "platform-ops" });
  });

  it("allows a track:platform Issue that sits outside any track release", () => {
    const p = queuePosition({ track: "track:platform", milestone: "", title: "ci" }, MILESTONES);
    expect(p).toEqual({ ok: true, reason: "platform-track", head: null });
  });

  it("makes a track:platform Issue INSIDE a track release follow the milestone rule", () => {
    const ahead = queuePosition(
      { track: "track:platform", milestone: "Витрина R3 — Эфиры", title: "ci for R3" },
      MILESTONES,
    );
    expect(ahead.ok).toBe(false);
    const atHead = queuePosition(
      { track: "track:platform", milestone: "Витрина R1 — MVP витрины", title: "ci for R1" },
      MILESTONES,
    );
    expect(atHead).toMatchObject({ ok: true, reason: "queue-head" });
  });

  it("allows an `epic:` container, which carries no milestone by convention", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: null, title: "epic: two-site IA" },
      MILESTONES,
    );
    expect(p).toMatchObject({ ok: true, reason: "epic" });
  });

  it("refuses a non-epic, non-platform Issue with no milestone at all", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: null, title: "города: справочник" },
      MILESTONES,
    );
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("ahead-of-queue");
  });
});

describe("set-board-status parseAheadOfQueue() (#1855)", () => {
  it("is an error-free no-op when no trailing argv is given", () => {
    expect(parseAheadOfQueue([])).toEqual({ present: false, quote: null, error: null });
  });

  it("parses both `--ahead-of-queue <quote>` and `--ahead-of-queue=<quote>`", () => {
    expect(parseAheadOfQueue(["--ahead-of-queue", "города нужны сейчас"])).toEqual({
      present: true,
      quote: "города нужны сейчас",
      error: null,
    });
    expect(parseAheadOfQueue(["--ahead-of-queue=нужно сейчас"])).toEqual({
      present: true,
      quote: "нужно сейчас",
      error: null,
    });
  });

  it("requires a non-empty quote — the override IS the recorded owner reason", () => {
    expect(parseAheadOfQueue(["--ahead-of-queue"]).error).toMatch(/exactly one argument/);
    expect(parseAheadOfQueue(["--ahead-of-queue", "   "]).error).toMatch(/non-empty/);
    expect(parseAheadOfQueue(["--ahead-of-queue="]).error).toMatch(/non-empty/);
  });

  it("rejects unknown trailing arguments instead of silently ignoring them", () => {
    expect(parseAheadOfQueue(["--force"]).error).toMatch(/unknown argument/);
    expect(parseAheadOfQueue(["--ahead-of-queue", "a", "b"]).error).toMatch(/exactly one/);
  });
});

describe("set-board-status queue query plumbing (#1855)", () => {
  it("asks the per-issue query for the milestone, labels and title the rules need", () => {
    const q = buildProjectItemsQuery(1855);
    expect(q).toContain("milestone{title}");
    expect(q).toContain("labels(first:30){nodes{name}}");
  });

  it("reads only OPEN milestones and normalises dueOn to the rules' due_on shape", () => {
    expect(buildMilestonesQuery()).toContain("milestones(first:100,states:OPEN)");
    expect(
      parseMilestones({
        repository: {
          milestones: {
            nodes: [
              {
                title: "Витрина R1 — MVP витрины",
                dueOn: "2026-09-06T00:00:00Z",
                state: "OPEN",
              },
              { title: "Витрина · Позже", dueOn: null, state: "OPEN" },
              { notATitle: true },
            ],
          },
        },
      }),
    ).toEqual([
      { title: "Витрина R1 — MVP витрины", due_on: "2026-09-06T00:00:00Z", state: "open" },
      { title: "Витрина · Позже", due_on: null, state: "open" },
    ]);
    expect(parseMilestones({})).toEqual([]);
  });

  it("gates only the claim status — In Progress is the claim marker", () => {
    expect(CLAIM_STATUS).toBe("In Progress");
    expect(VALID_STATUS).toContain(CLAIM_STATUS);
  });
});

describe("set-board-status queue guard fails open on missing data (#1857)", () => {
  it("allows a release-milestone Issue when the milestones payload is empty", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина R3 — Эфиры", title: "города" },
      [],
    );
    expect(p).toEqual({ ok: true, reason: "no-queue-data", head: null });
  });

  it("allows a release-milestone Issue when its own track has no open release", () => {
    // Only the academy track has an open release here — the doctor milestone the
    // Issue carries is closed, so no head is computable for that track.
    const academyOnly = [{ title: "Академия R1 — Каталог", due_on: null, state: "open" }];
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина R3 — Эфиры", title: "города" },
      academyOnly,
    );
    expect(p).toEqual({ ok: true, reason: "no-queue-data", head: null });
  });

  it("allows a milestone-less non-epic Issue when no head can be computed", () => {
    const p = queuePosition({ track: "track:doctor", milestone: null, title: "города" }, []);
    expect(p).toEqual({ ok: true, reason: "no-queue-data", head: null });
  });

  it("still REFUSES when a head genuinely exists and differs — fail-open is not fail-off", () => {
    const p = queuePosition(
      { track: "track:doctor", milestone: "Витрина R3 — Эфиры", title: "города" },
      MILESTONES,
    );
    expect(p).toMatchObject({ ok: false, reason: "ahead-of-queue" });
    expect(p.head).toBe("Витрина R1 — MVP витрины");
  });
});

describe("set-board-status milestonesPageWarning() (#1857)", () => {
  it("asks for totalCount so a truncated single page cannot pass silently", () => {
    expect(buildMilestonesQuery()).toContain("totalCount");
  });

  it("is silent when the page holds every open milestone", () => {
    expect(
      milestonesPageWarning({
        repository: { milestones: { totalCount: 2, nodes: [{ title: "a" }, { title: "b" }] } },
      }),
    ).toBeNull();
    expect(milestonesPageWarning({})).toBeNull();
  });

  it("warns, naming both counts, when totalCount exceeds the returned nodes", () => {
    const w = milestonesPageWarning({
      repository: { milestones: { totalCount: 140, nodes: [{ title: "a" }] } },
    });
    expect(w).toMatch(/1 of 140/);
    expect(w).toMatch(/queue head may be wrong/);
  });
});

describe("set-board-status LITMUS_LINE staleness is recorded (#1857)", () => {
  it("is a constant whose docblock-recorded R1 scope is what the refusal prints", () => {
    expect(LITMUS_LINE).toContain("регистрацию врача");
    expect(LITMUS_LINE).toContain("ближайшего эфира");
  });
});
