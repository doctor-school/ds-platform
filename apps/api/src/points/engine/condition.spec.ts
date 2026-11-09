import { describe, expect, it } from "vitest";
import type { PointsCondition } from "@ds/schemas";
import {
  checkConditionBounds,
  conditionTypeContext,
  evaluateCondition,
  typecheckCondition,
  typecheckConditionForTriggers,
  type ConditionEnvironment,
  type ConditionTypeContext,
  type ConditionValue,
} from "./condition.js";

// 025 EARS-34 — the condition AST: publish-time type check, language bounds and
// the pure evaluator. Predicate values are injected; nothing is looked up here.

const types: ConditionTypeContext = {
  attributes: {
    mode: { type: "string" },
    share: { type: "integer" },
    startsAt: { type: "instant" },
    flagged: { type: "boolean" },
    registrationId: { type: "string", nullable: true },
  },
  predicates: {
    "person.phoneVerified": {
      name: "person.phoneVerified",
      subject: "person",
      result: { type: "boolean" },
    },
    "person.completedLessons": {
      name: "person.completedLessons",
      subject: "person",
      result: { type: "integer" },
    },
    "person.referrer": {
      name: "person.referrer",
      subject: "person",
      result: { type: "string", nullable: true },
    },
    "item.priceIn": {
      name: "item.priceIn",
      subject: "item",
      args: { currency: { type: "string" } },
      result: { type: "integer", nullable: true },
    },
  },
  settings: { "setting.presence.share": { type: "integer" } },
};

function env(
  attributes: Record<string, unknown>,
  predicates: Record<string, ConditionValue> = {},
  calls: { name: string; args: Record<string, ConditionValue> }[] = [],
): ConditionEnvironment {
  return {
    types,
    attributes,
    predicates: {
      resolve: async (name, args) => {
        calls.push({ name, args });
        if (!(name in predicates)) throw new Error(`unexpected ${name}`);
        return predicates[name] as ConditionValue;
      },
    },
    settings: { "setting.presence.share": 30 },
  };
}

const base = {
  mode: "online",
  share: 40,
  startsAt: "2026-11-09T10:00:00+03:00",
  flagged: false,
  registrationId: null,
};

