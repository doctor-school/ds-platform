import { describe, expect, it } from "vitest";

// Pure helpers exported from the orchestration-metrics miner (#916). Importing
// them does NOT fire the script's `main()` — it is guarded behind an entry-point
// check, the same idiom as extract.mjs (#360).
import {
  classifyInlineEpisode,
  computeCorpusHealth,
  computeOverlaps,
  contextFromUsage,
  EPISODE_CLASSES,
  extractPrRefs,
  isCorruptLogContent,
  isDeliverableEditPath,
  sessionMetricsFromLines,
} from "../../retro/orchestration-mine.mjs";

// ── inline-episode classification (pure) ────────────────────────────────────
// The cause of choosing inline-over-dispatch buckets into EXACTLY 5 classes. The
// edited FILE PATH is the strongest signal — a scratch brief / memory / tmp
// target is definitionally a `sanctioned-carve-out` (not a dispatchable repo
// deliverable), which the #916 corpus showed is 79% of raw inline mutations.
describe("orchestration-mine — inline-episode classifier (pure)", () => {
  it("exposes exactly the 5 documented classes in precedence order", () => {
    expect(EPISODE_CLASSES).toEqual([
      "sanctioned-carve-out",
      "dispatch-abandoned",
      "brief-cost-aversion",
      "retrieved-but-rationalized",
      "rule-not-retrieved",
    ]);
  });

  it("file path wins: a scratch/memory/tmp edit is a sanctioned carve-out regardless of text", () => {
    // even reasoning text that would otherwise read as a violation is a carve-out
    // when the target is not a repo deliverable
    expect(
      classifyInlineEpisode(
        "faster to just edit inline",
        "C:/Users/x/AppData/Local/Temp/claude/scratchpad/brief.md",
      ),
    ).toBe("sanctioned-carve-out");
    expect(
      classifyInlineEpisode(
        "no rule text here",
        "/home/x/.claude/projects/slug/memory/topic.md",
      ),
    ).toBe("sanctioned-carve-out");
    expect(classifyInlineEpisode("", "/tmp/plan.txt")).toBe(
      "sanctioned-carve-out",
    );
  });

  it("a repo-source edit (incl. inside a worktree) is NOT auto-carve-out — text decides", () => {
    // a worktree source file is a real deliverable → falls through to text lexicon
    const wt =
      "C:/repo/.claude/worktrees/916/tools/retro/orchestration-mine.mjs";
    expect(classifyInlineEpisode("just applying the fix", wt)).toBe(
      "rule-not-retrieved",
    );
    // a text carve-out citation still classifies a deliverable edit as carve-out
    expect(
      classifyInlineEpisode("memory-файлы сам, они вне репо, PR не нужен", wt),
    ).toBe("sanctioned-carve-out");
    expect(
      classifyInlineEpisode("docs-only tweak, the rule permits inline", wt),
    ).toBe("sanctioned-carve-out");
  });

  it("classifies dispatch-abandoned (attempted then failed) — RU + EN", () => {
    const wt = "/repo/src/a.ts";
    expect(
      classifyInlineEpisode(
        "the dispatch failed with a 529 overload, doing it here",
        wt,
      ),
    ).toBe("dispatch-abandoned");
    expect(
      classifyInlineEpisode(
        "субагент не вернул результат, откатился к инлайн",
        wt,
      ),
    ).toBe("dispatch-abandoned");
    expect(
      classifyInlineEpisode("dispatch timed out, falling back to inline", wt),
    ).toBe("dispatch-abandoned");
  });

  it("classifies brief-cost-aversion — RU + EN", () => {
    const wt = "/repo/src/a.ts";
    expect(
      classifyInlineEpisode("not worth a brief for a one-char change", wt),
    ).toBe("brief-cost-aversion");
    expect(
      classifyInlineEpisode("не стоит диспатчить ради пары строк", wt),
    ).toBe("brief-cost-aversion");
  });

  it("classifies retrieved-but-rationalized (rule named, argued away) — RU + EN", () => {
    const wt = "/repo/src/a.ts";
    expect(
      classifyInlineEpisode(
        "I'll just edit it inline, quicker inline anyway",
        wt,
      ),
    ).toBe("retrieved-but-rationalized");
    expect(
      classifyInlineEpisode("проще самому поправлю, без диспатча быстрее", wt),
    ).toBe("retrieved-but-rationalized");
  });

  it("defaults a deliverable inline edit with no signal to rule-not-retrieved", () => {
    expect(
      classifyInlineEpisode(
        "Now patching the resolver.",
        "/repo/src/resolver.ts",
      ),
    ).toBe("rule-not-retrieved");
    expect(classifyInlineEpisode("", "/repo/src/resolver.ts")).toBe(
      "rule-not-retrieved",
    );
    // an unknown (null) path is not a deliverable, but also not a scratch path —
    // it falls through to the text lexicon / default
    expect(classifyInlineEpisode("Now patching.", null)).toBe(
      "rule-not-retrieved",
    );
  });

  it("precedence: a genuine carve-out citation is not mis-bucketed as a rationalization", () => {
    // both a carve-out phrase AND a rationalization phrase present → carve-out wins
    expect(
      classifyInlineEpisode(
        "docs-only, and honestly faster to just edit inline",
        "/repo/a.md",
      ),
    ).toBe("sanctioned-carve-out");
  });
});

