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
    const head = 'a'.repeat(40), oldBase = 'b'.repeat(40), newBase = 'c'.repeat(40);
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
        if (args[0] === 'merge-base') {
          if (scenario === 'ancestry-error') return { status: 128, stderr: 'invalid object' };
          if (scenario === 'ancestry-signal') return { status: null, signal: 'SIGTERM' };
          return { status: scenario === 'advanced' && args.includes(newBase) ? 1 : 0, stdout: '', stderr: '' };
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
});
