import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArgs,
  sshTargets,
  assertOutsideGitRepo,
  assertNoOverwrite,
  parseKeygen,
  parseTar,
  memberGate,
  envValue,
  fingerprint,
  fingerprintVerdict,
  pgbackrestRun,
  copyRun,
  assertSafeDockerRun,
  scratchDir,
  assertScratch,
  parseCheckSeg,
  segRestored,
  parseRedoLsn,
  parseInfo,
  headroom,
  proofVerdict,
  sanitizeReport,
  renderReport,
  sections,
  proofScript,
  proofMarker,
  teardownScript,
  bundleName,
  initKeys,
  buildBundle,
  bundle,
  restoreProof,
  factsScript,
  infoScript,
  remoteScript,
  ENV_FILE,
  ENV_DIR,
  PROOF_PID,
  RUN_LABEL,
  CONF,
} from "./recovery.mjs";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const IMG = "sha256:" + "a".repeat(64);

// --- arg parsing -------------------------------------------------------------

test("parseArgs: subcommands, flags and the default out dir", () => {
  const home = "/u/o";
  assert.deepEqual(parseArgs(["doctor"], { home }), {
    cmd: "doctor",
    out: "/u/o/ds-recovery",
    bundle: null,
    identity: null,
    testB: false,
  });
  assert.equal(parseArgs(["bundle", "--test-b"], { home }).testB, true);
  assert.equal(parseArgs(["teardown"], { home }).cmd, "teardown");
  const p = parseArgs(
    [
      "restore-proof",
      "--bundle",
      "b.tar.age",
      "--out",
      "/x",
      "--identity",
      "/k",
    ],
    { home },
  );
  assert.equal(p.cmd, "restore-proof");
  assert.equal(p.bundle, "b.tar.age");
  assert.equal(p.out, "/x");
  assert.equal(p.identity, "/k");
  assert.equal(parseArgs(["init-keys", "--out=/y"], { home }).out, "/y");
});

test("parseArgs: rejects unknown command, unknown flag, missing value and a missing --bundle", () => {
  assert.throws(() => parseArgs([], {}), /usage/);
  assert.throws(() => parseArgs(["nuke"], {}), /unknown command/);
  assert.throws(() => parseArgs(["doctor", "--force"], {}), /unknown flag/);
  assert.throws(() => parseArgs(["doctor", "--out"], {}), /needs a value/);
  assert.throws(() => parseArgs(["restore-proof"], {}), /--bundle/);
});

// --- ssh targets --------------------------------------------------------------

test("sshTargets: breakglass explicit, data-prod jumps through api-prod", () => {
  const t = sshTargets({ env: {} });
  assert.deepEqual(t.api("sudo -n true").slice(-2), [
    "breakglass@ds-api-prod",
    "sudo -n true",
  ]);
  const d = t.data("sudo -n true");
  assert.ok(d.includes("-J"));
  assert.equal(d[d.indexOf("-J") + 1], "breakglass@ds-api-prod");
  assert.deepEqual(d.slice(-2), ["breakglass@192.168.0.10", "sudo -n true"]);
});

test("sshTargets: --identity pins the key on both hops (ProxyCommand, not -J)", () => {
  const d = sshTargets({ env: {}, identity: "/k/ds-breakglass-prod" }).data(
    "x",
  );
  assert.ok(!d.includes("-J"));
  assert.ok(d.includes("IdentitiesOnly=yes"));
  const proxy = d.find((a) => a.startsWith("ProxyCommand="));
  assert.match(
    proxy,
    /-i "\/k\/ds-breakglass-prod".*-W %h:%p breakglass@ds-api-prod/,
  );
});

test("sshTargets: overrides must name the breakglass user", () => {
  assert.throws(
    () => sshTargets({ env: { DS_API_PROD_SSH: "ds-api-prod" } }),
    /breakglass@/,
  );
  const t = sshTargets({ env: { DS_DATA_PROD_SSH: "breakglass@10.0.0.9" } });
  assert.equal(t.data("x").at(-2), "breakglass@10.0.0.9");
});

// --- identities on disk -------------------------------------------------------

test("assertOutsideGitRepo: refuses any directory under a .git ancestor", () => {
  const exists = (p) => p.replaceAll("\\", "/") === "/r/repo/.git";
  assert.throws(
    () => assertOutsideGitRepo("/r/repo/sub/ds-recovery", { exists }),
    /git repository/,
  );
  assertOutsideGitRepo("/r/other/ds-recovery", { exists });
});

test("assertNoOverwrite: refuses an existing identity or recipient", () => {
  const exists = (p) => p.replaceAll("\\", "/").endsWith("/identity-A.age");
  assert.throws(
    () => assertNoOverwrite("/o", ["identity-A.age", "A.pub"], { exists }),
    /identity-A\.age/,
  );
  assertNoOverwrite("/o", ["A.pub"], { exists });
});

test("initKeys: refuses inside a git repo and before any key is generated", async () => {
  const calls = [];
  await assert.rejects(
    initKeys({
      out: "/r/repo/keys",
      exists: (p) => p.replaceAll("\\", "/") === "/r/repo/.git",
      run: async (c) => (calls.push(c), { code: 0, stdout: Buffer.from("") }),
    }),
    /git repository/,
  );
  assert.equal(calls.length, 0);
});

test("parseKeygen: identity + recipient", () => {
  const k = parseKeygen(
    "# created: 2026-11-04T00:00:00Z\n# public key: age1abc\nAGE-SECRET-KEY-1XYZ\n",
  );
  assert.deepEqual(k, {
    identity: "AGE-SECRET-KEY-1XYZ",
    recipient: "age1abc",
  });
  assert.throws(() => parseKeygen("garbage"), /age-keygen/);
});