// ── deliverable-path detection (pure) ───────────────────────────────────────
describe("orchestration-mine — isDeliverableEditPath (pure)", () => {
  it("repo source (incl. worktree source) is a deliverable", () => {
    expect(isDeliverableEditPath("/repo/packages/db/schema/x.ts")).toBe(true);
    expect(
      isDeliverableEditPath("C:/repo/.claude/worktrees/916/apps/api/src/x.ts"),
    ).toBe(true);
  });

  it("scratch / memory / tmp targets are NOT deliverables", () => {
    expect(
      isDeliverableEditPath("C:/x/AppData/Local/Temp/claude/scratchpad/b.md"),
    ).toBe(false);
    expect(
      isDeliverableEditPath("/home/x/.claude/projects/slug/memory/t.md"),
    ).toBe(false);
    expect(isDeliverableEditPath("/tmp/plan.txt")).toBe(false);
  });

  it("an unknown/absent path is not counted as a deliverable", () => {
    expect(isDeliverableEditPath(null)).toBe(false);
    expect(isDeliverableEditPath("")).toBe(false);
  });
});

// ── context-at-wrap (pure) ──────────────────────────────────────────────────
describe("orchestration-mine — contextFromUsage (pure)", () => {
  it("sums input + cache-read + cache-creation tokens", () => {
    expect(
      contextFromUsage({
        input_tokens: 131,
        cache_read_input_tokens: 69011,
        cache_creation_input_tokens: 498,
      }),
    ).toBe(69640);
  });

  it("returns null for absent/empty usage", () => {
    expect(contextFromUsage(null)).toBeNull();
    expect(contextFromUsage({})).toBeNull();
    expect(contextFromUsage({ output_tokens: 5 })).toBeNull();
  });
});

// ── PR-reference extraction (pure) ──────────────────────────────────────────
// A documented heuristic: a `gh pr <verb> <N>` call whose verb takes a PR NUMBER
// adjacent, plus a `/pull/<N>` URL. Bare `#N` is NOT scanned (Issue/PR number
// collision), and create/list emit no number.
describe("orchestration-mine — extractPrRefs (pure)", () => {
  it("extracts adjacent PR numbers from gh pr verb calls + pull URLs, de-duped + sorted", () => {
    expect(
      extractPrRefs(
        "gh pr merge 762 --squash && gh pr view 760; see /pull/761",
      ),
    ).toEqual([760, 761, 762]);
    expect(extractPrRefs("gh pr checks #900 --json state")).toEqual([900]);
  });

  it("does NOT scan bare #N (Issue/PR collision) or gh pr create/list", () => {
    expect(extractPrRefs("closes #729 and #834")).toEqual([]);
    expect(
      extractPrRefs("gh pr create --title x; gh pr list --limit 20"),
    ).toEqual([]);
  });

  it("does not grab a stray count/flag value deeper in the command", () => {
    // the number must be adjacent to the verb — a trailing --limit 50 is not a PR
    expect(extractPrRefs("gh pr view 812 --comments | head -50")).toEqual([
      812,
    ]);
  });

  it("returns [] for non-string / empty input", () => {
    expect(extractPrRefs(null as unknown as string)).toEqual([]);
    expect(extractPrRefs("")).toEqual([]);
  });
});

