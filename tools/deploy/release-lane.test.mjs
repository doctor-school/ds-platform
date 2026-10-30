import assert from "node:assert/strict";
import { test } from "node:test";

import { ghVia, mainHistoryFromApi } from "./lib/github-release-facts.mjs";
import { readLane } from "./release-lane.mjs";

const REPO = "o/r";
const sha = (n) => String(n).padStart(40, "0");

/** A linear main of `length` commits: sha(length) is head, sha(1) the root. */
function fakeGitHub({ length, production, green }) {
  const calls = [];
  const spawn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
    const path = args[1];
    if (path.includes("/deployments?"))
      return JSON.stringify({ id: 1, sha: sha(production) }) + "\n";
    if (path.includes("/deployments/1/statuses")) return "success\n";
    if (path.includes("/actions/workflows/")) return "";
    const status = path.match(/commits\/(\w+)\/status/);
    if (status) return Number(status[1]) === green ? "success\n" : "";
    const page = path.match(/commits\?sha=(\w+)&per_page=100/);
    if (page) {
      const start = page[1] === "main" ? length : Number(page[1]);
      const lines = [];
      for (let n = start; n > 0 && n > start - 100; n--)
        lines.push(
          JSON.stringify({ sha: sha(n), parents: n > 1 ? [sha(n - 1)] : [] }),
        );
      return lines.join("\n") + "\n";
    }
    throw new Error(`unexpected gh call ${args.join(" ")}`);
  };
  return { spawn, calls };
}

test("release:lane reads everything through gh — no git fetch, no git config, no git at all", async () => {
  const { spawn, calls } = fakeGitHub({
    length: 50,
    production: 40,
    green: 45,
  });
  const text = await readLane(REPO, { spawn });
  assert.match(text, new RegExp(`Release candidate:  ${sha(45)}`));
  assert.ok(calls.length > 0);
  assert.deepEqual(
    calls.filter(([cmd]) => cmd !== "gh"),
    [],
    "the CLI path must spawn nothing but gh",
  );
  for (const call of calls) {
    assert.ok(!call.includes("fetch"), `no fetch: ${call.join(" ")}`);
    assert.ok(!call.includes("config"), `no config: ${call.join(" ")}`);
  }
});

test("main history pages along first parents until the walk depth and production are covered", async () => {
  const { spawn, calls } = fakeGitHub({
    length: 450,
    production: 120,
    green: 0,
  });
  const history = await mainHistoryFromApi(REPO, {
    minimum: 200,
    through: sha(120),
    gh: ghVia(spawn),
  });
  assert.equal(history.length, 331); // 450 … 120: production is the deeper bound
  assert.equal(history[0], sha(450));
  assert.equal(history.at(-1), sha(120));
  assert.deepEqual(
    calls.map((c) => c[2]),
    [
      `repos/${REPO}/commits?sha=main&per_page=100`,
      `repos/${REPO}/commits?sha=${sha(350)}&per_page=100`,
      `repos/${REPO}/commits?sha=${sha(250)}&per_page=100`,
      `repos/${REPO}/commits?sha=${sha(150)}&per_page=100`,
    ],
  );
});

test("main history follows the first parent past a merge commit and stops at the root", async () => {
  const pages = {
    main: [
      { sha: sha(3), parents: [sha(2), sha(9)] },
      { sha: sha(9), parents: [sha(1)] },
      { sha: sha(2), parents: [sha(1)] },
      { sha: sha(1), parents: [] },
    ],
  };
  const gh = async (args) =>
    pages[args[1].match(/sha=(\w+)/)[1]].map((c) => JSON.stringify(c));
  assert.deepEqual(await mainHistoryFromApi(REPO, { minimum: 10, gh }), [
    sha(3),
    sha(2),
    sha(1),
  ]);
});
