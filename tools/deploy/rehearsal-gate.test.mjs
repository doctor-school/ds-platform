// tools/deploy/rehearsal-gate.test.mjs — the release driver's `rehearse` phase (Issue
// #3648; tech spec 2026-10-16-release-pipeline-off-workstation-en.md §5 «Migration
// rehearsal.» → «Release gate.»): the target tree's migration archive, the data verbs it
// calls, the poll to a terminal report, and the one-line verdict a failure note carries.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  REHEARSAL_CANNOT_RUN,
  REHEARSAL_GATE_BUDGET_MS,
  REHEARSAL_UNFINISHED,
  SKIP_REHEARSAL_FLAG,
  migrationArchive,
  parseSkipRehearsal,
  readTreeMigrations,
  rehearsalFailureReason,
  runRehearsalGate,
} from "./lib/rehearsal-gate.mjs";

const SHA = "a".repeat(40);

/** The members of a ustar stream: name, size and data, as tarfile reads them. */
function members(tarGz) {
  const tar = gunzipSync(tarGz);
  const out = [];
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(
      header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim(),
      8,
    );
    const sum = header.reduce(
      (s, b, i) => s + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    assert.equal(
      parseInt(header.subarray(148, 156).toString("utf8"), 8),
      sum,
      `${name}: checksum`,
    );
    assert.equal(
      String.fromCharCode(header[156]),
      "0",
      `${name}: a regular file`,
    );
    assert.equal(header.subarray(257, 263).toString("latin1"), "ustar\0");
    out.push({
      name,
      data: tar.subarray(at + 512, at + 512 + size).toString("utf8"),
    });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe("3648: the release gate's migration archive", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-rehearsal-gate-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("carries only drizzle/<tag>.sql and drizzle/meta/_journal.json of the tree, byte for byte", () => {
    const drizzle = join(dir, "apps/api/drizzle");
    mkdirSync(join(drizzle, "meta"), { recursive: true });
    writeFileSync(join(drizzle, "0000_init.sql"), "CREATE TABLE a (id int);\n");
    writeFileSync(join(drizzle, "0001_more.sql"), "ALTER TABLE a ADD b int;");
    writeFileSync(join(drizzle, "meta/_journal.json"), '{"entries":[]}\n');
    writeFileSync(join(drizzle, "meta/0000_snapshot.json"), "{}");
    writeFileSync(join(drizzle, "README.md"), "not a migration");
    const files = readTreeMigrations(dir);
    assert.deepEqual(members(migrationArchive(files)), [
      { name: "drizzle/0000_init.sql", data: "CREATE TABLE a (id int);\n" },
      { name: "drizzle/0001_more.sql", data: "ALTER TABLE a ADD b int;" },
      { name: "drizzle/meta/_journal.json", data: '{"entries":[]}\n' },
    ]);
  });

  it("refuses a tree with no journal and a member name ustar cannot hold", () => {
    assert.throws(
      () =>
        migrationArchive([
          { name: "drizzle/0000_a.sql", data: Buffer.from("") },
        ]),
      /no migration journal/,
    );
    assert.throws(
      () =>
        migrationArchive([
          { name: "drizzle/meta/_journal.json", data: Buffer.from("{}") },
          { name: `drizzle/${"x".repeat(100)}.sql`, data: Buffer.from("") },
        ]),
      /too long/,
    );
  });
});

describe("3648: the failure note of a rehearsal", () => {
  it("names the failing migration and its SQLSTATE, never the message", () => {
    const reason = rehearsalFailureReason({
      state: "failed",
      reason: null,
      migrations: [
        { tag: "0001_users", error: null },
        {
          tag: "0002_index",
          error: {
            sqlstate: "23505",
            message: "duplicate key value (email)=(doctor@x)",
          },
        },
      ],
    });
    assert.equal(reason, "migration 0002_index failed (SQLSTATE 23505)");
  });

  it("gives a fixed refusal reason as it is, anything else as the cannot-run reason", () => {
    for (const fixed of [
      "copy behind prod",
      "archive check failed",
      REHEARSAL_UNFINISHED,
      "insufficient headroom (disk)",
    ])
      assert.equal(
        rehearsalFailureReason({
          state: "failed",
          reason: fixed,
          migrations: [],
        }),
        fixed,
      );
    assert.equal(
      rehearsalFailureReason({
        state: "failed",
        reason: "row (email)=(x) broke",
        migrations: [],
      }),
      REHEARSAL_CANNOT_RUN,
    );
    assert.equal(
      rehearsalFailureReason({
        state: "failed",
        reason: null,
        migrations: [{ tag: "0001; rm", error: { sqlstate: "23505" } }],
      }),
      REHEARSAL_CANNOT_RUN,
      "a tag outside the journal's alphabet",
    );
    assert.equal(
      rehearsalFailureReason({
        state: "failed",
        reason: null,
        migrations: [{ tag: "0001_a", error: { sqlstate: "bad state" } }],
      }),
      REHEARSAL_CANNOT_RUN,
    );
  });
});

describe("3648: --skip-rehearsal", () => {
  it("needs a non-empty reason", () => {
    assert.deepEqual(parseSkipRehearsal(["node", "prod.mjs"]), {
      skip: false,
      reason: null,
    });
    assert.deepEqual(
      parseSkipRehearsal([
        SKIP_REHEARSAL_FLAG,
        "  owner go: 0042 is data-only  ",
      ]),
      {
        skip: true,
        reason: "owner go: 0042 is data-only",
      },
    );
    for (const bad of [
      [SKIP_REHEARSAL_FLAG],
      [SKIP_REHEARSAL_FLAG, " "],
      [SKIP_REHEARSAL_FLAG, "--ref"],
    ])
      assert.match(
        parseSkipRehearsal(bad).error,
        /requires a non-empty reason/,
        bad.join(" "),
      );
  });
});

describe("3648: the gate run", () => {
  /** A data hop answering `rehearse` / `rehearsal-status` from a script of answers. */
  function hop(script) {
    const calls = [];
    let clock = 0;
    const queue = {
      rehearse: [...(script.rehearse ?? [])],
      "rehearsal-status": [...(script.status ?? [])],
    };
    return {
      calls,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      call: async (words, options = {}) => {
        calls.push({ words, input: options.input });
        const next = queue[words[0]].shift();
        if (next === undefined)
          throw new Error(`no scripted answer for ${words.join(" ")}`);
        if (next instanceof Error) throw next;
        return typeof next === "string" ? next : JSON.stringify(next);
      },
    };
  }
  const gate = (h, extra = {}) =>
    runRehearsalGate({
      sha: SHA,
      archive: Buffer.from("tgz"),
      call: h.call,
      now: h.now,
      sleep: h.sleep,
      log: () => {},
      pollMs: 10_000,
      ...extra,
    });
  const report = (over = {}) => ({
    verb: "rehearse",
    sha: SHA,
    state: "succeeded",
    reason: null,
    restoreOnly: false,
    pending: 1,
    migrations: [{ tag: "0001_a", error: null }],
    ...over,
  });

  it("with nothing pending, passes on the start's answer and polls nothing", async () => {
    const lines = [];
    const h = hop({
      rehearse: [
        {
          verb: "rehearse",
          sha: SHA,
          state: "no pending migrations",
          pending: 0,
        },
      ],
    });
    assert.deepEqual(await gate(h, { log: (l) => lines.push(l) }), {
      ok: true,
      pending: 0,
    });
    assert.deepEqual(lines, ["rehearsal: no pending migrations"]);
    assert.deepEqual(
      h.calls.map((c) => c.words),
      [["rehearse", SHA]],
    );
    assert.deepEqual(
      h.calls[0].input,
      Buffer.from("tgz"),
      "the archive rides the verb's stdin",
    );
  });

  it("polls a started rehearsal to its report and passes on succeeded", async () => {
    const h = hop({
      rehearse: [{ state: "started", pending: 1 }],
      status: [{ state: "running" }, { state: "running" }, report()],
    });
    assert.deepEqual(await gate(h), { ok: true, pending: 1 });
    assert.deepEqual(
      h.calls.map((c) => c.words[0]),
      ["rehearse", "rehearsal-status", "rehearsal-status", "rehearsal-status"],
    );
  });

  it("attaches to this SHA's running rehearsal (a retried driver) instead of refusing", async () => {
    const h = hop({ rehearse: [{ state: "running" }], status: [report()] });
    assert.deepEqual(await gate(h), { ok: true, pending: 1 });
  });

  it("fails on the failed migration's tag and SQLSTATE", async () => {
    const h = hop({
      rehearse: [{ state: "started" }],
      status: [
        report({
          state: "failed",
          migrations: [
            {
              tag: "0001_a",
              error: { sqlstate: "42P07", message: "relation x exists" },
            },
          ],
        }),
      ],
    });
    assert.deepEqual(await gate(h), {
      ok: false,
      reason: "migration 0001_a failed (SQLSTATE 42P07)",
    });
  });

  it("fails on a refused start with its fixed reason, any other refusal as cannot-run", async () => {
    const busy = hop({
      rehearse: [
        new Error(
          "rehearse on deploy@10.0.0.2 exited 1: ds-deploy-entrypoint: insufficient headroom (disk)",
        ),
      ],
    });
    assert.deepEqual(await gate(busy), {
      ok: false,
      reason: "insufficient headroom (disk)",
    });
    const odd = hop({
      rehearse: [
        new Error(
          "rehearse on deploy@10.0.0.2 exited 255: ssh: connect to host 10.0.0.2: refused",
        ),
      ],
    });
    assert.deepEqual(await gate(odd), {
      ok: false,
      reason: REHEARSAL_CANNOT_RUN,
    });
    const garbled = hop({ rehearse: ["not json"] });
    assert.deepEqual(await gate(garbled), {
      ok: false,
      reason: REHEARSAL_CANNOT_RUN,
    });
  });

  it("a restore-only report of the SHA is never its pass: the gate starts its own rehearsal once", async () => {
    // A `rehearse-restore <sha>` from prod-observe.yml runs (same unit, same report path):
    // the start attaches with `running`, the terminal report is restoreOnly — not a verdict.
    const h = hop({
      rehearse: [{ state: "running" }, { state: "started", pending: 1 }],
      status: [
        report({ restoreOnly: true, pending: 0, migrations: [] }),
        report(),
      ],
    });
    assert.deepEqual(await gate(h), { ok: true, pending: 1 });
    assert.deepEqual(
      h.calls.map((c) => c.words[0]),
      ["rehearse", "rehearsal-status", "rehearse", "rehearsal-status"],
    );
    // A second restore-only report (another rehearse-restore raced in) refuses.
    const again = hop({
      rehearse: [{ state: "running" }, { state: "running" }],
      status: [report({ restoreOnly: true }), report({ restoreOnly: true })],
    });
    assert.deepEqual(await gate(again), {
      ok: false,
      reason: "a rehearsal is running",
    });
    // A report without restoreOnly false, or of another SHA, is no pass either.
    const foreign = hop({
      rehearse: [{ state: "started" }],
      status: [report({ sha: "b".repeat(40) })],
    });
    assert.deepEqual(await gate(foreign), {
      ok: false,
      reason: REHEARSAL_CANNOT_RUN,
    });
  });

  it("a rehearsal still running at the 15-min budget fails as unfinished", async () => {
    assert.equal(REHEARSAL_GATE_BUDGET_MS, 15 * 60 * 1000);
    const h = hop({
      rehearse: [{ state: "started" }],
      status: Array.from({ length: 200 }, () => ({ state: "running" })),
    });
    assert.deepEqual(await gate(h), {
      ok: false,
      reason: REHEARSAL_UNFINISHED,
    });
    const polls = h.calls.filter(
      (c) => c.words[0] === "rehearsal-status",
    ).length;
    assert.ok(
      polls <= REHEARSAL_GATE_BUDGET_MS / 10_000,
      `${polls} polls inside the budget`,
    );
    assert.ok(h.now() <= REHEARSAL_GATE_BUDGET_MS, "never past the budget");
  });

  it("an absent report after the start, or a status refusal, cannot run", async () => {
    assert.deepEqual(
      await gate(
        hop({
          rehearse: [{ state: "started" }],
          status: [{ state: "absent" }],
        }),
      ),
      {
        ok: false,
        reason: REHEARSAL_CANNOT_RUN,
      },
    );
    assert.deepEqual(
      await gate(
        hop({
          rehearse: [{ state: "started" }],
          status: [
            new Error(
              "rehearsal-status on h exited 1: ds-deploy-entrypoint: the read failed",
            ),
          ],
        }),
      ),
      { ok: false, reason: "the read failed" },
    );
  });
});