// ── timestamp-based parallel overlap (pure) ─────────────────────────────────
// Replaces the #700 same-message heuristic (verified overlap for only 4
// sessions). Two sessions overlap when their [firstTs,lastTs] intervals
// intersect: aStart < bEnd && bStart < aEnd.
describe("orchestration-mine — computeOverlaps (pure)", () => {
  it("detects temporally overlapping sessions symmetrically", () => {
    const o = computeOverlaps([
      {
        id: "a",
        firstTs: "2026-01-01T00:00:00Z",
        lastTs: "2026-01-01T02:00:00Z",
      },
      {
        id: "b",
        firstTs: "2026-01-01T01:00:00Z",
        lastTs: "2026-01-01T03:00:00Z",
      },
      {
        id: "c",
        firstTs: "2026-01-01T05:00:00Z",
        lastTs: "2026-01-01T06:00:00Z",
      },
    ]);
    expect(o.get("a")).toEqual(["b"]);
    expect(o.get("b")).toEqual(["a"]);
    expect(o.get("c")).toEqual([]);
  });

  it("touching-but-not-overlapping intervals do not count (strict intersection)", () => {
    const o = computeOverlaps([
      {
        id: "a",
        firstTs: "2026-01-01T00:00:00Z",
        lastTs: "2026-01-01T01:00:00Z",
      },
      {
        id: "b",
        firstTs: "2026-01-01T01:00:00Z",
        lastTs: "2026-01-01T02:00:00Z",
      },
    ]);
    expect(o.get("a")).toEqual([]);
    expect(o.get("b")).toEqual([]);
  });

  it("skips sessions with an unparseable/absent range (never spuriously overlaps)", () => {
    const o = computeOverlaps([
      {
        id: "a",
        firstTs: "2026-01-01T00:00:00Z",
        lastTs: "2026-01-01T02:00:00Z",
      },
      { id: "b", firstTs: null, lastTs: null },
    ]);
    expect(o.has("b")).toBe(false);
    expect(o.get("a")).toEqual([]);
  });

  it("detects a 3-way concurrent wave", () => {
    const o = computeOverlaps([
      {
        id: "a",
        firstTs: "2026-01-01T00:00:00Z",
        lastTs: "2026-01-01T03:00:00Z",
      },
      {
        id: "b",
        firstTs: "2026-01-01T00:30:00Z",
        lastTs: "2026-01-01T01:30:00Z",
      },
      {
        id: "c",
        firstTs: "2026-01-01T01:00:00Z",
        lastTs: "2026-01-01T02:00:00Z",
      },
    ]);
    expect(o.get("a")).toEqual(["b", "c"]);
    expect(o.get("b")).toEqual(["a", "c"]);
    expect(o.get("c")).toEqual(["a", "b"]);
  });
});

// ── corpus health: NUL-corrupt / unparseable log detection (pure) ───────────
// A NUL-corrupted / unparseable log file (an FS-corruption incident, memory
// reference_nul_corruption_incident_20260711) is non-empty on disk yet yields
// zero parseable JSONL records — the miner would drop it silently, making the
// mined N read as "of a healthy corpus". These must be COUNTED, not hidden, and
// distinguished from a legitimately empty / short session (#916 follow-up).
describe("orchestration-mine — isCorruptLogContent (pure)", () => {
  const valid = JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
  });

  it("flags a NUL-byte file (non-empty, zero parseable records) as corrupt", () => {
    expect(isCorruptLogContent("\u0000\u0000\u0000\u0000")).toBe(true);
  });

  it("flags an all-garbage (non-JSON) file as corrupt", () => {
    expect(isCorruptLogContent("not json at all\nstill not json")).toBe(true);
  });

  it("does NOT flag a legitimately empty / whitespace-only log", () => {
    expect(isCorruptLogContent("")).toBe(false);
    expect(isCorruptLogContent("   \n  \n")).toBe(false);
  });

  it("does NOT flag a valid session, even a short one with a single record", () => {
    expect(isCorruptLogContent(valid)).toBe(false);
    // a partially-corrupt file with at least one parseable record is still mined
    expect(isCorruptLogContent(`${valid}\n\u0000\u0000`)).toBe(false);
  });

  it("returns false for a non-string input", () => {
    expect(isCorruptLogContent(null as unknown as string)).toBe(false);
  });
});

// ── corpus-health rollup (pure) ─────────────────────────────────────────────
describe("orchestration-mine — computeCorpusHealth (pure)", () => {
  const valid = JSON.stringify({ type: "assistant" });

  it("counts corrupt logs and populates the corpusHealth summary field", () => {
    const health = computeCorpusHealth(
      [
        { content: valid }, // mined
        { content: "\u0000\u0000\u0000" }, // NUL-corrupt
        { content: "garbage\nlines" }, // unparseable
        { content: "   \n" }, // legitimately empty — NOT corrupt
      ],
      1,
    );
    expect(health.totalLogFiles).toBe(4);
    expect(health.mined).toBe(1);
    expect(health.skippedCorrupt).toBe(2); // the two garbage files only
  });

  it("reports zero skipped on a healthy corpus", () => {
    const health = computeCorpusHealth(
      [{ content: valid }, { content: valid }],
      2,
    );
    expect(health).toEqual({ totalLogFiles: 2, mined: 2, skippedCorrupt: 0 });
  });
});