describe("025 EARS-34 condition evaluation", () => {
  it("025 EARS-34: an absent condition is true", async () => {
    expect(await evaluateCondition(undefined, env(base))).toBe(true);
  });

  it.each<[PointsCondition, boolean]>([
    [{ eq: [{ attr: "mode" }, "online"] }, true],
    [{ eq: [{ attr: "mode" }, "offline"] }, false],
    [{ ne: [{ attr: "mode" }, "offline"] }, true],
    [{ ne: [{ attr: "mode" }, "online"] }, false],
    [{ gt: [{ attr: "share" }, 39] }, true],
    [{ gt: [{ attr: "share" }, 40] }, false],
    [{ gte: [{ attr: "share" }, 40] }, true],
    [{ gte: [{ attr: "share" }, 41] }, false],
    [{ lt: [{ attr: "share" }, 41] }, true],
    [{ lt: [{ attr: "share" }, 40] }, false],
    [{ lte: [{ attr: "share" }, 40] }, true],
    [{ lte: [{ attr: "share" }, 39] }, false],
    [{ in: [{ attr: "mode" }, ["offline", "online"]] }, true],
    [{ in: [{ attr: "mode" }, ["offline", "open"]] }, false],
    [{ eq: [{ attr: "flagged" }, false] }, true],
    [{ eq: [{ attr: "registrationId" }, null] }, true],
    [{ ne: [{ attr: "registrationId" }, null] }, false],
    [{ gte: [{ attr: "share" }, { setting: "setting.presence.share" }] }, true],
    [{ lt: [{ attr: "share" }, { setting: "setting.presence.share" }] }, false],
  ])("025 EARS-34: comparison %j → %s", async (cond, expected) => {
    expect(await evaluateCondition(cond, env(base))).toBe(expected);
  });

  it("025 EARS-34: instants compare by time, whatever the offset", async () => {
    const at = env(base);
    expect(
      await evaluateCondition(
        { eq: [{ attr: "startsAt" }, "2026-11-09T07:00:00Z"] },
        at,
      ),
    ).toBe(true);
    expect(
      await evaluateCondition(
        { gt: [{ attr: "startsAt" }, "2026-11-09T06:59:59Z"] },
        at,
      ),
    ).toBe(true);
    expect(
      await evaluateCondition(
        { lt: [{ attr: "startsAt" }, "2026-11-09T07:00:00Z"] },
        at,
      ),
    ).toBe(false);
  });

  it("025 EARS-34: all / any / not combine and short-circuit", async () => {
    const calls: { name: string; args: Record<string, ConditionValue> }[] = [];
    const e = env(base, { "person.phoneVerified": true }, calls);
    expect(
      await evaluateCondition(
        {
          all: [
            { eq: [{ attr: "mode" }, "offline"] },
            { eq: [{ pred: "person.phoneVerified" }, true] },
          ],
        },
        e,
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    expect(
      await evaluateCondition(
        {
          any: [
            { eq: [{ attr: "mode" }, "online"] },
            { eq: [{ pred: "person.phoneVerified" }, true] },
          ],
        },
        e,
      ),
    ).toBe(true);
    expect(calls).toEqual([]);
    expect(
      await evaluateCondition({ not: { eq: [{ attr: "mode" }, "online"] } }, e),
    ).toBe(false);
    expect(
      await evaluateCondition(
        {
          all: [
            { eq: [{ attr: "mode" }, "online"] },
            { not: { eq: [{ pred: "person.phoneVerified" }, false] } },
          ],
        },
        e,
      ),
    ).toBe(true);
  });

  it("025 EARS-34: a predicate operand reads only the injected resolver, with evaluated args", async () => {
    const calls: { name: string; args: Record<string, ConditionValue> }[] = [];
    const e = env(
      base,
      {
        "person.referrer": "00000000-0000-4000-8000-000000000009",
        "person.completedLessons": 1,
        "item.priceIn": null,
      },
      calls,
    );
    expect(
      await evaluateCondition(
        {
          all: [
            { ne: [{ pred: "person.referrer" }, null] },
            { gte: [{ pred: "person.completedLessons" }, 1] },
          ],
        },
        e,
      ),
    ).toBe(true);
    expect(
      await evaluateCondition(
        {
          gte: [
            { pred: "item.priceIn", args: { currency: { attr: "mode" } } },
            1,
          ],
        },
        e,
      ),
    ).toBe(false);
    expect(calls).toContainEqual({
      name: "item.priceIn",
      args: { currency: "online" },
    });
  });

  it("025 EARS-34: an ordering comparison against null is false", async () => {
    const e = env(base, { "item.priceIn": null });
    for (const op of ["gt", "gte", "lt", "lte"] as const) {
      const cond = {
        [op]: [{ pred: "item.priceIn", args: { currency: "rub" } }, 0],
      } as PointsCondition;
      expect(await evaluateCondition(cond, e), op).toBe(false);
    }
  });

  it("025 EARS-34: a setting the environment lacks fails loudly, never as false", async () => {
    const e = { ...env(base), settings: {} };
    await expect(
      evaluateCondition(
        { gte: [{ attr: "share" }, { setting: "setting.presence.share" }] },
        e,
      ),
    ).rejects.toThrow(/setting\.presence\.share/);
  });
});

describe("025 EARS-34 publish-time type check", () => {
  it("025 EARS-34: well-typed trees over every operand kind pass", () => {
    const ok: PointsCondition[] = [
      { eq: [{ attr: "mode" }, "online"] },
      { in: [{ attr: "mode" }, ["online", "offline"]] },
      { in: [{ attr: "registrationId" }, ["x", null]] },
      { gte: [{ attr: "share" }, { setting: "setting.presence.share" }] },
      { lt: [{ attr: "startsAt" }, "2026-12-01T00:00:00Z"] },
      { ne: [{ pred: "person.referrer" }, null] },
      { gte: [{ pred: "item.priceIn", args: { currency: "rub" } }, 50] },
      {
        all: [
          { not: { eq: [{ attr: "flagged" }, true] } },
          { any: [{ eq: [{ pred: "person.phoneVerified" }, true] }] },
        ],
      },
    ];
    for (const cond of ok) {
      expect(typecheckCondition(cond, types), JSON.stringify(cond)).toEqual([]);
    }
  });

  it.each<[PointsCondition, (string | number)[], RegExp]>([
    [
      { eq: [{ attr: "sponsorId" }, "x"] },
      ["eq", 0, "attr"],
      /unknown attribute/,
    ],
    [
      { eq: [{ pred: "person.salesCount" }, 1] },
      ["eq", 0, "pred"],
      /unknown predicate/,
    ],
    [
      { gte: [{ attr: "share" }, { setting: "setting.nope" }] },
      ["gte", 1, "setting"],
      /unknown setting/,
    ],
    [{ eq: [{ attr: "mode" }, 1] }, ["eq"], /string.*integer/],
    [{ gt: [{ attr: "mode" }, "a"] }, ["gt", 0], /integer or instant/],
    [{ gt: [{ attr: "flagged" }, true] }, ["gt", 0], /integer or instant/],
    [{ lt: [{ attr: "startsAt" }, "tomorrow"] }, ["lt"], /instant/],
    [{ eq: [{ attr: "mode" }, null] }, ["eq"], /not nullable/],
    [{ in: [{ attr: "share" }, [1, "two"]] }, ["in", 1, 1], /integer/],
    [{ in: [{ attr: "mode" }, ["a", null]] }, ["in", 1, 1], /not nullable/],
    [
      { gte: [{ pred: "item.priceIn" }, 1] },
      ["gte", 0, "args", "currency"],
      /missing argument/,
    ],
    [
      { gte: [{ pred: "item.priceIn", args: { currency: 1 } }, 1] },
      ["gte", 0, "args", "currency"],
      /string/,
    ],
    [
      {
        gte: [{ pred: "item.priceIn", args: { currency: "rub", extra: 1 } }, 1],
      },
      ["gte", 0, "args", "extra"],
      /unknown argument/,
    ],
    [
      {
        all: [
          { eq: [{ attr: "mode" }, "online"] },
          { not: { eq: [{ attr: "nope" }, 1] } },
        ],
      },
      ["all", 1, "not", "eq", 0, "attr"],
      /unknown attribute/,
    ],
  ])("025 EARS-34: %j is refused at its field path", (cond, path, message) => {
    const issues = typecheckCondition(cond, types);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(path);
    expect(issues[0]?.message).toMatch(message);
  });

  it("025 EARS-34: the check runs against EVERY trigger fact type of the catalog", () => {
    expect(conditionTypeContext("lesson.completed").attributes).toHaveProperty(
      "mode",
    );
    expect(
      typecheckConditionForTriggers({ eq: [{ attr: "mode" }, "online"] }, [
        "lesson.completed",
        "module.completed",
      ]),
    ).toEqual([]);
    const mixed = typecheckConditionForTriggers(
      { eq: [{ attr: "mode" }, "online"] },
      ["lesson.completed", "phone.verified"],
    );
    expect(mixed).toEqual([
      expect.objectContaining({
        path: ["eq", 0, "attr"],
        message: expect.stringMatching(
          /phone\.verified.*unknown attribute mode/,
        ),
      }),
    ]);
    expect(
      typecheckConditionForTriggers(
        {
          all: [
            { ne: [{ pred: "person.referrer" }, null] },
            { gte: [{ pred: "person.completedLessons" }, 1] },
            {
              gte: [
                { attr: "presenceSharePercent" },
                { setting: "setting.presence.share" },
              ],
            },
          ],
        },
        ["attendance.confirmed"],
      ),
    ).toEqual([]);
    expect(
      typecheckConditionForTriggers({ eq: [{ attr: "mode" }, "online"] }, [
        "lesson.watched",
      ]),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(
          /unregistered fact type lesson\.watched/,
        ),
      }),
    ]);
  });
});

