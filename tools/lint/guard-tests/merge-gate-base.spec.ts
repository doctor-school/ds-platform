import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { landPr } from "../../gh/pr-land.mjs";

const gatePath = fileURLToPath(
  new URL("../../gh/merge-gate.mjs", import.meta.url),
);

// Exercise the real entrypoint and native exit statuses. Only subprocess I/O is
// intercepted; the gate still owns polling, final validation and its exit.
function runGate(scenario: string) {
  const script = `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { tmpdir } from 'node:os';
    const head = 'a'.repeat(40), mergeBase = 'd'.repeat(40), oldBase = 'b'.repeat(40), newBase = 'c'.repeat(40);
    const scenario = ${JSON.stringify(scenario)};
    const calls = []; let polls = 0; let advanced = false; let headFetched = false;
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    cp.spawnSync = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'gh') {
        if (args[0] === 'pr') return ok(JSON.stringify({ headRefOid: head, headRefName: 'tooling/1920-test', state: 'OPEN' }));
        if (args[1].includes('/reviews')) return ok(JSON.stringify([[{ body: '## Mode (a) Review\\nVERDICT: APPROVE', commit_id: head, state: 'COMMENTED', submitted_at: '2026-09-06T00:00:00Z' }]]));
        if (args[1].includes('/check-runs')) {
          polls++; if (polls === 1) advanced = true;
          return ok(JSON.stringify([{ check_runs: [{ name: 'ci', status: polls === 1 ? 'in_progress' : 'completed', conclusion: polls === 1 ? null : 'success' }] }]));
        }
        if (args[1].includes('/git/ref/heads/main')) {
          if (scenario === 'api-error') return { status: 1, stderr: 'offline' };
          if (scenario === 'api-missing') return ok('{}');
          if (scenario === 'api-malformed') return ok('not JSON');
          return ok(JSON.stringify({ object: { sha: advanced ? newBase : oldBase } }));
        }
      }
      if (command === 'git') {
        if (args[0] === 'worktree') return ok();
        if (args[0] === 'fetch') {
          if (args.includes(head)) headFetched = true;
          if (scenario === 'fetch-error') return { status: 128, stderr: 'fetch denied' };
          if (scenario === 'fetch-signal') return { status: null, signal: 'SIGTERM' };
          if (scenario === 'fetch-spawn-error') return { status: 0, error: new Error('spawn failed') };
          return ok();
        }
        if (args[0] === 'cat-file') {
          const missingHead = args.includes(head + '^{commit}') && (scenario === 'missing-head' || (scenario === 'recover-head' && !headFetched));
          return scenario === 'missing-object' || missingHead ? { status: 128, stderr: 'missing object' } : ok();
        }
        if (args[0] === 'merge-base' && !args.includes('--is-ancestor')) {
          if (scenario === 'advanced-base-error') return { status: 128, stderr: 'no merge base' };
          if (scenario === 'advanced-base-garbage') return ok('not-a-sha\\n');
          return ok(mergeBase + '\\n');
        }
        if (args[0] === 'diff') {
          const target = args[args.length - 1];
          if (scenario === 'advanced-diff-error') return { status: 128, stderr: 'bad revision' };
          if (scenario === 'advanced-disjoint') return ok(target === newBase ? 'apps/promo/app/page.tsx\\napps/promo/README.md\\n' : 'tools/lint/no-stub.ts\\n');
          if (scenario === 'advanced-overlap') return ok('apps/api/src/app.module.ts\\n');
          return ok(target === newBase ? 'pnpm-lock.yaml\\n' : 'tools/lint/no-stub.ts\\n');
        }
        if (args[0] === 'merge-base') {
          if (scenario === 'ancestry-error') return { status: 128, stderr: 'invalid object' };
          if (scenario === 'ancestry-signal') return { status: null, signal: 'SIGTERM' };
          return { status: scenario.startsWith('advanced') && args.includes(newBase) ? 1 : 0, stdout: '', stderr: '' };
        }
      }
      throw new Error('Unexpected call ' + JSON.stringify([command, args]));
    };
    syncBuiltinESMExports();
    process.cwd = () => tmpdir();
    process.argv = [process.execPath, ${JSON.stringify(gatePath)}, '1923', '--interval', '0.001'];
    process.on('exit', () => process.stdout.write('\\nTRACE ' + JSON.stringify({ calls, polls, advanced }) + '\\n'));
    await import(pathToFileURL(process.argv[1]).href);
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  const trace = JSON.parse(result.stdout.match(/TRACE (.+)/)?.[1] ?? "{}");
  return { ...result, trace };
}

describe("EARS-1920: final live base ancestry", () => {
  it("refuses main advancing during CI polling and the lander never attempts merge", () => {
    const result = runGate("advanced");
    expect(result.trace.polls).toBe(2);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/rebase/i);
    let attempted = false;
    expect(() =>
      landPr(1923, [], {
        resolveContext: () => ({
          ok: true,
          issues: [1920],
          branch: "tooling/1920-test",
        }),
        gate: () => ({ status: result.status }),
        merge: () => {
          attempted = true;
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`exit:${code}`);
        },
        log: () => {},
        err: () => {},
      }),
    ).toThrow("exit:1");
    expect(attempted).toBe(false);
  });

  it("accepts an up-to-date head using the live SHA without moving local refs", () => {
    const result = runGate("current");
    expect(result.status).toBe(0);
    expect(result.trace.calls).toContainEqual([
      "git",
      "merge-base",
      "--is-ancestor",
      "c".repeat(40),
      "a".repeat(40),
    ]);
    expect(result.trace.calls).toContainEqual([
      "git",
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "origin",
      "c".repeat(40),
    ]);
    expect(
      result.trace.calls.some((call: string[]) =>
        /checkout|reset|update-ref|pull/.test(call[1]),
      ),
    ).toBe(false);
  });

  it.each([
    "api-error",
    "api-missing",
    "api-malformed",
    "fetch-error",
    "fetch-signal",
    "fetch-spawn-error",
    "missing-object",
    "missing-head",
    "ancestry-error",
    "ancestry-signal",
  ])("fails closed on %s", (scenario) => {
    const result = runGate(scenario);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("GREEN");
  });

  it("fetches a remotely pushed head absent from the main clone before checking ancestry", () => {
    const result = runGate("recover-head");
    expect(result.status).toBe(0);
    expect(result.trace.calls).toContainEqual([
      "git",
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "origin",
      "a".repeat(40),
    ]);
  });

  // #2124 — an advanced main is no longer an unconditional RED: a main-side
  // delta disjoint from the PR files and outside ALWAYS_OVERLAPPING_PATHS is
  // accepted with a printed evidence block; anything else keeps today's refusal.
  it("EARS-2124.7: accepts an advanced main whose files are disjoint from the PR files", () => {
    const result = runGate("advanced-disjoint");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#2124 disjoint-changes rule");
    expect(result.stdout).toContain("tested base " + "d".repeat(12));
    expect(result.stdout).toContain("main advanced to " + "c".repeat(12));
    expect(result.stdout).toContain("apps/promo/app/page.tsx");
    expect(result.stdout).toContain("tools/lint/no-stub.ts");
    expect(result.stdout).toContain("Safety net: ci.yml runs on push to main");
    expect(result.stdout).toContain("GREEN");
    expect(result.trace.calls).toContainEqual([
      "git",
      "diff",
      "--name-only",
      "d".repeat(40),
      "c".repeat(40),
    ]);
  });

  it("EARS-2124.8: refuses an advanced main sharing a file with the PR and names the path", () => {
    const result = runGate("advanced-overlap");
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("GREEN");
    expect(result.stderr).toContain("apps/api/src/app.module.ts");
    expect(result.stderr).toMatch(/outside the PR ancestry/);
    expect(result.stderr).toMatch(/rebase/i);
  });

  it("EARS-2124.9: an unadvanced main never resolves a tested base or file lists", () => {
    const result = runGate("current");
    expect(result.status).toBe(0);
    expect(
      result.trace.calls.some(
        (call: string[]) =>
          call[1] === "diff" ||
          (call[1] === "merge-base" && !call.includes("--is-ancestor")),
      ),
    ).toBe(false);
  });

  it.each([
    "advanced-base-error",
    "advanced-base-garbage",
    "advanced-diff-error",
  ])("EARS-2124.10: fails closed on %s", (scenario) => {
    const result = runGate(scenario);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("GREEN");
  });
});