// ── per-session metrics over synthetic lines (pure) ─────────────────────────
// The heart of the miner: a dispatch (Agent), a deliverable inline edit, a
// scratch brief-write (carve-out, non-deliverable), and a RUN of two consecutive
// deliverable edits separated ONLY by tool_result turns (must collapse to ONE
// episode — a tool_result must not reset the pending rationale nor break the run).
describe("orchestration-mine — sessionMetricsFromLines (pure)", () => {
  function asstText(text: string, ts = "2026-01-01T00:00:00Z") {
    return JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
  }
  function asstTool(
    name: string,
    input: Record<string, unknown>,
    ts = "2026-01-01T00:00:00Z",
  ) {
    return JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name, input }],
      },
    });
  }
  function toolResult() {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "ok" }],
      },
    });
  }
  function asstUsage(usage: Record<string, unknown>) {
    return JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T09:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage,
      },
    });
  }

  it("counts dispatches, deliverable vs scratch inline, PRs, and context-at-wrap", () => {
    const lines = [
      asstText("Dispatching the impl."),
      asstTool("Agent", { subagent_type: "ds-explorer", prompt: "go" }),
      asstText("Writing the brief to scratch first."),
      asstTool("Write", {
        file_path: "/x/AppData/Local/Temp/claude/scratchpad/brief.md",
      }),
      asstText("Now the hotfix, just patching it here."),
      asstTool("Edit", { file_path: "/repo/src/a.ts" }),
      asstTool("Bash", { command: "gh pr merge 812 --squash" }),
      asstUsage({
        input_tokens: 100,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 0,
      }),
    ];
    const m = sessionMetricsFromLines(lines);
    expect(m.dispatches).toBe(1);
    expect(m.inline).toBe(2); // scratch brief + repo edit
    expect(m.deliverableInline).toBe(1); // only the repo edit
    expect(m.ratio).toBe(1); // deliverableInline / dispatches = 1/1
    expect(m.prs).toEqual([812]);
    expect(m.contextAtWrap).toBe(5100);
    expect(m.episodes).toHaveLength(2);
    const classes = m.episodes.map((e) => e.cls).sort();
    expect(classes).toEqual(["rule-not-retrieved", "sanctioned-carve-out"]);
  });

  it("collapses a run of consecutive deliverable edits (tool_result between) into ONE episode", () => {
    const lines = [
      asstText("Applying the multi-file refactor."),
      asstTool("Edit", { file_path: "/repo/src/a.ts" }),
      toolResult(), // must NOT reset the rationale or break the run
      asstTool("Edit", { file_path: "/repo/src/b.ts" }),
      toolResult(),
      asstTool("Write", { file_path: "/repo/src/c.ts" }),
    ];
    const m = sessionMetricsFromLines(lines);
    expect(m.inline).toBe(3);
    expect(m.deliverableInline).toBe(3);
    expect(m.episodes).toHaveLength(1); // one decision, one episode
    expect(m.episodes[0].cls).toBe("rule-not-retrieved");
  });

  it("a real typed user turn breaks the run (a new instruction = a new episode)", () => {
    const lines = [
      asstText("First edit."),
      asstTool("Edit", { file_path: "/repo/src/a.ts" }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "now do the other file" },
      }),
      asstText("Second edit."),
      asstTool("Edit", { file_path: "/repo/src/b.ts" }),
    ];
    const m = sessionMetricsFromLines(lines);
    expect(m.episodes).toHaveLength(2);
  });

  it("ignores subagent (isSidechain) tool calls — only lead mutations count", () => {
    const side = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      isSidechain: true,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/repo/src/a.ts" },
          },
        ],
      },
    });
    const m = sessionMetricsFromLines([side]);
    expect(m.inline).toBe(0);
    expect(m.deliverableInline).toBe(0);
    expect(m.episodes).toHaveLength(0);
  });

  it("ratio is null when there are no dispatches", () => {
    const m = sessionMetricsFromLines([
      asstText("patch"),
      asstTool("Edit", { file_path: "/repo/src/a.ts" }),
    ]);
    expect(m.dispatches).toBe(0);
    expect(m.ratio).toBeNull();
  });
});