describe("025 EARS-34 language bounds", () => {
  const leaf: PointsCondition = { eq: [{ attr: "mode" }, "online"] };
  function nest(depth: number): PointsCondition {
    let cond = leaf;
    for (let i = 1; i < depth; i += 1) cond = { not: cond };
    return cond;
  }

  it("025 EARS-34: depth 8 passes, depth 9 is refused at the too-deep node", () => {
    expect(checkConditionBounds(nest(8))).toEqual([]);
    const issues = checkConditionBounds(nest(9));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(Array(8).fill("not"));
    expect(issues[0]?.message).toMatch(/depth/);
  });

  it("025 EARS-34: 64 nodes pass, 65 are refused", () => {
    // all(21 × eq(attr, literal)) = 1 + 21 × 3 = 64 nodes.
    const of = (n: number): PointsCondition => ({
      all: Array.from({ length: n }, () => leaf),
    });
    expect(checkConditionBounds(of(21))).toEqual([]);
    const over = checkConditionBounds({
      all: [...(of(21) as { all: PointsCondition[] }).all, { not: leaf }],
    });
    expect(over).toEqual([
      expect.objectContaining({
        path: [],
        message: expect.stringMatching(/64 nodes/),
      }),
    ]);
  });

  it("025 EARS-34: an in-list of 100 passes, 101 is refused at its path", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    expect(checkConditionBounds({ in: [{ attr: "mode" }, list(100)] })).toEqual(
      [],
    );
    expect(
      checkConditionBounds({ all: [{ in: [{ attr: "mode" }, list(101)] }] }),
    ).toEqual([
      expect.objectContaining({
        path: ["all", 0, "in", 1],
        message: expect.stringMatching(/100/),
      }),
    ]);
  });

  it("025 EARS-34: the type check refuses an over-bound tree before typing it", () => {
    expect(typecheckCondition(nest(9), types)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/depth/) }),
    ]);
  });
});