// --- tar + member gate --------------------------------------------------------

function tarOf(files) {
  const blocks = [];
  for (const [name, body] of files) {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write("0000600\0", 100);
    h.write(Buffer.byteLength(body).toString(8).padStart(11, "0") + "\0", 124);
    h.write("0", 156);
    h.write("ustar\0", 257);
    const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
    data.write(body);
    blocks.push(h, data);
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

test("parseTar: names and bodies", () => {
  const m = parseTar(
    tarOf([
      ["api.env", "A=1\n"],
      ["zitadel.env", "Z=2\n"],
    ]),
  );
  assert.deepEqual(
    m.map((e) => e.name),
    ["api.env", "zitadel.env"],
  );
  assert.equal(m[1].data.toString(), "Z=2\n");
  assert.throws(() => parseTar(Buffer.from("not a tar")), /tar/);
});

test("memberGate: missing, empty, extra and unsafe members", () => {
  assert.equal(memberGate("api-prod", ["api.env", "zitadel.env"]).ok, true);
  const extra = memberGate("api-prod", [
    "api.env",
    "zitadel.env",
    "internal.env",
    "old.env",
  ]);
  assert.equal(extra.ok, true);
  assert.deepEqual(extra.extra, ["internal.env", "old.env"]);
  assert.match(memberGate("api-prod", ["api.env"]).reason, /no zitadel\.env/);
  assert.match(memberGate("data-prod", []).reason, /empty/);
  assert.match(
    memberGate("data-prod", ["data.env", "../x.env"]).reason,
    /unexpected member/,
  );
  assert.match(
    memberGate("data-prod", ["data.env", "data.env"]).reason,
    /duplicate/,
  );
});

// --- fingerprints -------------------------------------------------------------

test("envValue + fingerprint mirror sed -n 's/^KEY=//p' | tr -d '\\r\\n' | sha256sum", () => {
  const text = "A=1\r\nPGBACKREST_REPO1_CIPHER_PASS=s3cr3t\r\nB=2\n";
  assert.equal(envValue(text, "PGBACKREST_REPO1_CIPHER_PASS"), "s3cr3t");
  assert.equal(envValue(text, "MISSING"), "");
  assert.equal(
    fingerprint("s3cr3t"),
    "4e738ca5563c06cfd0018299933d58db1dd8bf97f6973dc99bf6cdc64b5550bd",
  );
});

test("fingerprintVerdict: MATCH / MISMATCH only, an empty value never matches", () => {
  const f = fingerprint("v");
  assert.equal(fingerprintVerdict("K", `${f}  -\n`, f), "MATCH K");
  assert.equal(
    fingerprintVerdict("K", `${"0".repeat(64)}  -`, f),
    "MISMATCH K",
  );
  assert.equal(
    fingerprintVerdict("K", fingerprint(""), fingerprint("")),
    "MISMATCH K",
  );
});

// --- docker command invariants ------------------------------------------------

test("pgbackrestRun: --rm --user postgres --entrypoint pgbackrest, prod pgdata read-only", () => {
  const argv = pgbackrestRun({
    image: IMG,
    check: true,
    args: ["--stanza=ds", "check"],
  });
  assert.deepEqual(argv.slice(0, 3), ["docker", "run", "--rm"]);
  assert.equal(argv[argv.indexOf("--entrypoint") + 1], "pgbackrest");
  assert.equal(argv[argv.indexOf("--user") + 1], "postgres");
  assert.ok(argv.includes("ds-data-prod_pgdata:/var/lib/postgresql/data:ro"));
  assert.ok(argv.includes(`${ENV_FILE}`));
  assert.ok(argv.includes(`${CONF}:/etc/pgbackrest/pgbackrest.conf:ro`));
  const info = pgbackrestRun({ image: IMG, args: ["info"] });
  assert.ok(
    !info.some((a) => a.startsWith("ds-data-prod_")),
    "only check mounts prod volumes",
  );
});

test("copyRun: isolated copy, no publish, listen_addresses='' and archive_mode=off", () => {
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  const argv = copyRun({ image: IMG, scratch });
  assert.equal(argv[argv.indexOf("--name") + 1], "ds-recovery-pg");
  assert.equal(argv[argv.indexOf("--network") + 1], "bridge");
  assert.ok(argv.includes("--rm"));
  assert.ok(argv.includes("listen_addresses="));
  assert.ok(argv.includes("archive_mode=off"));
  assert.ok(!argv.some((a) => /^(-p|--publish|-P|--publish-all)/.test(a)));
  assert.ok(!argv.some((a) => a.startsWith("ds-data-prod_")));
});

test("assertSafeDockerRun: every invariant is enforced", () => {
  const br = pgbackrestRun({ image: IMG, args: ["info"] });
  const drop = (a, x) =>
    a.filter((v, i) => (v !== x && a[i - 1] !== x) || false);
  assert.throws(
    () =>
      assertSafeDockerRun(
        br.filter((a) => a !== "--rm"),
        "pgbackrest",
      ),
    /--rm/,
  );
  assert.throws(
    () => assertSafeDockerRun(drop(br, "--entrypoint"), "pgbackrest"),
    /--entrypoint pgbackrest/,
  );
  assert.throws(
    () => assertSafeDockerRun(drop(br, "--user"), "pgbackrest"),
    /--user postgres/,
  );
  for (const pub of [["-p", "5432:5432"], ["--publish=5432:5432"], ["-P"]])
    assert.throws(
      () =>
        assertSafeDockerRun(
          [...br.slice(0, 3), ...pub, ...br.slice(3)],
          "pgbackrest",
        ),
      /publish/,
    );
  assert.throws(
    () =>
      assertSafeDockerRun(
        [
          ...br.slice(0, 3),
          "--network",
          "ds-data-prod_default",
          ...br.slice(3),
        ],
        "pgbackrest",
      ),
    /network/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        [
          ...br.slice(0, 3),
          "--label",
          "com.docker.compose.project=ds-data-prod",
          ...br.slice(3),
        ],
        "pgbackrest",
      ),
    /compose project/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        [
          ...br.slice(0, 3),
          "-v",
          "ds-data-prod_pgdata:/var/lib/postgresql/data",
          ...br.slice(3),
        ],
        "pgbackrest",
      ),
    /read-only/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        [
          ...br.slice(0, 3),
          "-v",
          "ds-data-prod_pgsocket:/var/run/postgresql",
          ...br.slice(3),
        ],
        "pgbackrest",
      ),
    /pgsocket/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        [...br.slice(0, 3), "--name", "pg-copy", ...br.slice(3)],
        "pgbackrest",
      ),
    /ds-recovery-/,
  );
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  const copy = copyRun({ image: IMG, scratch });
  assert.throws(
    () =>
      assertSafeDockerRun(
        copy.filter((a) => a !== "archive_mode=off"),
        "copy",
      ),
    /archive_mode=off/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        copy.filter((a) => a !== "listen_addresses="),
        "copy",
      ),
    /listen_addresses/,
  );
  assert.throws(
    () =>
      assertSafeDockerRun(
        copy.filter((a) => a !== "--rm"),
        "copy",
      ),
    /--rm/,
  );
});

