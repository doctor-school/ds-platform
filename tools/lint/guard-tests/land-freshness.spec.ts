import { describe, expect, it } from "vitest";

import {
  EXIT,
  classifyStale,
  landFreshness,
  parseNameList,
} from "../../gh/land-freshness.mjs";

/**
 * land-freshness — unit cover for `tools/gh/land-freshness.mjs` (#2593).
 *
 * The helper decides whether a stale PR head (origin/main moved past it) must be
 * rebased before `pr:land`, or can be squash-merged as-is. The git/gh runners
 * are injected, so no subprocess is spawned; each fixture answers by argv.
 */

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MB = "c".repeat(40);

type Run = { status: number | null; stdout?: string; stderr?: string };

function makeDeps(opts: {
  ancestor?: number;
  mergeable?: string[];
  mainFiles?: string[];
  prFiles?: string[];
  failOn?: string;
}) {
  const mergeable = [...(opts.mergeable ?? ["MERGEABLE"])];
  const calls = { mergeable: 0, sleeps: 0 };
  const ok = (stdout = ""): Run => ({ status: 0, stdout });
  const git = (args: string[]): Run => {
    const cmd = args.join(" ");
    if (opts.failOn && cmd.includes(opts.failOn))
      return { status: 128, stderr: "fatal: boom" };
    if (args[0] === "fetch") return ok();
    if (args[0] === "rev-parse") return ok(BASE + "\n");
    if (args[0] === "merge-base" && args[1] === "--is-ancestor")
      return { status: opts.ancestor ?? 0 };
    if (args[0] === "merge-base") return ok(MB);
    if (args[0] === "diff" && args.at(-1) === BASE)
      return ok((opts.mainFiles ?? []).join("\n"));
    if (args[0] === "diff" && args.at(-1) === HEAD)
      return ok((opts.prFiles ?? []).join("\n"));
    throw new Error(`unexpected git ${cmd}`);
  };
  const gh = (args: string[]): Run => {
    const cmd = args.join(" ");
    if (opts.failOn && cmd.includes(opts.failOn))
      return { status: 1, stderr: "HTTP 502" };
    if (cmd.includes("headRefOid")) return ok(HEAD);
    if (cmd.includes("mergeable")) {
      calls.mergeable += 1;
      return ok(mergeable.length > 1 ? mergeable.shift() : mergeable[0]);
    }
    throw new Error(`unexpected gh ${cmd}`);
  };
  const sleep = () => {
    calls.sleeps += 1;
  };
  return { deps: { git, gh, sleep, retries: 3, delayMs: 0 }, calls };
}

describe("land-freshness verdicts (#2593)", () => {
  it("fresh: head contains origin/main → exit 0, mergeable never queried", () => {
    const { deps, calls } = makeDeps({ ancestor: 0 });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("fresh");
    expect(EXIT[res.verdict]).toBe(0);
    expect(calls.mergeable).toBe(0);
  });

  it("merge-as-is: stale, MERGEABLE, disjoint files → exit 1", () => {
    const { deps } = makeDeps({
      ancestor: 1,
      mainFiles: ["apps/portal/a.ts", "pnpm-lock.yaml"],
      prFiles: ["tools/gh/x.mjs"],
    });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("merge-as-is");
    expect(EXIT[res.verdict]).toBe(1);
    expect(res.overlap).toEqual([]);
  });

  it("rebase on overlap: stale, MERGEABLE, main touched a PR file → exit 2, lists the files", () => {
    const { deps } = makeDeps({
      ancestor: 1,
      mainFiles: ["pnpm-lock.yaml", "apps/portal/a.ts", "README.md"],
      prFiles: ["pnpm-lock.yaml", "README.md", "tools/gh/x.mjs"],
    });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("rebase");
    expect(EXIT[res.verdict]).toBe(2);
    expect(res.overlap).toEqual(["README.md", "pnpm-lock.yaml"]);
    expect(res.reason).toContain("pnpm-lock.yaml");
  });

  it("rebase on conflict: stale and CONFLICTING → exit 2 even with disjoint files", () => {
    const { deps } = makeDeps({
      ancestor: 1,
      mergeable: ["CONFLICTING"],
      mainFiles: ["a"],
      prFiles: ["b"],
    });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("rebase");
    expect(res.reason).toContain("CONFLICTING");
  });

  it("error on UNKNOWN: mergeable stays UNKNOWN through the bounded retry → exit 3", () => {
    const { deps, calls } = makeDeps({
      ancestor: 1,
      mergeable: ["UNKNOWN"],
      mainFiles: ["a"],
      prFiles: ["b"],
    });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("error");
    expect(EXIT[res.verdict]).toBe(3);
    expect(calls.mergeable).toBe(3);
    expect(calls.sleeps).toBe(2);
  });

  it("UNKNOWN that resolves within the retry is classified normally", () => {
    const { deps, calls } = makeDeps({
      ancestor: 1,
      mergeable: ["UNKNOWN", "MERGEABLE"],
      mainFiles: ["a"],
      prFiles: ["b"],
    });
    expect(landFreshness(2593, deps).verdict).toBe("merge-as-is");
    expect(calls.mergeable).toBe(2);
  });
});

describe("land-freshness errors are never reported as stale (#2593)", () => {
  it("a failed gh head lookup → error", () => {
    const { deps } = makeDeps({ failOn: "headRefOid" });
    const res = landFreshness(2593, deps);
    expect(res.verdict).toBe("error");
    expect(res.reason).toContain("HTTP 502");
  });

  it("an unknown object in the ancestry check (exit 128) → error, not rebase", () => {
    const { deps } = makeDeps({ ancestor: 128 });
    expect(landFreshness(2593, deps).verdict).toBe("error");
  });

  it("a failed git diff → error", () => {
    const { deps } = makeDeps({ ancestor: 1, failOn: "--name-only" });
    expect(landFreshness(2593, deps).verdict).toBe("error");
  });

  it("an invalid PR number → error without any call", () => {
    const { deps } = makeDeps({});
    expect(landFreshness(0, deps).verdict).toBe("error");
  });
});

describe("land-freshness pure seams (#2593)", () => {
  it("parseNameList drops blanks and CRLF", () => {
    expect(parseNameList("a\r\n\nb\n")).toEqual(["a", "b"]);
  });

  it("classifyStale treats an empty mergeable as error", () => {
    expect(
      classifyStale({ mergeable: "", mainFiles: [], prFiles: [] }).verdict,
    ).toBe("error");
  });
});
