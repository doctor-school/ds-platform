import { describe, expect, it } from "vitest";
import {
  instructionQuoteSource,
  validateStageB,
} from "../lib/stage-b-evidence";
const sha = "a".repeat(40);
const base = `Stage-B: GO\nStage-B-head: ${sha}\nStage-B-recorded-at: 2026-09-06T00:00:00Z\nStage-B-owner-quote: Approved this live room\nStage-B-source: owner-relay:session-123#message-4\nStage-B-live-url: http://localhost:3000/room`;
describe("EARS-1920: Stage-B current approval evidence", () => {
  it("accepts the complete owner-relay record without treating shared login as identity", () =>
    expect(validateStageB([{ body: base }], sha, [], {}).ok).toBe(true));
  it.each([
    "Stage-B-head:",
    "Stage-B-owner-quote:",
    "Stage-B-source:",
    "Stage-B-recorded-at:",
    "Stage-B-live-url:",
  ])("rejects missing %s", (field) =>
    expect(
      validateStageB(
        [
          {
            body: base
              .split("\n")
              .filter((l) => !l.startsWith(field))
              .join("\n"),
          },
        ],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false),
  );
  it("rejects stale heads, contradictory GO text and placeholder provenance", () => {
    for (const body of [
      base.replace(sha, "b".repeat(40)),
      base.replace("Stage-B: GO", "Stage-B: GO pending"),
      base.replace("Approved this live room", "TBD"),
    ])
      expect(validateStageB([{ body }], sha, [], {}).ok).toBe(false);
  });
  it("later refusal invalidates the earlier GO even when the refusal has no affirmative metadata", () =>
    expect(
      validateStageB(
        [
          { body: base },
          { body: "Stage-B: HOLD", createdAt: "2026-09-06T01:00:00Z" },
        ],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false));
  it("a refusal in the same body and an undated contradictory comment fail closed", () => {
    expect(
      validateStageB([{ body: base + "\nStage-B: NO" }], sha, [], {}).ok,
    ).toBe(false);
    expect(
      validateStageB(
        [{ body: base }, { body: "Stage-B: REVOKED" }],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false);
  });
  it("rejects a bare batched or lead-certified marker", () => {
    for (const marker of [
      "batched at #700",
      "N/A (no visual surface) - lead-certified",
    ])
      expect(
        validateStageB(
          [{ body: base.replace("Stage-B: GO", `Stage-B: ${marker}`) }],
          sha,
          ["apps/admin/app/page.tsx"],
          {},
        ).ok,
      ).toBe(false);
  });
});
describe("#2373: Stage-B head carry-over across a patch-id-identical head", () => {
  const recorded = "b".repeat(40);
  const carried = base.replace(sha, recorded);
  it("accepts a record whose head is patch-id-identical to the current head, with an audit line", () => {
    const calls: string[][] = [];
    const verdict = validateStageB([{ body: carried }], sha, [], {}, (r, h) => {
      calls.push([r, h]);
      return { accepted: true, reason: "pure rebase", equal: 2, total: 2 };
    });
    expect(calls).toEqual([[recorded, sha]]);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("carried");
    expect(verdict.reason).toContain(recorded.slice(0, 12));
    expect(verdict.reason).toContain(sha.slice(0, 12));
    expect(verdict.reason).toContain("2/2");
  });
  it("a rework push (range-diff not all `=`) keeps the stale refusal and names why", () => {
    const verdict = validateStageB([{ body: carried }], sha, [], {}, () => ({
      accepted: false,
      reason: "git range-diff shows 1/2 commit(s) differing",
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("stale");
    expect(verdict.reason).toContain("1/2 commit(s) differing");
  });
  it("without an equivalence probe a different head stays stale", () =>
    expect(validateStageB([{ body: carried }], sha, [], {}).ok).toBe(false));
  it("a missing or malformed recorded head is never probed", () => {
    let probed = false;
    const probe = () => {
      probed = true;
      return { accepted: true, reason: "pure rebase" };
    };
    for (const body of [
      base.replace(`Stage-B-head: ${sha}\n`, ""),
      base.replace(sha, "not-a-sha"),
    ])
      expect(validateStageB([{ body }], sha, [], {}, probe).ok).toBe(false);
    expect(probed).toBe(false);
  });
  it("a slot-report lead certification never carries over (its report pins the tested head)", () => {
    const lead = carried.replace(
      "Stage-B: GO",
      "Stage-B: N/A (no visual surface) - lead-certified; run UTC: 2026-09-06T00:00:00Z; harness: x; report: https://example.test/r",
    );
    expect(
      validateStageB([{ body: lead }], sha, [], {}, () => ({
        accepted: true,
        reason: "pure rebase",
      })).ok,
    ).toBe(false);
  });
});
describe("#2581: copy-only GO on the owner's chat wording decision", () => {
  const noUrl = base.replace(/\nStage-B-live-url:[^\n]*/, "");
  it("accepts a GO without a live URL only when the caller certifies copy-only", () => {
    expect(
      validateStageB([{ body: noUrl }], sha, [], {}, undefined, true).ok,
    ).toBe(true);
    expect(validateStageB([{ body: noUrl }], sha, [], {}).ok).toBe(false);
  });
  it("keeps head, owner quote and source mandatory on the copy-only route", () => {
    for (const body of [
      noUrl.replace(sha, "b".repeat(40)),
      noUrl.replace("Approved this live room", "TBD"),
      noUrl.replace(/\nStage-B-source:[^\n]*/, ""),
    ])
      expect(validateStageB([{ body }], sha, [], {}, undefined, true).ok).toBe(
        false,
      );
  });
});

describe("#2584: Change-tier aware Stage-B GO", () => {
  const noUrl = base
    .split("\n")
    .filter((l) => !l.startsWith("Stage-B-live-url:"))
    .join("\n");
  const shipBody = noUrl;
  const evidence =
    "Stage-B-evidence: https://github.com/o/r/blob/abc1234/.github/ui-evidence/card.png";

  it("ship: GO with quote + source + recorded-at + current head, no live URL", () => {
    expect(
      validateStageB(
        [{ body: shipBody }],
        sha,
        [],
        {},
        undefined,
        false,
        "ship",
      ).ok,
    ).toBe(true);
  });

  it("ship: the GO stays head-pinned — a missing or stale head fails, a pure rebase carries it", () => {
    const moved = "b".repeat(40);
    const headless = shipBody
      .split("\n")
      .filter((l) => !l.startsWith("Stage-B-head:"))
      .join("\n");
    expect(
      validateStageB(
        [{ body: headless }],
        sha,
        [],
        {},
        undefined,
        false,
        "ship",
      ).ok,
    ).toBe(false);
    expect(
      validateStageB(
        [{ body: shipBody }],
        moved,
        [],
        {},
        undefined,
        false,
        "ship",
      ).ok,
    ).toBe(false);
    expect(
      validateStageB(
        [{ body: shipBody }],
        moved,
        [],
        {},
        () => ({ accepted: true, reason: "pure rebase" }),
        false,
        "ship",
      ).ok,
    ).toBe(true);
    expect(
      validateStageB(
        [{ body: shipBody }],
        moved,
        [],
        {},
        () => ({ accepted: false, reason: "rework" }),
        false,
        "ship",
      ).ok,
    ).toBe(false);
  });

  it("ship: owner quote, source and recorded-at stay mandatory", () => {
    for (const field of [
      "Stage-B-owner-quote:",
      "Stage-B-source:",
      "Stage-B-recorded-at:",
    ]) {
      const body = shipBody
        .split("\n")
        .filter((l) => !l.startsWith(field))
        .join("\n");
      expect(
        validateStageB([{ body }], sha, [], {}, undefined, false, "ship").ok,
      ).toBe(false);
    }
  });

  it("show: a PR evidence capture replaces the live URL; head pin still required", () => {
    const body = `${noUrl}\n${evidence}`;
    expect(
      validateStageB([{ body }], sha, [], {}, undefined, false, "show").ok,
    ).toBe(true);
    expect(
      validateStageB([{ body: noUrl }], sha, [], {}, undefined, false, "show")
        .ok,
    ).toBe(false);
    expect(
      validateStageB(
        [{ body: body.replace(sha, "b".repeat(40)) }],
        sha,
        [],
        {},
        undefined,
        false,
        "show",
      ).ok,
    ).toBe(false);
  });

  it("ask (the default): unchanged — the evidence capture and a missing head both still fail", () => {
    expect(
      validateStageB([{ body: `${noUrl}\n${evidence}` }], sha, [], {}).ok,
    ).toBe(false);
    expect(validateStageB([{ body: shipBody }], sha, [], {}).ok).toBe(false);
    expect(
      validateStageB([{ body: base }], sha, [], {}, undefined, false, "ask").ok,
    ).toBe(true);
  });
});
describe("#2699: GO carry-over over a non-runtime delta", () => {
  const recorded = "b".repeat(40);
  const carried = base.replace(sha, recorded);
  const rework = () => ({
    accepted: false,
    reason: "git range-diff shows 1/2 commit(s) differing",
  });
  it("carries a GO when every file changed since the recorded head (net of main) is non-runtime, and names them", () => {
    const delta = [
      "apps/portal/src/app/room/header.test.tsx",
      ".changeset/room-header.md",
      ".github/ui-evidence/2699/after.png",
      "apps/docs/content/specs/features/001-x/001-design.md",
      "apps/docs/content/specs/features/001-x/room.feature",
    ];
    const calls: string[][] = [];
    const verdict = validateStageB(
      [{ body: carried }],
      sha,
      [],
      {},
      rework,
      false,
      "ask",
      {
        headDelta: (r, h) => {
          calls.push([r, h]);
          return { ok: true, files: delta };
        },
      },
    );
    expect(calls).toEqual([[recorded, sha]]);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("carried");
    for (const file of delta) expect(verdict.reason).toContain(file);
  });
  it("a runtime file in the delta still requires a fresh verdict and names the file", () => {
    const verdict = validateStageB(
      [{ body: carried }],
      sha,
      [],
      {},
      rework,
      false,
      "ask",
      {
        headDelta: () => ({
          ok: true,
          files: [".changeset/x.md", "apps/portal/src/app/room/header.tsx"],
        }),
      },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("stale");
    expect(verdict.reason).toContain("apps/portal/src/app/room/header.tsx");
  });
  it("an unreadable delta keeps the stale refusal", () => {
    const verdict = validateStageB(
      [{ body: carried }],
      sha,
      [],
      {},
      rework,
      false,
      "ask",
      { headDelta: () => ({ ok: false, reason: "commit not present" }) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("commit not present");
  });
});
describe("#2699: slot-free lead-certified N/A for a non-environment-sensitive PR", () => {
  const leadBase = [
    "Stage-B: N/A (no visual surface) — lead-certified",
    `Stage-B-head: ${sha}`,
    "Stage-B-recorded-at: 2026-09-06T00:00:00Z",
    "Stage-B-owner-quote: Merge invisible refactors yourself once CI proves them",
    "Stage-B-source: owner-relay:session-123#message-4",
    "Stage-B-authorization: autonomous-merge",
    "Stage-B-visual-change: none",
    "Stage-B-evidence: https://github.com/acme/repo/pull/1#issuecomment-9",
  ].join("\n");
  const run = (
    body: string,
    slotFree: {
      environmentSensitive: string[];
      ciE2e: { ok: boolean; detail: string };
    },
  ) =>
    validateStageB(
      [{ body }],
      sha,
      ["apps/portal/src/app/room/header.tsx"],
      {},
      undefined,
      false,
      "ask",
      {
        slotFree,
      },
    );
  const green = { ok: true, detail: "playwright-axe-portal success" };
  it("passes with green CI e2e on the head + before/after captures and no slot report", () => {
    const verdict = run(leadBase, { environmentSensitive: [], ciE2e: green });
    expect(verdict.ok).toBe(true);
  });
  it("refuses without the captures or without green CI e2e on the head", () => {
    expect(
      run(leadBase.replace(/\nStage-B-evidence:[^\n]*/, ""), {
        environmentSensitive: [],
        ciE2e: green,
      }).ok,
    ).toBe(false);
    const red = run(leadBase, {
      environmentSensitive: [],
      ciE2e: { ok: false, detail: "playwright-axe-portal failure" },
    });
    expect(red.ok).toBe(false);
    expect(red.ok === false && red.reason).toContain(
      "playwright-axe-portal failure",
    );
  });
  it("an environment-sensitive PR still needs the live slot report", () => {
    const verdict = run(leadBase, {
      environmentSensitive: ["apps/api/src/mailer/notice-emails.ts"],
      ciE2e: green,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain(
      "apps/api/src/mailer/notice-emails.ts",
    );
    const withReport =
      leadBase.replace(
        "lead-certified",
        "lead-certified; harness: x; run UTC: 2026-09-06T00:00:00Z; report: https://example.test/r",
      ) +
      `\nStage-B-live-verified: yes\nStage-B-report-sha: ${sha}\nStage-B-report-stdout: PASS`;
    expect(
      run(withReport, {
        environmentSensitive: ["apps/api/src/mailer/notice-emails.ts"],
        ciE2e: green,
      }).ok,
    ).toBe(true);
  });
  it("without a slot-free context the slot report stays required (today's behaviour)", () =>
    expect(validateStageB([{ body: leadBase }], sha, [], {}).ok).toBe(false));
});
describe("#2699: an owner quote copied from an instruction file is refused", () => {
  const docs = {
    "AGENTS.md":
      "- Finish the PR tail — required review → green CI → canonical merge (§4) → Issue/board Done → re-sweep — then any remaining authorized work.\n- Never say Го.",
  };
  it("names the instruction file a verbatim quote comes from", () => {
    expect(
      instructionQuoteSource(
        "Finish the PR tail — required review → green CI → canonical merge (§4)",
        docs,
      ),
    ).toBe("AGENTS.md");
    expect(
      instructionQuoteSource(
        "  Finish the PR tail —   required review → green CI  ",
        docs,
      ),
    ).toBe("AGENTS.md");
  });
  it("a genuine owner quote, or a short one that merely occurs in a file, is not refused", () => {
    expect(instructionQuoteSource("Окей, реализуй", docs)).toBeNull();
    expect(instructionQuoteSource("Го", docs)).toBeNull();
    expect(instructionQuoteSource("", docs)).toBeNull();
  });
});