test("scratchDir / assertScratch: namespaced, refuses anything else for rm -rf", () => {
  const s = scratchDir(new Date("2026-11-04T10:00:00Z"));
  assert.equal(
    s,
    "/var/lib/ds-platform/recovery-proof/ds-recovery-20261104T100000Z",
  );
  assertScratch(s);
  for (const bad of [
    "/",
    "/var/lib/ds-platform",
    "/var/lib/ds-platform/recovery-proof/x",
    `${s}/..`,
  ])
    assert.throws(() => assertScratch(bad), /scratch/);
});

test("proofScript / teardownScript: every docker run is safe, teardown is trapped", () => {
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  const script = proofScript({ brImage: IMG, pgImage: IMG, scratch });
  assert.match(script, /trap teardown EXIT/);
  assert.match(script, /docker logs -f ds-recovery-pg/);
  assert.ok(!/\s(-p|--publish)\s/.test(script));
  const runs = script
    .split("\n")
    .filter((l) => /docker' 'run'|docker run/.test(l));
  assert.ok(runs.length >= 3);
  for (const l of runs) assert.match(l, /'--rm'/);
  const td = teardownScript({ brImage: IMG, scratch });
  assert.match(td, /docker stop \$IDS/);
  assert.match(
    td,
    /rm -rf -- '\/var\/lib\/ds-platform\/recovery-proof\/ds-recovery-20261104T100000Z'/,
  );
  assert.match(td, /rm -f -- '\/run\/ds-recovery\/restore\.env'/);
  assert.throws(
    () => teardownScript({ brImage: IMG, scratch: "/" }),
    /scratch/,
  );
});

// --- parsing ------------------------------------------------------------------

test("parseCheckSeg: segment from pgbackrest check output", () => {
  const out =
    "P00   INFO: check command begin 2.54.0\n" +
    "P00   INFO: WAL segment 00000001000000020000003A successfully archived to '/pgbackrest/archive/ds/17-1/...'\n" +
    "P00   INFO: check command end: completed successfully\n";
  assert.equal(parseCheckSeg(out), "00000001000000020000003A");
  assert.equal(
    parseCheckSeg("P00 ERROR: [082]: WAL segment not archived"),
    null,
  );
});

test("segRestored + parseRedoLsn: from the copy's postgres log", () => {
  const seg = "00000001000000020000003A";
  const logs =
    `LOG:  restored log file "000000010000000200000039" from archive\n` +
    `LOG:  restored log file "${seg}" from archive\n` +
    "LOG:  redo done at 2/3A000110 system usage: CPU\n" +
    "LOG:  archive recovery complete\n";
  assert.equal(segRestored(logs, seg), true);
  assert.equal(segRestored(logs, "00000001000000020000003B"), false);
  assert.equal(segRestored(logs, null), false);
  assert.equal(parseRedoLsn(logs), "2/3A000110");
  assert.equal(parseRedoLsn("nothing"), null);
});

test("parseInfo: backup point, size and timeline from info --output=json", () => {
  const json = JSON.stringify([
    {
      name: "ds",
      archive: [
        {
          id: "17-1",
          min: "000000010000000100000001",
          max: "00000001000000020000003A",
        },
      ],
      backup: [
        {
          label: "20261103-010000F",
          type: "full",
          archive: { start: "A", stop: "B" },
          info: { size: 10 },
        },
        {
          label: "20261104-010000F",
          type: "full",
          archive: {
            start: "000000010000000200000030",
            stop: "000000010000000200000031",
          },
          info: { size: 2147483648 },
        },
      ],
    },
  ]);
  assert.deepEqual(parseInfo(json), {
    label: "20261104-010000F",
    type: "full",
    walStart: "000000010000000200000030",
    walStop: "000000010000000200000031",
    dbBytes: 2147483648,
    timeline: "00000001",
  });
  assert.throws(() => parseInfo("[]"), /stanza ds/);
});

test("headroom: free >= 1.5 x db + 2 GiB and MemAvailable >= 1 GiB", () => {
  const GiB = 1024 ** 3;
  assert.equal(
    headroom({
      availBytes: 5 * GiB,
      dbBytes: 2 * GiB,
      memAvailKiB: 1024 * 1024,
    }).ok,
    true,
  );
  assert.equal(
    headroom({
      availBytes: 5 * GiB - 1,
      dbBytes: 2 * GiB,
      memAvailKiB: 1024 * 1024,
    }).ok,
    false,
  );
  assert.equal(
    headroom({
      availBytes: 9 * GiB,
      dbBytes: 2 * GiB,
      memAvailKiB: 1024 * 1024 - 1,
    }).ok,
    false,
  );
});

test("sections: splits @@DSR markers", () => {
  assert.deepEqual(sections("noise\n@@DSR a\n1\n2\n@@DSR b\n\n"), {
    a: "1\n2",
    b: "",
  });
});

// --- verdict ------------------------------------------------------------------

const passFacts = {
  checkOk: true,
  seg: "00000001000000020000003A",
  restoreExit: 0,
  segRestored: true,
  recoveryComplete: true,
  inRecovery: "f",
  migrations: 42,
  databases: ["ds_prod", "zitadel"],
  counts: [
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ],
  timelineEqual: true,
  historyEqual: true,
  teardownClean: true,
};

test("proofVerdict: PASS needs the SEG line plus pg_is_in_recovery()=f", () => {
  assert.deepEqual(proofVerdict(passFacts), { verdict: "PASS", reasons: [] });
  const noSeg = proofVerdict({ ...passFacts, segRestored: false });
  assert.equal(noSeg.verdict, "PARTIAL");
  assert.match(noSeg.reasons.join(), /SEG/);
  assert.equal(
    proofVerdict({ ...passFacts, inRecovery: "t" }).verdict,
    "PARTIAL",
  );
  assert.equal(
    proofVerdict({ ...passFacts, counts: [["a", 0]] }).verdict,
    "PARTIAL",
  );
  assert.equal(
    proofVerdict({ ...passFacts, databases: ["ds_prod"] }).verdict,
    "PARTIAL",
  );
});

test("proofVerdict: FAIL on no check segment, restore error, stanza drift or dirty teardown", () => {
  assert.equal(proofVerdict({ ...passFacts, checkOk: false }).verdict, "FAIL");
  assert.equal(proofVerdict({ ...passFacts, seg: null }).verdict, "FAIL");
  assert.equal(proofVerdict({ ...passFacts, restoreExit: 1 }).verdict, "FAIL");
  assert.equal(
    proofVerdict({ ...passFacts, timelineEqual: false }).verdict,
    "FAIL",
  );
  assert.equal(
    proofVerdict({ ...passFacts, historyEqual: false }).verdict,
    "FAIL",
  );
  assert.equal(
    proofVerdict({ ...passFacts, teardownClean: false }).verdict,
    "FAIL",
  );
  assert.equal(proofVerdict({}).verdict, "FAIL");
});

// --- sanitiser ----------------------------------------------------------------

test("sanitizeReport: refuses key assignments and long secret-shaped runs", () => {
  const keys = ["PGBACKREST_REPO1_CIPHER_PASS", "POSTGRES_PASSWORD"];
  assert.equal(
    sanitizeReport("Verdict: PASS\ncounts users=12", keys),
    "Verdict: PASS\ncounts users=12",
  );
  assert.throws(
    () => sanitizeReport("x PGBACKREST_REPO1_CIPHER_PASS=abc", keys),
    /line 1/,
  );
  assert.throws(
    () => sanitizeReport("ok\nPOSTGRES_PASSWORD = abc", keys),
    /line 2/,
  );
  assert.throws(() => sanitizeReport("SOME_OTHER_KEY=v", keys), /line 1/);
  assert.throws(
    () => sanitizeReport(`token ${"ab12".repeat(8)}`, keys),
    /line 1/,
  );
  assert.throws(
    () => sanitizeReport(`b64 ${"QUJD".repeat(8)}==`, keys),
    /line 1/,
  );
  assert.throws(
    () =>
      sanitizeReport(
        "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
        keys,
      ),
    /line 1/,
  );
  const fp = "sha256:" + "f".repeat(64);
  assert.equal(sanitizeReport(`fingerprint ${fp}`, keys), `fingerprint ${fp}`);
  assert.throws(() => sanitizeReport("f".repeat(64), keys), /line 1/);
  assert.equal(
    sanitizeReport("label 20261104-010000F_20261104-020000I", keys).length > 0,
    true,
  );
});

test("renderReport: the §3.5 template passes the sanitiser", () => {
  const text = renderReport({
    at: new Date("2026-11-04T10:00:00Z"),
    bundleDate: "2026-11-04",
    fingerprints: "4/4",
    info: {
      label: "20261104-010000F",
      type: "full",
      walStart: "S",
      walStop: "E",
    },
    versions: { pgbackrest: "2.54.0", postgres: "17.6" },
    images: { postgres: IMG, pgbackrest: IMG, equal: true },
    headroom: { availGiB: "40.0", neededGiB: "5.0", memGiB: "3.1" },
    ...passFacts,
    redo: "2/3A000110",
    amcheck: "ok",
    timeline: ["00000001", "00000001"],
    history: [0, 0],
    verdict: { verdict: "PASS", reasons: [] },
  });
  assert.match(text, /^Restore proof — 2026-11-04 10:00 UTC — ds-data-prod/);
  assert.match(
    text,
    /Images: postgres sha256:aaaaaaaaaaaa, pgbackrest sha256:aaaaaaaaaaaa; equal to state file `images`: yes/,
  );
  assert.match(text, /Verdict: PASS$/);
  sanitizeReport(text, ["PGBACKREST_REPO1_CIPHER_PASS"]);
});

// --- orchestration with an injected runner --------------------------------------

test("bundleName: namespaced per host and UTC date", () => {
  assert.equal(
    bundleName("api-prod", new Date("2026-11-04T23:00:00Z")),
    "ds-recovery-2026-11-04-api-prod.tar.age",
  );
});

test("buildBundle: a failed member gate deletes the bundle and fails", async () => {
  const removed = [];
  const tar = tarOf([["api.env", "SIGN_IN_RECORD_KEY=x\n"]]);
  const run = async (c) => {
    if (c.cmd === "ssh") return { code: 0, stdout: tar };
    if (c.cmd === "age" && c.args[0] === "-R")
      return { code: 0, stdout: Buffer.alloc(0) };
    if (c.cmd === "age" && c.args[0] === "-d") return { code: 0, stdout: tar };
    throw new Error(`unexpected ${c.cmd}`);
  };
  await assert.rejects(
    buildBundle({
      host: "api-prod",
      file: "/o/ds-recovery-2026-11-04-api-prod.tar.age",
      ssh: (cmd) => ["breakglass@ds-api-prod", cmd],
      recipients: ["/o/A.pub", "/o/B.pub"],
      identities: { A: "AGE-SECRET-KEY-1A", B: "AGE-SECRET-KEY-1B" },
      run,
      remove: (f) => removed.push(f),
      print: () => {},
    }),
    /no zitadel\.env/,
  );
  assert.deepEqual(removed, ["/o/ds-recovery-2026-11-04-api-prod.tar.age"]);
});

test("buildBundle: a fingerprint mismatch deletes the bundle; output never holds a value", async () => {
  const removed = [];
  const printed = [];
  const tar = tarOf([["data.env", "PGBACKREST_REPO1_CIPHER_PASS=topsecret\n"]]);
  const run = async (c) => {
    if (c.cmd === "ssh" && c.args.at(-1).includes("tar -cf"))
      return { code: 0, stdout: tar };
    if (c.cmd === "ssh")
      return { code: 0, stdout: Buffer.from(`${fingerprint("other")}  -\n`) };
    return { code: 0, stdout: c.args[0] === "-d" ? tar : Buffer.alloc(0) };
  };
  await assert.rejects(
    buildBundle({
      host: "data-prod",
      file: "/o/d.tar.age",
      ssh: (cmd) => ["breakglass@192.168.0.10", cmd],
      recipients: ["/o/A.pub", "/o/B.pub"],
      identities: { A: "AGE-SECRET-KEY-1A", B: "AGE-SECRET-KEY-1B" },
      run,
      remove: (f) => removed.push(f),
      print: (l) => printed.push(l),
    }),
    /MISMATCH PGBACKREST_REPO1_CIPHER_PASS/,
  );
  assert.deepEqual(removed, ["/o/d.tar.age"]);
  assert.ok(!printed.join("\n").includes("topsecret"));
});

test("buildBundle: test decrypt with B reads B from stdin, never from a file", async () => {
  const tar = tarOf([["data.env", "PGBACKREST_REPO1_CIPHER_PASS=v\n"]]);
  const decrypts = [];
  const run = async (c) => {
    if (c.cmd === "ssh" && c.args.at(-1).includes("tar -cf"))
      return { code: 0, stdout: tar };
    if (c.cmd === "ssh")
      return { code: 0, stdout: Buffer.from(fingerprint("v")) };
    if (c.args[0] === "-d") {
      decrypts.push(c);
      return { code: 0, stdout: tar };
    }
    return { code: 0, stdout: Buffer.alloc(0) };
  };
  const result = await buildBundle({
    host: "data-prod",
    file: "/o/d.tar.age",
    ssh: (cmd) => ["h", cmd],
    recipients: ["/o/A.pub", "/o/B.pub"],
    identities: { A: "AGE-SECRET-KEY-1A", B: "AGE-SECRET-KEY-1B" },
    run,
    remove: () => assert.fail("must not remove"),
    print: () => {},
  });
  assert.deepEqual(result.members, ["data.env"]);
  assert.equal(result.matched, 1);
  assert.deepEqual(
    decrypts.map((d) => d.args.slice(0, 3)),
    [
      ["-d", "-i", "-"],
      ["-d", "-i", "-"],
    ],
  );
  assert.deepEqual(
    decrypts.map((d) => d.input.toString()),
    ["AGE-SECRET-KEY-1A\n", "AGE-SECRET-KEY-1B\n"],
  );
});

// --- remote scripts under a real `bash -s` --------------------------------------------

const SEG = "0000000100000000000000AB";
const DOCKER_SHIM = `#!/usr/bin/env bash
# Stands in for docker on the host; drains stdin on -i as the real client does.
echo "$*" >> "$DSR_CALLS"
case "$1" in
  exec)
    if [ "$2" = "-i" ]; then cat >/dev/null; printf 'users|5\\nposts|4\\ntags|3\\n'; exit 0; fi
    case "$*" in
      *pg_is_in_recovery*) echo f ;;
      *server_version*) echo 17.6 ;;
      *drizzle_migrations*) echo "42|2026-11-01" ;;
      *pg_database*) printf 'ds_prod\\nzitadel\\n' ;;
    esac ;;
  run)
    case "$*" in
      *" check")
        [ -n "\${DSR_SIGNAL:-}" ] && kill -TERM "$(head -n1 "$DSR_PID")"
        echo "WAL segment ${SEG} successfully archived"; echo "check command end" ;;
      *" restore") echo "restore command end" ;;
    esac ;;
  logs)
    echo 'restored log file "${SEG}" from archive'
    echo "archive recovery complete"
    echo "database system is ready to accept connections" ;;
  inspect) echo true ;;
esac
exit 0
`;

const bashOk =
  spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() ===
  "ok";

function runProofUnderBash({ signal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dsr-")).replace(/\\/g, "/");
  const bin = join(root, "bin");
  mkdirSync(bin);
  const shim = (name, body) => {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  };
  shim("docker", DOCKER_SHIM);
  shim("install", '#!/usr/bin/env bash\nmkdir -p "${@: -1}"\n');
  shim("sleep", "#!/usr/bin/env bash\nexit 0\n");
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  const envDir = `${root}/run`;
  mkdirSync(envDir);
  writeFileSync(`${envDir}/restore.env`, "X=1\n");
  mkdirSync(`${root}/scratch`);
  const text = proofScript({ brImage: IMG, pgImage: IMG, scratch })
    .split(scratch)
    .join(`${root}/scratch`)
    .split(ENV_DIR)
    .join(envDir);
  const r = spawnSync("bash", ["-s"], {
    input: text,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      DSR_CALLS: `${root}/calls`,
      DSR_PID: `${envDir}/proof.pid`,
      DSR_SIGNAL: signal ? "1" : "",
    },
  });
  return { r, root, envDir, sec: sections(r.stdout) };
}

test(
  "proofScript under bash -s: an inner stdin reader never swallows the script",
  { skip: !bashOk && "bash not available" },
  () => {
    const { r, root, sec } = runProofUnderBash();
    assert.ok("end" in sec, `script stopped early: ${r.stdout}\n${r.stderr}`);
    assert.equal(sec["in-recovery"], "f");
    assert.equal(sec.databases, "ds_prod\nzitadel");
    assert.equal(sec.counts, "users|5\nposts|4\ntags|3");
    assert.ok(sec["seg-restored"].includes(SEG));
    assert.equal(
      existsSync(`${root}/scratch`),
      false,
      "EXIT trap removes scratch",
    );
  },
);

test(
  "proofScript under bash -s: a signal removes the staged env file and the scratch",
  { skip: !bashOk && "bash not available" },
  () => {
    const { sec, root, envDir } = runProofUnderBash({ signal: true });
    assert.ok(!("end" in sec));
    assert.equal(existsSync(`${envDir}/restore.env`), false);
    assert.equal(existsSync(`${envDir}/proof.pid`), false);
    assert.equal(existsSync(`${root}/scratch`), false);
  },
);

test("remote scripts: parsed whole with stdin from /dev/null, no stdin-inheriting -i", () => {
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  for (const text of [
    factsScript({ scratch }),
    infoScript({ brImage: IMG }),
    proofScript({ brImage: IMG, pgImage: IMG, scratch }),
    teardownScript({ brImage: IMG, scratch }),
    teardownScript({}),
  ]) {
    assert.match(text, /^ds_main\(\) \{\n/);
    assert.ok(text.endsWith("}\nds_main </dev/null\n"));
    for (const l of text.split("\n")) {
      if (/docker'? '?(exec|run)'?\b.*\s'?-i'?(\s|$)/.test(l))
        assert.match(l, /<<'SQL'|<\s*\S/, `stdin-inheriting -i: ${l}`);
      if (/'docker' 'run'/.test(l))
        assert.match(l, /<\/dev\/null/, `docker run without </dev/null: ${l}`);
    }
  }
  assert.equal(
    remoteScript("true\n"),
    "ds_main() {\ntrue\n}\nds_main </dev/null\n",
  );
});

test("teardownScript: stops runs by label, guards the pidfile, leftovers mode is anchored", () => {
  const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
  const td = teardownScript({ brImage: IMG, scratch });
  assert.ok(td.includes(`--filter 'label=${RUN_LABEL}'`));
  assert.ok(td.includes('/proc/"$PID"/cmdline'));
  assert.ok(td.includes(`rm -f -- '${ENV_FILE}' '${PROOF_PID}'`));
  const left = teardownScript({});
  assert.ok(
    left.includes(
      '[[ "$d" =~ ^/var/lib/ds-platform/recovery-proof/ds-recovery-[0-9]{8}T[0-9]{6}Z$ ]] && rm -rf -- "$d"',
    ),
  );
  assert.ok(!left.includes("info-after"));
  const run = pgbackrestRun({ image: IMG, args: ["info"] });
  const i = run.indexOf("--label");
  assert.equal(run[i + 1], RUN_LABEL);
  run.splice(i, 2);
  assert.throws(() => assertSafeDockerRun(run, "pgbackrest"), /--label/);
});

test("teardownScript: docker filters are the exact name prefix and the full run label", () => {
  for (const td of [
    teardownScript({ brImage: IMG, scratch: scratchDir(new Date()) }),
    teardownScript({}),
  ]) {
    assert.ok(td.includes("--filter 'name=^/?ds-recovery-'"));
    assert.ok(td.includes(`--filter 'label=${RUN_LABEL}'`));
    assert.doesNotMatch(td, /--filter (name|label)=ds-recovery(\s|$)/m);
  }
});

function runTeardownUnderBash({ pidfile, cmdline }) {
  const root = mkdtempSync(join(tmpdir(), "dsr-td-")).replace(/\\/g, "/");
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const [name, body] of [
    ["docker", '#!/usr/bin/env bash\necho "$*" >> "$DSR_CALLS"\nexit 0\n'],
    ["sleep", "#!/usr/bin/env bash\nexit 0\n"],
  ]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const envDir = `${root}/run`;
  mkdirSync(envDir);
  writeFileSync(`${envDir}/proof.pid`, pidfile);
  mkdirSync(`${root}/proc/4242`, { recursive: true });
  writeFileSync(`${root}/proc/4242/cmdline`, cmdline);
  // `kill` is a builtin: the test swaps it for a recorded call against the fake /proc.
  const text = teardownScript({})
    .split(ENV_DIR)
    .join(envDir)
    .split("/proc/")
    .join(`${root}/proc/`)
    .split('kill -TERM "$PID"')
    .join('echo "TERM $PID" >> "$DSR_CALLS"')
    .split('kill -0 "$PID"')
    .join("false");
  const r = spawnSync("bash", ["-s"], {
    input: text,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      DSR_CALLS: `${root}/calls`,
    },
  });
  const calls = existsSync(`${root}/calls`)
    ? readFileSync(`${root}/calls`, "utf8")
    : "";
  return { r, envDir, signalled: calls.includes("TERM 4242") };
}

test(
  "teardownScript under bash -s: signals only the proof tagged with the pidfile's runid",
  { skip: !bashOk && "bash not available" },
  () => {
    const scratch = scratchDir(new Date("2026-11-04T10:00:00Z"));
    const mark = proofMarker(scratch);
    assert.equal(mark, "ds-recovery-proof-20261104T100000Z");
    const pidfile = `4242\n${mark}\n`;
    const own = runTeardownUnderBash({
      pidfile,
      cmdline: `bash\0-s\0${mark}\0`,
    });
    assert.equal(own.signalled, true, own.r.stderr);
    for (const cmdline of [
      "bash\0-s\0",
      "bash\0-s\0ds-recovery-proof-20261103T090000Z\0",
    ]) {
      const t = runTeardownUnderBash({ pidfile, cmdline });
      assert.equal(t.signalled, false, JSON.stringify(cmdline));
      assert.match(t.r.stderr, /not this tool's proof/);
      assert.equal(existsSync(`${t.envDir}/proof.pid`), false);
    }
    const bare = runTeardownUnderBash({
      pidfile: "4242\n",
      cmdline: "bash\0-s\0",
    });
    assert.equal(bare.signalled, false);
  },
);

// --- restore-proof orchestration through the injected runner ---------------------------

const INFO_JSON = JSON.stringify([
  {
    name: "ds",
    backup: [
      {
        label: "20261104-010000F",
        type: "full",
        archive: { start: "A", stop: "B" },
        info: { size: 1024 },
        backrest: { version: "2.56" },
      },
    ],
    archive: [{ max: "000000010000000000000099" }],
  },
]);
const STATE = JSON.stringify({ images: { postgres: IMG, pgbackrest: IMG } });
const AVAIL = String(100 * 1024 ** 3);
const at = (...l) => l.join("\n");

function proofHarness({
  failAt = null,
  leftovers = false,
  onProof = null,
} = {}) {
  const out = mkdtempSync(join(tmpdir(), "dsr-out-"));
  const steps = [];
  const printed = [];
  const exits = [];
  let handler = null;
  let released = false;
  const tar = tarOf([["data.env", "PGBACKREST_REPO1_CIPHER_PASS=topsecret\n"]]);
  const scripts = {
    facts: at(
      "@@DSR state",
      STATE,
      "@@DSR volumes",
      "ds-data-prod_pgdata",
      "ds-data-prod_pgsocket",
      "@@DSR running",
      `postgres ${IMG}`,
      `pgbackrest ${IMG}`,
      "@@DSR container",
      "@@DSR envdir",
      leftovers ? "present" : "",
      "@@DSR scratch",
      "@@DSR avail",
      failAt === "headroom" ? "1" : AVAIL,
      "@@DSR mem",
      String(4 * 1024 ** 2),
      "@@DSR end",
    ),
    info: at(
      "@@DSR info",
      INFO_JSON,
      "@@DSR info-rc",
      failAt === "info" ? "1" : "0",
      "@@DSR history",
      "00000001.history",
      "@@DSR history-rc",
      "0",
      "@@DSR end",
    ),
    proof: at(
      "@@DSR check",
      `WAL segment ${SEG} successfully archived`,
      "@@DSR check-rc",
      "0",
      "@@DSR seg",
      SEG,
      "@@DSR restore",
      "@@DSR restore-rc",
      "0",
      "@@DSR ready",
      "yes",
      "@@DSR seg-restored",
      `restored log file "${SEG}" from archive`,
      "@@DSR copy-log",
      "archive recovery complete",
      "redo done at 0/5000100",
      "@@DSR in-recovery",
      "f",
      "@@DSR version",
      "17.6",
      "@@DSR migrations",
      "42|2026-11-01",
      "@@DSR databases",
      "ds_prod",
      "zitadel",
      "@@DSR counts",
      "users|5",
      "posts|4",
      "tags|3",
      "@@DSR amcheck",
      "ok",
      "@@DSR end",
    ),
    teardown: at(
      "@@DSR ps",
      "@@DSR scratch",
      "removed",
      "@@DSR info-after",
      INFO_JSON,
      "@@DSR info-after-rc",
      "0",
      "@@DSR history-after",
      "00000001.history",
      "@@DSR history-after-rc",
      "0",
      "@@DSR env",
      "removed",
      "@@DSR end",
    ),
  };
  const ctx = {
    out,
    now: new Date("2026-11-04T10:00:00Z"),
    identityA: "AGE-SECRET-KEY-1A",
    targets: { api: (c) => ["api", c], data: (c) => ["data", c] },
    print: (l) => printed.push(l),
    onSignal: (fn) => ((handler = fn), () => (released = true)),
    exit: (code) => exits.push(code),
    run: async (c) => {
      if (c.cmd === "age") {
        steps.push("decrypt");
        return { code: 0, stdout: tar };
      }
      const label = c.label.startsWith("stage") ? "stage" : c.label;
      steps.push(label);
      if (label === "stage")
        return { code: failAt === "stage" ? 1 : 0, stdout: Buffer.alloc(0) };
      if (label === "proof") {
        if (onProof) await onProof(handler);
        if (failAt === "proof") return { code: 255, stdout: Buffer.alloc(0) };
      }
      return { code: 0, stdout: Buffer.from(`${scripts[label]}\n`) };
    },
  };
  return {
    ctx,
    steps,
    printed,
    exits,
    released: () => released,
    out,
    file: join(out, "ds-recovery-2026-11-04-data-prod.tar.age"),
  };
}

test("restoreProof: steps in order, PASS report written, signal handler released", async () => {
  const h = proofHarness();
  const r = await restoreProof(h.ctx, { bundle: h.file });
  assert.deepEqual(h.steps, [
    "decrypt",
    "facts",
    "stage",
    "info",
    "proof",
    "teardown",
  ]);
  assert.equal(r.verdict, "PASS");
  assert.equal(readdirSync(join(h.out, "reports")).length, 1);
  assert.ok(h.released());
  assert.ok(!h.printed.join("\n").includes("topsecret"));
});

for (const failAt of ["stage", "info", "headroom", "proof"]) {
  test(`restoreProof: a failure at ${failAt} still tears down exactly once`, async () => {
    const h = proofHarness({ failAt });
    await assert.rejects(restoreProof(h.ctx, { bundle: h.file }));
    assert.equal(h.steps.at(-1), "teardown");
    assert.equal(h.steps.filter((s) => s === "teardown").length, 1);
    assert.ok(h.released());
  });
}

test("restoreProof: a signal during the proof tears down once, then exits non-zero", async () => {
  const h = proofHarness({
    failAt: "proof",
    onProof: (handler) => handler("SIGINT"),
  });
  await assert.rejects(
    restoreProof(h.ctx, { bundle: h.file }),
    /did not complete/,
  );
  assert.equal(h.steps.filter((s) => s === "teardown").length, 1);
  assert.deepEqual(h.exits, [130]);
  assert.ok(h.printed.some((l) => /SIGINT: tearing down/.test(l)));
});

test("restoreProof: leftovers of a crashed run stop before staging and name the teardown command", async () => {
  const h = proofHarness({ leftovers: true });
  await assert.rejects(
    restoreProof(h.ctx, { bundle: h.file }),
    /leftovers.*envdir.*pnpm recovery teardown/,
  );
  assert.deepEqual(h.steps, ["decrypt", "facts"]);
});

test("restoreProof: an unclean teardown fails the proof and prints the manual teardown", async () => {
  const h = proofHarness();
  const run = h.ctx.run;
  h.ctx.run = async (c) => {
    const r = await run(c);
    if (c.label === "teardown")
      r.stdout = Buffer.from(
        r.stdout.toString().replace("@@DSR env\nremoved", "@@DSR env\npresent"),
      );
    return r;
  };
  const r = await restoreProof(h.ctx, { bundle: h.file });
  assert.equal(r.verdict, "FAIL");
  assert.ok(h.printed.some((l) => l.includes("pnpm recovery teardown")));
});

// --- bundle: custody B tested once ---------------------------------------------------

function bundleHarness({ isTTY = true } = {}) {
  const out = mkdtempSync(join(tmpdir(), "dsr-b-"));
  for (const n of ["identity-A.age", "A.pub", "B.pub"])
    writeFileSync(join(out, n), n === "B.pub" ? "age1bbb\n" : "x\n");
  const values = {
    ZITADEL_MASTERKEY: "zk",
    SIGN_IN_RECORD_KEY: "sk",
    AUDIT_IDENTIFIER_PEPPER: "ap",
    PGBACKREST_REPO1_CIPHER_PASS: "cp",
  };
  const tars = {
    api: tarOf([
      ["api.env", "SIGN_IN_RECORD_KEY=sk\nAUDIT_IDENTIFIER_PEPPER=ap\n"],
      ["zitadel.env", "ZITADEL_MASTERKEY=zk\n"],
    ]),
    data: tarOf([["data.env", "PGBACKREST_REPO1_CIPHER_PASS=cp\n"]]),
  };
  const prompts = [];
  const decrypts = [];
  let current = null;
  const ctx = {
    out,
    now: new Date("2026-11-04T10:00:00Z"),
    identityA: "AGE-SECRET-KEY-1A",
    isTTY,
    exists: existsSync,
    targets: { api: (c) => ["api", c], data: (c) => ["data", c] },
    print: () => {},
    readSecret: async (p) => (prompts.push(p), "AGE-SECRET-KEY-1B"),
    run: async (c) => {
      if (c.cmd === "ssh" && c.args[1].includes("tar -cf")) {
        current = c.args[0];
        return { code: 0, stdout: tars[current] };
      }
      if (c.cmd === "ssh") {
        const key = Object.keys(values).find((k) => c.args[1].includes(k));
        return {
          code: 0,
          stdout: Buffer.from(`${fingerprint(values[key])}  -\n`),
        };
      }
      if (c.cmd === "age-keygen")
        return { code: 0, stdout: Buffer.from("age1bbb\n") };
      if (c.args[0] === "-d") {
        decrypts.push(c.input.toString());
        return { code: 0, stdout: tars[current] };
      }
      return { code: 0, stdout: Buffer.alloc(0) };
    },
  };
  return { ctx, prompts, decrypts };
}

test("bundle: by default encrypts to A + B, asks for no B and decrypts with A only", async () => {
  const h = bundleHarness();
  const r = await bundle(h.ctx);
  assert.equal(r.fingerprints, "4/4");
  assert.deepEqual(h.prompts, []);
  assert.deepEqual(h.decrypts, ["AGE-SECRET-KEY-1A\n", "AGE-SECRET-KEY-1A\n"]);
});

test("bundle --test-b: test-decrypts with B; refuses without a TTY before any prompt", async () => {
  const h = bundleHarness();
  await bundle(h.ctx, { testB: true });
  assert.equal(h.prompts.length, 1);
  assert.equal(h.decrypts.filter((d) => d.includes("1B")).length, 2);
  const n = bundleHarness({ isTTY: false });
  await assert.rejects(bundle(n.ctx, { testB: true }), /interactive terminal/);
  assert.deepEqual(n.prompts, []);
});
