#!/usr/bin/env node
// `pnpm recovery` — owner-run automation of infra/deploy/RECOVERY.md §2 (recovery
// bundle) and §3 (restore proof), #3662. RECOVERY.md stays the reference and the
// manual fallback; every command here is a port of a command there.
//
// Runs on the owner's workstation only: `age` runs here, the hosts get nothing
// installed, and the ssh login is the owner's `breakglass` key (README → «SSH access
// model»). Secrets only pass through pipes and process memory, never the disk, a log
// or the report.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditedRunner } from "./pg18-rehearsal.mjs";
import { BREAKGLASS_API_PROD } from "./prod.mjs";
import { PROD_LIVE_TREE } from "./lib/remote.mjs";

// --- constants (RECOVERY.md §2–§3) --------------------------------------------

export const ENV_DIR = "/run/ds-recovery";
export const ENV_FILE = `${ENV_DIR}/restore.env`;
export const CONF = `${PROD_LIVE_TREE}/infra/deploy/compose/data-prod/pgbackrest/pgbackrest.conf`;
export const STATE_FILE = "/home/deploy/ds-platform-postgres-state.json"; // no-hardcoded-path-ok: the release guard's fixed state file on ds-data-prod, not on this machine
export const PGDATA_VOL = "ds-data-prod_pgdata";
export const PGSOCK_VOL = "ds-data-prod_pgsocket";
export const COPY = "ds-recovery-pg";
export const SCRATCH_ROOT = "/var/lib/ds-platform/recovery-proof";
export const RUN_LABEL = "ds-recovery=run";
export const PROOF_PID = `${ENV_DIR}/proof.pid`;
const LIMITS = [
  "--label",
  RUN_LABEL,
  "--memory",
  "768m",
  "--memory-swap",
  "768m",
  "--oom-score-adj",
  "1000",
];
const GiB = 1024 ** 3;
const EMPTY_SHA = createHash("sha256").update("").digest("hex");

export const EXPECTED_MEMBERS = Object.freeze({
  "api-prod": ["api.env", "zitadel.env"],
  "data-prod": ["data.env"],
});

// RECOVERY.md §1.2: the four keys a new value cannot replace.
export const IRREPLACEABLE = Object.freeze({
  "api-prod": [
    ["zitadel.env", "ZITADEL_MASTERKEY"],
    ["api.env", "SIGN_IN_RECORD_KEY"],
    ["api.env", "AUDIT_IDENTIFIER_PEPPER"],
  ],
  "data-prod": [["data.env", "PGBACKREST_REPO1_CIPHER_PASS"]],
});

const KNOWN_SECRET_KEYS = [
  "PGBACKREST_REPO1_CIPHER_PASS",
  "PGBACKREST_REPO1_S3_KEY",
  "PGBACKREST_REPO1_S3_KEY_SECRET",
  "POSTGRES_PASSWORD",
  "ZITADEL_MASTERKEY",
  "SIGN_IN_RECORD_KEY",
  "AUDIT_IDENTIFIER_PEPPER",
  "DATABASE_URL",
];

const COMMANDS = [
  "doctor",
  "init-keys",
  "bundle",
  "restore-proof",
  "all",
  "teardown",
];
const USAGE = `usage: pnpm recovery <${COMMANDS.join("|")}> [--out <dir>] [--bundle <data-prod bundle>] [--identity <ssh key>] [--test-b]`;

// --- args ---------------------------------------------------------------------

export function parseArgs(argv, { home = homedir() } = {}) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") throw new Error(USAGE);
  if (!COMMANDS.includes(cmd))
    throw new Error(`unknown command ${cmd}\n${USAGE}`);
  const out = {
    cmd,
    out: `${String(home).replace(/[\\/]+$/, "")}/ds-recovery`,
    bundle: null,
    identity: null,
    testB: false,
  };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--test-b") {
      out.testB = true;
      continue;
    }
    const [flag, inline] = rest[i].split(/=(.*)/s, 2);
    const key = {
      "--out": "out",
      "--bundle": "bundle",
      "--identity": "identity",
    }[flag];
    if (!key) throw new Error(`unknown flag ${rest[i]}\n${USAGE}`);
    const value = inline ?? rest[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} needs a value`);
    out[key] = value;
  }
  if (cmd === "restore-proof" && !out.bundle)
    throw new Error("restore-proof needs --bundle <data-prod bundle>");
  return out;
}

// --- ssh ----------------------------------------------------------------------

// The owner's `ds-api-prod` alias logs in as `deploy` (the CI user, forced command),
// so the user is always explicit. `-J` does not carry `-i` to the jump hop, hence a
// ProxyCommand when a key file is named.
export function sshTargets({ env = process.env, identity = null } = {}) {
  const api = env.DS_API_PROD_SSH || BREAKGLASS_API_PROD;
  const data =
    env.DS_DATA_PROD_SSH ||
    `breakglass@${env.DS_DATA_PROD_VPC_IP || "192.168.0.10"}`;
  for (const t of [api, data])
    if (!t.startsWith("breakglass@"))
      throw new Error(`ssh target ${t} must name breakglass@ explicitly`);
  const base = [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-o",
    "ConnectTimeout=20",
  ];
  const key = identity ? ["-i", identity, "-o", "IdentitiesOnly=yes"] : [];
  const hop = identity
    ? [
        "-o",
        `ProxyCommand=ssh -i "${identity}" -o IdentitiesOnly=yes -W %h:%p ${api}`,
      ]
    : ["-J", api];
  return {
    apiHost: api,
    dataHost: data,
    api: (cmd) => [...base, ...key, api, cmd],
    data: (cmd) => [...base, ...key, ...hop, data, cmd],
  };
}

// --- workstation files ----------------------------------------------------------

export function assertOutsideGitRepo(dir, { exists = existsSync } = {}) {
  let p = String(dir).replaceAll("\\", "/").replace(/\/+$/, "");
  for (;;) {
    if (exists(`${p}/.git`))
      throw new Error(`refusing ${dir}: it is inside a git repository (${p})`);
    const i = p.lastIndexOf("/");
    if (i < 0 || p === "") return;
    p = p.slice(0, i);
  }
}

export function assertNoOverwrite(dir, names, { exists = existsSync } = {}) {
  for (const n of names)
    if (exists(`${dir}/${n}`))
      throw new Error(`refusing to overwrite ${dir}/${n}`);
}

export function parseKeygen(text) {
  const identity = /^(AGE-SECRET-KEY-1[0-9A-Z]+)\s*$/m.exec(text)?.[1];
  const recipient = /^# public key: (age1[0-9a-z]+)\s*$/m.exec(text)?.[1];
  if (!identity || !recipient) throw new Error("unexpected age-keygen output");
  return { identity, recipient };
}

// --- tar + member gate ------------------------------------------------------------

export function parseTar(buf) {
  const members = [];
  let off = 0;
  let longName = null;
  const str = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) return members;
    if (!str(h.subarray(257, 263)).startsWith("ustar"))
      throw new Error("not a tar archive");
    const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = str(body);
      continue;
    }
    if (type === "x" || type === "g") {
      const path = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
      if (path && type === "x") longName = path;
      continue;
    }
    const name =
      longName ??
      (prefix
        ? `${prefix}/${str(h.subarray(0, 100))}`
        : str(h.subarray(0, 100)));
    longName = null;
    members.push({ name, type, data: Buffer.from(body) });
  }
  if (!members.length) throw new Error("not a tar archive");
  return members;
}

export function memberGate(host, names) {
  const fail = (reason) => ({
    ok: false,
    reason: `${host}: ${reason}`,
    extra: [],
  });
  if (!names.length) return fail("empty member list");
  if (new Set(names).size !== names.length) return fail("duplicate member");
  for (const n of names)
    if (!/^[A-Za-z0-9._-]+\.env$/.test(n))
      return fail(`unexpected member ${n}`);
  for (const m of EXPECTED_MEMBERS[host])
    if (!names.includes(m)) return fail(`no ${m}`);
  return {
    ok: true,
    reason: null,
    extra: names.filter((n) => !EXPECTED_MEMBERS[host].includes(n)),
  };
}

// --- fingerprints (RECOVERY.md §2.3) ----------------------------------------------

export function envValue(text, key) {
  return text
    .split("\n")
    .filter((l) => l.startsWith(`${key}=`))
    .map((l) => l.slice(key.length + 1))
    .join("")
    .replace(/[\r\n]/g, "");
}

export function envKeys(text) {
  return [
    ...new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])),
  ];
}

export function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintHostCommand(file, key) {
  return `sudo -n sh -c "sed -n 's/^${key}=//p' /etc/ds-platform/${file} | tr -d '\\r\\n' | sha256sum"`;
}

export function fingerprintVerdict(key, hostOutput, bundleHex) {
  const host = String(hostOutput).trim().split(/\s+/)[0];
  const ok =
    /^[0-9a-f]{64}$/.test(host) &&
    host !== EMPTY_SHA &&
    bundleHex !== EMPTY_SHA &&
    host === bundleHex;
  return `${ok ? "MATCH" : "MISMATCH"} ${key}`;
}

// --- docker run construction + invariants (RECOVERY.md §3.2) -----------------------

export function assertSafeDockerRun(argv, kind) {
  if (argv[0] !== "docker" || argv[1] !== "run")
    throw new Error("not a docker run");
  if (!argv.includes("--rm")) throw new Error("docker run without --rm");
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : argv[i + 1];
  };
  for (const a of argv) {
    if (/^(-p|-P|--publish|--publish-all)/.test(a))
      throw new Error(`publish forbidden: ${a}`);
    if (/^(--net|--network)(=|$)/.test(a)) {
      const v = a.includes("=") ? a.split("=")[1] : value(a);
      if (v !== "bridge")
        throw new Error(`network ${v} forbidden (only the default bridge)`);
    }
    if (a.includes("com.docker.compose.project"))
      throw new Error("must not join a compose project");
    if (a === "--privileged" || a.startsWith("--mount"))
      throw new Error(`${a} forbidden`);
  }
  if (value("--label") !== RUN_LABEL)
    throw new Error(
      `docker run without --label ${RUN_LABEL} (teardown finds runs by it)`,
    );
  const name = value("--name");
  if (name !== null && !name.startsWith("ds-recovery-"))
    throw new Error(`container name ${name} is not ds-recovery-*`);
  const envFile = value("--env-file");
  if (envFile !== null && envFile !== ENV_FILE)
    throw new Error(`env file must be ${ENV_FILE}`);
  argv.forEach((a, i) => {
    if (argv[i - 1] !== "-v" && argv[i - 1] !== "--volume") return;
    const source = a.split(":")[0];
    if (!source.startsWith("ds-data-prod_")) return;
    if (source === PGDATA_VOL) {
      if (!a.endsWith(":ro"))
        throw new Error(`${PGDATA_VOL} must be mounted read-only`);
    } else if (source === PGSOCK_VOL) {
      if (!(kind === "pgbackrest" && argv.includes("check")))
        throw new Error(`${PGSOCK_VOL} only for check`);
    } else
      throw new Error(
        `prod volume ${source} is mounted read-only or not at all`,
      );
  });
  if (kind === "pgbackrest") {
    if (value("--entrypoint") !== "pgbackrest")
      throw new Error("pgbackrest run needs --entrypoint pgbackrest");
    if (value("--user") !== "postgres")
      throw new Error("pgbackrest run needs --user postgres");
  } else if (kind === "copy") {
    if (name !== COPY) throw new Error(`the copy is named ${COPY}`);
    const c = argv.flatMap((a, i) => (argv[i - 1] === "-c" ? [a] : []));
    if (!c.includes("listen_addresses="))
      throw new Error("the copy needs listen_addresses=''");
    if (!c.includes("archive_mode=off"))
      throw new Error("the copy needs archive_mode=off");
  } else throw new Error(`unknown run kind ${kind}`);
  return argv;
}

export function scratchDir(at) {
  return `${SCRATCH_ROOT}/ds-recovery-${at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}`;
}

export function assertScratch(p) {
  if (
    !/^\/var\/lib\/ds-platform\/recovery-proof\/ds-recovery-\d{8}T\d{6}Z$/.test(
      p ?? "",
    )
  )
    throw new Error(`refusing scratch path ${p}`);
  return p;
}

export function pgbackrestRun({ image, check = false, scratch = null, args }) {
  const argv = ["docker", "run", "--rm", ...LIMITS, "--env-file", ENV_FILE];
  argv.push(
    "-v",
    `${CONF}:/etc/pgbackrest/pgbackrest.conf:ro`,
    "--user",
    "postgres",
    "--entrypoint",
    "pgbackrest",
  );
  if (check)
    argv.push(
      "-v",
      `${PGDATA_VOL}:/var/lib/postgresql/data:ro`,
      "-v",
      `${PGSOCK_VOL}:/var/run/postgresql`,
    );
  if (scratch)
    argv.push(
      "-v",
      `${assertScratch(scratch)}/pgdata:/var/lib/postgresql/data`,
    );
  argv.push(image, "--stanza=ds", "--log-level-file=off", ...args);
  return assertSafeDockerRun(argv, "pgbackrest");
}

export function copyRun({ image, scratch }) {
  const argv = [
    "docker",
    "run",
    "-d",
    "--rm",
    "--name",
    COPY,
    "--network",
    "bridge",
    ...LIMITS,
  ];
  argv.push(
    "--env-file",
    ENV_FILE,
    "-v",
    `${CONF}:/etc/pgbackrest/pgbackrest.conf:ro`,
  );
  argv.push(
    "-v",
    `${assertScratch(scratch)}/pgdata:/var/lib/postgresql/data`,
    image,
    "postgres",
  );
  argv.push(
    "-c",
    "listen_addresses=",
    "-c",
    "archive_mode=off",
    "-c",
    "shared_buffers=128MB",
    "-c",
    "max_connections=10",
  );
  return assertSafeDockerRun(argv, "copy");
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const noStdin = (argv) => `${argv.map(shq).join(" ")} </dev/null`;
const HISTORY = ["repo-ls", "--recurse", "--filter=\\.history$", "archive/ds"];

// --- remote scripts (run as `sudo -n bash -s` on ds-data-prod) ----------------------

// `bash -s` reads the script from ssh stdin while it runs, so an inner command that
// reads stdin (`docker exec -i`, `docker run -i`, `cat`) would swallow the rest of the
// script. The body is a function bash parses whole before running it, with stdin from
// /dev/null; a payload goes in through an explicit heredoc.
export const remoteScript = (body) =>
  `ds_main() {\n${body}}\nds_main </dev/null\n`;

export function factsScript({ scratch }) {
  assertScratch(scratch);
  const lbl = (v) =>
    `--filter label=com.docker.compose.project=ds-data-prod --filter label=com.docker.compose.volume=${v}`;
  return remoteScript(`set -u
echo "@@DSR state"; cat ${shq(STATE_FILE)}
echo "@@DSR volumes"; docker volume ls -q ${lbl("pgdata")}; docker volume ls -q ${lbl("pgsocket")}
echo "@@DSR running"
for s in postgres pgbackrest; do
  id=$(docker ps -q --filter label=com.docker.compose.project=ds-data-prod --filter "label=com.docker.compose.service=$s" | head -n 1)
  [ -n "$id" ] && echo "$s $(docker inspect -f '{{.Image}}' "$id")"
done
echo "@@DSR container"; docker ps -aq --filter name=ds-recovery
echo "@@DSR envdir"; [ -e ${shq(ENV_DIR)} ] && echo present
echo "@@DSR scratch"; [ -e ${shq(scratch)} ] && echo present; ls -d ${shq(SCRATCH_ROOT)}/ds-recovery-* 2>/dev/null
install -d -m 700 ${shq(SCRATCH_ROOT)}
echo "@@DSR avail"; df -B1 --output=avail ${shq(SCRATCH_ROOT)} | tail -n 1
echo "@@DSR mem"; awk '/^MemAvailable:/ {print $2}' /proc/meminfo
echo "@@DSR end"
`);
}

// The passphrase comes from the bundle (RECOVERY.md §3.1), staged on tmpfs only.
export const STAGE_COMMAND = `sudo -n sh -c '[ "$(stat -f -c %T /run)" = tmpfs ] && install -d -m 700 ${ENV_DIR} && umask 077 && cat > ${ENV_FILE}'`;

export function infoScript({ brImage }) {
  return remoteScript(`set -u
OUT=$(${noStdin(pgbackrestRun({ image: brImage, args: ["--output=json", "info"] }))} 2>/dev/null); RC=$?
echo "@@DSR info"; printf '%s\\n' "$OUT"; echo "@@DSR info-rc"; echo "$RC"
OUT=$(${noStdin(pgbackrestRun({ image: brImage, args: HISTORY }))} 2>/dev/null); RC=$?
echo "@@DSR history"; printf '%s\\n' "$OUT" | grep '\\.history$'; echo "@@DSR history-rc"; echo "$RC"
echo "@@DSR end"
`);
}

export function proofScript({ brImage, pgImage, scratch }) {
  assertScratch(scratch);
  const s = shq(scratch);
  const log = shq(`${scratch}/copy.log`);
  const check = pgbackrestRun({ image: brImage, check: true, args: ["check"] });
  const restore = pgbackrestRun({
    image: brImage,
    scratch,
    args: ["--type=default", "--archive-mode=off", "restore"],
  });
  const psql = `docker exec ${COPY} psql -X -U ds -d ds_prod -At`;
  const counts =
    "select format('select %L || ''|'' || count(*) from %I.%I', c.relname, n.nspname, c.relname) " +
    "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
    "where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.reltuples desc limit 3 \\gexec";
  // On a signal (Ctrl-C, ssh drop) the run is over: the staged env file goes too.
  // On a normal exit Node's teardown still needs it for the after-teardown stanza read.
  return remoteScript(`set -uo pipefail
LOGPID=
teardown() {
  docker stop ${COPY} >/dev/null 2>&1 </dev/null || true
  [ -n "$LOGPID" ] && kill "$LOGPID" 2>/dev/null
  rm -rf -- ${s}
  rm -f -- ${shq(PROOF_PID)}
}
on_signal() {
  rm -f -- ${shq(ENV_FILE)} ${shq(PROOF_PID)}; rmdir ${shq(ENV_DIR)} 2>/dev/null
  exit 1
}
trap teardown EXIT
trap on_signal INT TERM HUP PIPE
echo "$$" > ${shq(PROOF_PID)}
CHECK_OUT=$(${noStdin(check)} 2>&1); CHECK_RC=$?
echo "@@DSR check"; printf '%s\\n' "$CHECK_OUT" | grep -E 'WAL segment|ERROR|check command end'
echo "@@DSR check-rc"; echo "$CHECK_RC"
[ "$CHECK_RC" -eq 0 ] || exit 0
SEG=$(printf '%s\\n' "$CHECK_OUT" | grep -o 'WAL segment [0-9A-F]\\{24\\} successfully archived' | grep -o '[0-9A-F]\\{24\\}' | tail -n 1)
echo "@@DSR seg"; echo "$SEG"
[ -n "$SEG" ] || exit 0
install -d -o 999 -g 999 -m 700 ${shq(`${scratch}/pgdata`)}
echo "@@DSR restore"; ${noStdin(restore)} 2>&1 | grep -E 'ERROR|restore command end'
RESTORE_RC=\${PIPESTATUS[0]}
echo "@@DSR restore-rc"; echo "$RESTORE_RC"
[ "$RESTORE_RC" -eq 0 ] || exit 0
${noStdin(copyRun({ image: pgImage, scratch }))} >/dev/null || exit 0
docker logs -f ${COPY} > ${log} 2>&1 &
LOGPID=$!
READY=no
for _ in $(seq 1 720); do
  if grep -q 'database system is ready to accept connections' ${log}; then READY=yes; break; fi
  [ "$(docker inspect -f '{{.State.Running}}' ${COPY} 2>/dev/null)" = true ] || break
  sleep 5
done
echo "@@DSR ready"; echo "$READY"
echo "@@DSR seg-restored"; grep -F "restored log file \\"$SEG\\" from archive" ${log} | head -n 1
echo "@@DSR copy-log"
grep -E 'archive recovery complete|selected new timeline|ready to accept connections|redo done at|FATAL|PANIC' ${log} | tail -n 50
[ "$READY" = yes ] || exit 0
echo "@@DSR in-recovery"; ${psql} -c 'select pg_is_in_recovery()' </dev/null
echo "@@DSR version"; ${psql} -c 'show server_version' </dev/null
echo "@@DSR migrations"; ${psql} -c "select count(*) || '|' || coalesce(max(created_at)::text, '') from drizzle.__drizzle_migrations" </dev/null
echo "@@DSR databases"; ${psql} -c "select datname from pg_database where datname in ('ds_prod', 'zitadel') order by 1" </dev/null
echo "@@DSR counts"; docker exec -i ${COPY} psql -X -U ds -d ds_prod -At <<'SQL'
${counts}
SQL
echo "@@DSR amcheck"
if docker exec ${COPY} pg_amcheck -U ds -d ds_prod --install-missing -t 'drizzle.*' >/dev/null 2>&1 </dev/null; then echo ok; else echo failed; fi
echo "@@DSR end"
`);
}

// With `scratch` null it is `pnpm recovery teardown`: every namespaced leftover of a
// crashed run, each scratch path re-checked against the same anchored pattern.
export function teardownScript({ brImage = null, scratch = null }) {
  const scratchRm = scratch
    ? `rm -rf -- ${shq(assertScratch(scratch))}
echo "@@DSR scratch"; if [ -e ${shq(scratch)} ]; then echo present; else echo removed; fi`
    : `for d in ${shq(SCRATCH_ROOT)}/ds-recovery-*; do
  [[ "$d" =~ ^/var/lib/ds-platform/recovery-proof/ds-recovery-[0-9]{8}T[0-9]{6}Z$ ]] && rm -rf -- "$d"
done
echo "@@DSR scratch"; if ls -d ${shq(SCRATCH_ROOT)}/ds-recovery-* >/dev/null 2>&1; then echo present; else echo removed; fi`;
  const post = brImage
    ? `if [ -s ${shq(ENV_FILE)} ]; then
  OUT=$(${noStdin(pgbackrestRun({ image: brImage, args: ["--output=json", "info"] }))} 2>/dev/null); RC=$?
  echo "@@DSR info-after"; printf '%s\\n' "$OUT"; echo "@@DSR info-after-rc"; echo "$RC"
  OUT=$(${noStdin(pgbackrestRun({ image: brImage, args: HISTORY }))} 2>/dev/null); RC=$?
  echo "@@DSR history-after"; printf '%s\\n' "$OUT" | grep '\\.history$'; echo "@@DSR history-after-rc"; echo "$RC"
fi`
    : "";
  // A proof still running (Node interrupted, ssh dropped) is stopped first: its runs
  // are found by label, and its own trap then exits once the run in flight stops.
  const runs = `{ docker ps -q --filter label=${RUN_LABEL.split("=")[0]}; docker ps -q --filter name=ds-recovery; }`;
  return remoteScript(`set -u
PID=$(cat ${shq(PROOF_PID)} 2>/dev/null)
case "$PID" in ''|*[!0-9]*) PID= ;; esac
# Only the proof's own \`bash -s\`: a stale pidfile must never signal a reused PID.
[ -n "$PID" ] && [ "$(tr '\\0' ' ' < /proc/"$PID"/cmdline 2>/dev/null)" = "bash -s " ] || PID=
[ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null
for _ in $(seq 1 30); do
  IDS=$(${runs} | sort -u)
  [ -z "$IDS" ] && break
  docker stop $IDS >/dev/null 2>&1 || true
  sleep 1
done
for _ in $(seq 1 30); do [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null || break; sleep 1; done
echo "@@DSR ps"; docker ps -a --filter name=ds-recovery --format '{{.Names}}'; docker ps -a --filter label=${RUN_LABEL.split("=")[0]} --format '{{.Names}}'
${scratchRm}
${post}
rm -f -- ${shq(ENV_FILE)} ${shq(PROOF_PID)}; rmdir ${shq(ENV_DIR)} 2>/dev/null
echo "@@DSR env"; if [ -e ${shq(ENV_DIR)} ]; then echo present; else echo removed; fi
echo "@@DSR end"
`);
}

export const MANUAL_TEARDOWN = `Teardown did not complete. Run \`pnpm recovery teardown\`, or by hand on ds-data-prod (RECOVERY.md §3.4):
  sudo docker stop ds-recovery-pg; sudo docker ps -a --filter name=ds-recovery --filter label=ds-recovery
  sudo rm -rf /var/lib/ds-platform/recovery-proof/ds-recovery-*
  sudo rm -f /run/ds-recovery/restore.env /run/ds-recovery/proof.pid && sudo rmdir /run/ds-recovery`;

// --- parsing ------------------------------------------------------------------------

export function sections(stdout) {
  const out = {};
  let cur = null;
  for (const l of String(stdout).split("\n")) {
    const m = /^@@DSR (\S+)$/.exec(l.trimEnd());
    if (m) {
      cur = m[1];
      out[cur] = [];
    } else if (cur) out[cur].push(l.replace(/\r$/, ""));
  }
  for (const k of Object.keys(out)) out[k] = out[k].join("\n").trim();
  return out;
}

export function parseCheckSeg(text) {
  const all = [
    ...String(text).matchAll(
      /WAL segment ([0-9A-F]{24}) successfully archived/g,
    ),
  ];
  return all.length ? all.at(-1)[1] : null;
}

export function segRestored(logs, seg) {
  return (
    !!seg && String(logs).includes(`restored log file "${seg}" from archive`)
  );
}

export function parseRedoLsn(logs) {
  return /redo done at ([0-9A-F]+\/[0-9A-F]+)/.exec(String(logs))?.[1] ?? null;
}

export function parseInfo(json) {
  const stanza = JSON.parse(json).find((s) => s.name === "ds");
  const latest = stanza?.backup?.at(-1);
  const archive = stanza?.archive?.at(-1);
  if (!latest || !archive?.max) throw new Error("info: no backup of stanza ds");
  return {
    label: latest.label,
    type: latest.type,
    walStart: latest.archive?.start ?? null,
    walStop: latest.archive?.stop ?? null,
    dbBytes: Number(latest.info?.size ?? 0),
    timeline: archive.max.slice(0, 8),
  };
}

function backrestVersion(json) {
  return (
    JSON.parse(json)
      .find((s) => s.name === "ds")
      ?.backup?.at(-1)?.backrest?.version ?? "unknown"
  );
}

export function headroom({ availBytes, dbBytes, memAvailKiB }) {
  const needed = 1.5 * dbBytes + 2 * GiB;
  const ok = availBytes >= needed && memAvailKiB * 1024 >= GiB;
  return {
    ok,
    availGiB: (availBytes / GiB).toFixed(1),
    neededGiB: (needed / GiB).toFixed(1),
    memGiB: ((memAvailKiB * 1024) / GiB).toFixed(1),
  };
}

// RECOVERY.md §3.3. The WAL proof is the SEG line plus pg_is_in_recovery() = f: the
// recovery-complete line and `f` alone also appear when archive-get fails and the copy
// stops at the backup's own end, so neither is ever enough on its own.
export function proofVerdict(f) {
  const fail = [];
  if (!f.checkOk) fail.push("check did not complete");
  if (!f.seg) fail.push("no check segment (SEG)");
  if (f.restoreExit !== 0)
    fail.push(`restore exit ${f.restoreExit ?? "not run"}`);
  if (!f.timelineEqual) fail.push("prod stanza timeline changed or unverified");
  if (!f.historyEqual)
    fail.push("prod stanza .history files changed or unverified");
  if (!f.teardownClean) fail.push("teardown incomplete");
  if (fail.length) return { verdict: "FAIL", reasons: fail };
  const partial = [];
  if (!f.segRestored)
    partial.push(
      "SEG not restored from archive: recovery to the backup end only",
    );
  if (f.inRecovery !== "f")
    partial.push(`pg_is_in_recovery() = ${f.inRecovery ?? "unread"}`);
  if (!f.recoveryComplete) partial.push("no archive-recovery-complete line");
  if (!(f.migrations > 0)) partial.push("migration journal not readable");
  if (!["ds_prod", "zitadel"].every((d) => f.databases?.includes(d)))
    partial.push("ds_prod or zitadel missing");
  if (!(f.counts?.length === 3 && f.counts.every(([, n]) => n > 0)))
    partial.push("three non-zero table counts not shown");
  return partial.length
    ? { verdict: "PARTIAL", reasons: partial }
    : { verdict: "PASS", reasons: [] };
}

// --- report -------------------------------------------------------------------------

export function sanitizeReport(text, keyNames = []) {
  const keys = [...new Set([...KNOWN_SECRET_KEYS, ...keyNames])];
  const bad = [];
  String(text)
    .split("\n")
    .forEach((l, i) => {
      const s = l.replace(/sha256:[0-9a-f]{12,64}\b/g, "sha256:<fp>");
      if (
        keys.some((k) => new RegExp(`\\b${k}\\s*=`).test(l)) ||
        /\b[A-Z][A-Z0-9_]{2,}\s*=/.test(s) ||
        /[A-Za-z0-9+/]{32,}/.test(s)
      )
        bad.push(i + 1);
    });
  if (bad.length)
    throw new Error(
      `report refused: secret-shaped content on line ${bad.join(", ")}`,
    );
  return text;
}

const yn = (b) => (b ? "yes" : "no");
const shortImage = (img) =>
  String(img).startsWith("sha256:")
    ? String(img).slice(0, 19)
    : String(img).slice(0, 12);

export function renderReport(f) {
  const at = f.at.toISOString().replace("T", " ").slice(0, 16);
  const counts =
    (f.counts ?? []).map(([t, n]) => `${t}=${n}`).join(", ") || "none";
  const v = f.verdict;
  return [
    `Restore proof — ${at} UTC — ds-data-prod — owner-run over breakglass (pnpm recovery)`,
    `Passphrase source: recovery bundle ${f.bundleDate} (custody A); key fingerprints matched: ${f.fingerprints}`,
    `Backup point: label ${f.info?.label}, type ${f.info?.type}, WAL range ${f.info?.walStart}–${f.info?.walStop}`,
    `Versions: pgBackRest ${f.versions?.pgbackrest}; PostgreSQL ${f.versions?.postgres}`,
    `Images: postgres ${shortImage(f.images?.postgres)}, pgbackrest ${shortImage(f.images?.pgbackrest)}; equal to state file \`images\`: ${yn(f.images?.equal)}`,
    `Headroom: free ${f.headroom?.availGiB} GiB vs needed ${f.headroom?.neededGiB} GiB; MemAvailable ${f.headroom?.memGiB} GiB`,
    `WAL proof: check segment SEG ${f.seg ?? "none"}; restored from archive ${yn(f.segRestored)}; redo done at ${f.redo ?? "n/a"}`,
    `Checks: check ${f.checkOk ? "ok" : "failed"}; restore exit ${f.restoreExit ?? "not run"}; recovery complete ${yn(f.recoveryComplete)}; pg_is_in_recovery ${f.inRecovery ?? "unread"};`,
    `  drizzle migrations ${f.migrations ?? "unread"} / ${f.migrationsMax ?? "unread"}; databases ds_prod + zitadel ${yn(["ds_prod", "zitadel"].every((d) => f.databases?.includes(d)))};`,
    `  counts ${counts}; pg_amcheck ${f.amcheck ?? "skipped"}`,
    `Teardown: container gone, scratch removed, /run env removed: ${yn(f.teardownClean)}`,
    `Prod stanza after teardown: timeline ${f.timeline?.[0]}/${f.timeline?.[1]} equal ${yn(f.timelineEqual)}; .history files ${f.history?.[0]}/${f.history?.[1]} equal ${yn(f.historyEqual)}`,
    `Limitations: fresh-host DR drill not run (#3671)`,
    `Verdict: ${v.verdict}${v.reasons.length ? ` (${v.reasons.join("; ")})` : ""}`,
  ].join("\n");
}

// --- bundle (RECOVERY.md §2.2–§2.3) -----------------------------------------------------

export function bundleName(host, at) {
  return `ds-recovery-${at.toISOString().slice(0, 10)}-${host}.tar.age`;
}

const TAR_COMMAND =
  "sudo -n sh -c 'set -e; cd /etc/ds-platform && tar -cf - *.env'";

export async function buildBundle({
  host,
  file,
  ssh,
  recipients,
  identities,
  run,
  remove,
  print,
}) {
  const src = await run({ cmd: "ssh", args: ssh(TAR_COMMAND) });
  if (src.code !== 0 || !src.stdout?.length)
    throw new Error(`FAIL ${host}: tar over ssh exited ${src.code}`);
  const wipe = [src.stdout];
  try {
    const enc = await run({
      cmd: "age",
      args: ["-R", recipients[0], "-R", recipients[1], "-o", file],
      input: src.stdout,
    });
    if (enc.code !== 0)
      throw new Error(`FAIL ${host}: age encrypt exited ${enc.code}`);
    // B is test-decrypted only when it is given (`bundle --test-b`, once before the
    // paper is sealed); every bundle is still encrypted to both recipients.
    const listed = {};
    for (const who of ["A", "B"].filter((w) => identities[w])) {
      const dec = await run({
        cmd: "age",
        args: ["-d", "-i", "-", file],
        input: Buffer.from(`${identities[who]}\n`),
      });
      if (dec.code !== 0)
        throw new Error(`FAIL ${file}: does not open with custody ${who}`);
      wipe.push(dec.stdout);
      listed[who] = parseTar(dec.stdout);
      for (const m of listed[who]) wipe.push(m.data);
    }
    const names = listed.A.map((m) => m.name);
    const gate = memberGate(host, names);
    if (!gate.ok) throw new Error(`FAIL ${file}: ${gate.reason}`);
    if (listed.B && listed.B.map((m) => m.name).join("\n") !== names.join("\n"))
      throw new Error(`FAIL ${file}: custody B lists other members than A`);
    let matched = 0;
    for (const [member, key] of IRREPLACEABLE[host]) {
      const value = envValue(
        listed.A.find((m) => m.name === member).data.toString("utf8"),
        key,
      );
      const hostOut = await run({
        cmd: "ssh",
        args: ssh(fingerprintHostCommand(member, key)),
      });
      const verdict = fingerprintVerdict(
        key,
        hostOut.code === 0 ? hostOut.stdout.toString() : "",
        fingerprint(value),
      );
      print(verdict);
      if (verdict.startsWith("MISMATCH"))
        throw new Error(`FAIL ${host}: ${verdict}`);
      matched++;
    }
    print(`OK ${file}: ${names.join(", ")}`);
    return { members: names, extra: gate.extra, matched };
  } catch (err) {
    remove(file);
    throw err;
  } finally {
    for (const b of wipe) b?.fill?.(0);
  }
}

// --- process plumbing ----------------------------------------------------------------------

// Binary-safe: stdout is always a pipe collected as a Buffer; stdin is the input
// buffer when given, else the console (`tty`, for age's passphrase prompts, which age
// reads from the console itself) or closed.
export function spawnRun(spec) {
  return new Promise((done) => {
    const stdin =
      spec.input !== undefined ? "pipe" : spec.tty ? "inherit" : "ignore";
    const child = spawn(spec.cmd, spec.args, {
      stdio: [stdin, "pipe", spec.stderr ?? "inherit"],
    });
    const chunks = [];
    const errs = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr?.on("data", (c) => errs.push(c));
    child.on("error", (e) =>
      done({
        code: e.code ?? "ERROR",
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      }),
    );
    child.on("close", (code) =>
      done({
        code,
        stdout: Buffer.concat(chunks),
        stderr: Buffer.concat(errs),
      }),
    );
    // A child that exits before draining its input (EPIPE) is judged by its exit
    // code; an unhandled stream error would kill Node before any teardown.
    child.stdin?.on("error", () => {});
    child.stdout.on("error", () => {});
    if (spec.input !== undefined) child.stdin.end(spec.input);
  });
}

function readSecretLine(prompt) {
  return new Promise((done, fail) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin });
      rl.once("line", (l) => (rl.close(), done(l)));
      rl.once("close", () => done(""));
      return;
    }
    let buf = "";
    const stop = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (s) => {
      for (const ch of String(s)) {
        if (ch === "\u0003") return (stop(), fail(new Error("aborted")));
        if (ch === "\r" || ch === "\n") return (stop(), done(buf));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

const stamp = (at) =>
  at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

function context(opts) {
  const out = resolve(opts.out);
  const targets = sshTargets({ identity: opts.identity });
  const now = new Date();
  let log = null;
  const audit = ({ at, command }) => {
    if (!log) {
      mkdirSync(`${out}/logs`, { recursive: true });
      log = `${out}/logs/${stamp(now)}.log`;
    }
    // Command lines only: stdin (scripts, identities, env files) is never written.
    appendFileSync(
      log,
      `${at} ${[command.cmd, ...command.args].join(" ")}${command.label ? `  # ${command.label}` : ""}\n`,
    );
  };
  return {
    out,
    targets,
    now,
    run: auditedRunner({ audit, execute: (spec) => spawnRun(spec) }),
    print: (l) => console.log(l),
    readSecret: readSecretLine,
    exists: existsSync,
    identityA: null,
    isTTY: !!(process.stdin.isTTY && process.stdout.isTTY),
    onSignal: (fn) => {
      const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
      for (const s of signals) process.on(s, fn);
      return () => signals.forEach((s) => process.off(s, fn));
    },
    exit: (code) => process.exit(code),
  };
}

async function derive(ctx, identity) {
  const r = await ctx.run({
    cmd: "age-keygen",
    args: ["-y"],
    input: Buffer.from(`${identity}\n`),
    stderr: "pipe",
  });
  if (r.code !== 0)
    throw new Error("age-keygen -y could not read the identity");
  return r.stdout.toString().trim();
}

const normalizeIdentity = (s) => String(s).replace(/\s+/g, "").toUpperCase();

async function unlockA(ctx) {
  if (ctx.identityA) return ctx.identityA;
  ctx.print("Custody A: age asks for the passphrase of identity-A.age.");
  const r = await ctx.run({
    cmd: "age",
    args: ["-d", `${ctx.out}/identity-A.age`],
    tty: true,
  });
  if (r.code !== 0) throw new Error("identity-A.age did not open");
  const { identity } = parseKeygen(r.stdout.toString());
  r.stdout.fill(0);
  if (
    (await derive(ctx, identity)) !==
    readFileSync(`${ctx.out}/A.pub`, "utf8").trim()
  )
    throw new Error("identity-A.age does not match A.pub");
  ctx.identityA = identity;
  return identity;
}

async function readB(ctx) {
  const typed = normalizeIdentity(
    await ctx.readSecret(
      "Custody B — type the paper copy (input hidden), Enter: ",
    ),
  );
  if (!typed.startsWith("AGE-SECRET-KEY-1"))
    throw new Error("custody B: not an age identity");
  if (
    (await derive(ctx, typed)) !==
    readFileSync(`${ctx.out}/B.pub`, "utf8").trim()
  )
    throw new Error(
      "custody B: the typed identity does not match B.pub (mis-transcribed?)",
    );
  return typed;
}

// --- subcommands ---------------------------------------------------------------------------

async function doctor(ctx) {
  const results = [];
  const note = (ok, what) => (
    results.push(ok),
    ctx.print(`${ok ? "OK  " : "FAIL"} ${what}`)
  );
  for (const [bin, args] of [
    ["age", ["--version"]],
    ["age-keygen", ["--version"]],
    ["ssh", ["-V"]],
  ]) {
    const r = await ctx.run({ cmd: bin, args, stderr: "pipe" });
    note(
      r.code === 0,
      r.code === "ENOENT"
        ? `${bin}: not on PATH${bin.startsWith("age") ? " — winget install FiloSottile.age" : ""}`
        : `${bin} ${Buffer.concat([r.stdout, r.stderr ?? Buffer.alloc(0)])
            .toString()
            .trim()}`,
    );
  }
  for (const [label, args] of [
    ["ds-api-prod", ctx.targets.api("sudo -n true")],
    ["ds-data-prod", ctx.targets.data("sudo -n true")],
  ]) {
    const r = await ctx.run({ cmd: "ssh", args });
    note(
      r.code === 0,
      `${label}: breakglass sudo -n (${r.code === 0 ? "reachable" : `exit ${r.code}`})`,
    );
  }
  try {
    assertOutsideGitRepo(ctx.out, { exists: ctx.exists });
    mkdirSync(ctx.out, { recursive: true });
    const probe = `${ctx.out}/.doctor-probe`;
    writeFileSync(probe, "");
    rmSync(probe);
    const have = ["identity-A.age", "A.pub", "B.pub"].filter((n) =>
      ctx.exists(`${ctx.out}/${n}`),
    );
    note(
      true,
      `out dir ${ctx.out} writable, outside git; present: ${have.join(", ") || "no keys yet (run init-keys)"}`,
    );
  } catch (err) {
    note(false, `out dir: ${err.message}`);
  }
  const df = await ctx.run({
    cmd: "ssh",
    args: ctx.targets.data(
      "df -B1 --output=avail /var/lib/ds-platform | tail -n 1",
    ),
  });
  const avail = Number(df.stdout.toString().trim());
  note(
    df.code === 0 && avail > 2 * GiB,
    `ds-data-prod free under /var/lib/ds-platform: ${(avail / GiB).toFixed(1)} GiB (restore-proof checks 1.5 x db + 2 GiB)`,
  );
  if (results.includes(false)) throw new Error("doctor: FAIL");
}

export async function initKeys(d) {
  const { out, exists } = d;
  assertOutsideGitRepo(out, { exists });
  assertNoOverwrite(out, ["B.pub"], { exists });
  const haveA = exists(`${out}/identity-A.age`) && exists(`${out}/A.pub`);
  if (!haveA) assertNoOverwrite(out, ["identity-A.age", "A.pub"], { exists });
  if (!d.isTTY)
    throw new Error(
      "init-keys needs an interactive terminal (Windows Terminal, or winpty bash)",
    );
  d.mkdir(out);
  const keygen = async () => {
    const r = await d.run({ cmd: "age-keygen", args: [], stderr: "pipe" });
    if (r.code !== 0)
      throw new Error(
        `age-keygen exited ${r.code}${r.code === "ENOENT" ? " — winget install FiloSottile.age" : ""}`,
      );
    return r.stdout;
  };
  const derive1 = async (text) => {
    const r = await d.run({
      cmd: "age-keygen",
      args: ["-y"],
      input: Buffer.from(`${text}\n`),
      stderr: "pipe",
    });
    if (r.code !== 0)
      throw new Error("age-keygen -y could not read the identity");
    return r.stdout.toString().trim();
  };
  if (haveA)
    d.print(
      "Custody A exists (identity-A.age + A.pub): keeping it, creating custody B only.",
    );
  else {
    const raw = await keygen();
    const a = parseKeygen(raw.toString());
    const partial = `${out}/identity-A.age.partial`;
    d.remove(partial);
    d.print(
      "Custody A: age asks for a new passphrase (twice). Put it in the password manager.",
    );
    const enc = await d.run({
      cmd: "age",
      args: ["-p", "-o", partial],
      input: raw,
    });
    raw.fill(0);
    if (enc.code !== 0)
      throw (d.remove(partial), new Error(`age -p exited ${enc.code}`));
    d.print(
      "Custody A: re-open it once with the same passphrase to prove the file.",
    );
    const dec = await d.run({ cmd: "age", args: ["-d", partial], tty: true });
    const ok =
      dec.code === 0 &&
      (await derive1(parseKeygen(dec.stdout.toString()).identity)) ===
        a.recipient;
    dec.stdout.fill(0);
    if (!ok)
      throw (
        d.remove(partial),
        new Error("identity-A.age did not reopen to the generated recipient")
      );
    d.rename(partial, `${out}/identity-A.age`);
    d.writeFile(`${out}/A.pub`, `${a.recipient}\n`);
    d.print(`OK custody A: ${out}/identity-A.age, ${out}/A.pub`);
  }
  const rawB = await keygen();
  const b = parseKeygen(rawB.toString());
  rawB.fill(0);
  d.print(
    "\nCustody B — copy this line onto paper by hand. It is shown once and never written to disk:\n",
  );
  d.print(`    ${b.identity}\n`);
  await d.readSecret(
    "Press Enter when it is on paper (the screen is then cleared) ",
  );
  d.print("\x1b[2J\x1b[3J\x1b[H");
  for (let attempt = 1; ; attempt++) {
    const typed = normalizeIdentity(
      await d.readSecret(
        "Custody B — type the paper copy back (input hidden), Enter: ",
      ),
    );
    if (typed === b.identity && (await derive1(typed)) === b.recipient) break;
    if (attempt === 3)
      throw new Error(
        "custody B: the paper copy did not match three times; nothing written for B — run init-keys again",
      );
    d.print(
      "Does not match the generated identity — check the paper and type it again.",
    );
  }
  d.writeFile(`${out}/B.pub`, `${b.recipient}\n`);
  d.print(`OK custody B: ${out}/B.pub
Next: store identity-A.age (attachment) and its passphrase in the password manager entry;
keep paper B UNSEALED: the first bundle must be built with \`pnpm recovery bundle --test-b\`,
which test-decrypts with it; seal it only after that. Later bundles need no B.
Clear the terminal scroll-back now.`);
}

export async function bundle(ctx, { testB = false } = {}) {
  for (const n of ["identity-A.age", "A.pub", "B.pub"])
    if (!ctx.exists(`${ctx.out}/${n}`))
      throw new Error(`missing ${ctx.out}/${n} — run init-keys first`);
  // Without a real console the hidden prompt falls back to a line read, which echoes B.
  if (testB && !ctx.isTTY)
    throw new Error(
      "bundle --test-b needs an interactive terminal (Windows Terminal, or winpty bash): B would be echoed",
    );
  const identities = { A: await unlockA(ctx) };
  if (testB) identities.B = await readB(ctx);
  const recipients = [`${ctx.out}/A.pub`, `${ctx.out}/B.pub`];
  let matched = 0;
  const files = {};
  for (const [host, ssh] of [
    ["api-prod", ctx.targets.api],
    ["data-prod", ctx.targets.data],
  ]) {
    files[host] = `${ctx.out}/${bundleName(host, ctx.now)}`;
    if (ctx.exists(files[host]))
      throw new Error(`refusing to overwrite ${files[host]}`);
    const r = await buildBundle({
      host,
      file: files[host],
      ssh,
      recipients,
      identities,
      run: ctx.run,
      remove: (f) => rmSync(f, { force: true }),
      print: ctx.print,
    });
    matched += r.matched;
    if (r.extra.length) ctx.print(`  also in ${host}: ${r.extra.join(", ")}`);
  }
  ctx.print(`Fingerprints: ${matched}/4 MATCH. ${
    testB
      ? "Custody B test decrypt: OK — seal paper B and hand it to the second custodian."
      : "Encrypted to A.pub + B.pub; custody B not test-decrypted in this run (proven once by `bundle --test-b`)."
  }
Store both bundles in two places independent of both hosts (RECOVERY.md §2.4); never next to identity A or paper B.`);
  return { dataBundle: files["data-prod"], fingerprints: `${matched}/4` };
}

export async function restoreProof(
  ctx,
  {
    bundle: file,
    fingerprints = "not re-checked in this run (see the bundle run)",
  },
) {
  if (!/data-prod\.tar\.age$/.test(file))
    throw new Error("restore-proof needs the data-prod bundle");
  const idA = await unlockA(ctx);
  const dec = await ctx.run({
    cmd: "age",
    args: ["-d", "-i", "-", resolve(file)],
    input: Buffer.from(`${idA}\n`),
  });
  if (dec.code !== 0) throw new Error(`${file} does not open with custody A`);
  const members = parseTar(dec.stdout);
  const gate = memberGate(
    "data-prod",
    members.map((m) => m.name),
  );
  if (!gate.ok) throw new Error(`FAIL ${file}: ${gate.reason}`);
  const dataEnv = members.find((m) => m.name === "data.env").data;
  const keyNames = envKeys(dataEnv.toString("utf8"));
  dec.stdout.fill(0);
  const scratch = scratchDir(ctx.now);
  const script = async (label, text) => {
    const r = await ctx.run({
      cmd: "ssh",
      args: ctx.targets.data("sudo -n bash -s"),
      input: Buffer.from(text),
      label,
    });
    const sec = sections(r.stdout.toString());
    if (!("end" in sec))
      throw new Error(`${label} script did not complete (exit ${r.code})`);
    return sec;
  };

  const facts = await script("facts", factsScript({ scratch }));
  const left = ["container", "envdir", "scratch"].filter((k) =>
    (facts[k] ?? "").trim(),
  );
  if (left.length)
    throw new Error(
      `STOP: leftovers of an earlier run on ds-data-prod (${left.join(", ")}) — run \`pnpm recovery teardown\` first`,
    );
  if (facts.volumes !== `${PGDATA_VOL}\n${PGSOCK_VOL}`)
    throw new Error(
      `STOP: volumes are not exactly ${PGDATA_VOL} / ${PGSOCK_VOL}`,
    );
  const state = JSON.parse(facts.state);
  const pgImage = state.images?.postgres;
  const brImage = state.images?.pgbackrest;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(pgImage ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(brImage ?? "")
  )
    throw new Error("state file has no recorded postgres/pgbackrest image ids");
  const running = Object.fromEntries(
    facts.running
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")),
  );
  const images = {
    postgres: pgImage,
    pgbackrest: brImage,
    equal: running.postgres === pgImage && running.pgbackrest === brImage,
  };

  let before;
  let proof;
  let room;
  let td;
  // One teardown per run, shared by the `finally` and a signal handler, so a Ctrl-C
  // or a dropped ssh still clears the copy, the scratch and the staged env file.
  let tdOnce = null;
  const teardown = () =>
    (tdOnce ??= script("teardown", teardownScript({ brImage, scratch })).then(
      (t) => (teardownClean(t) || ctx.print(MANUAL_TEARDOWN), t),
      (err) => {
        ctx.print(MANUAL_TEARDOWN);
        throw err;
      },
    ));
  let aborted = false;
  const release = ctx.onSignal(async (signal) => {
    if (aborted) return;
    aborted = true;
    ctx.print(`\n${signal}: tearing down on ds-data-prod before exit`);
    await teardown().catch(() => {});
    ctx.exit(130);
  });
  try {
    const st = await ctx.run({
      cmd: "ssh",
      args: ctx.targets.data(STAGE_COMMAND),
      input: dataEnv,
      label: "stage data.env on tmpfs",
    });
    dataEnv.fill(0);
    if (st.code !== 0)
      throw new Error(`staging data.env on tmpfs failed (exit ${st.code})`);
    before = await script("info", infoScript({ brImage }));
    if (before["info-rc"] !== "0")
      throw new Error("pgbackrest info failed with the bundle passphrase");
    const info = parseInfo(before.info);
    room = headroom({
      availBytes: Number(facts.avail),
      dbBytes: info.dbBytes,
      memAvailKiB: Number(facts.mem),
    });
    if (!room.ok)
      throw new Error(
        `STOP: headroom free ${room.availGiB} GiB vs needed ${room.neededGiB} GiB, MemAvailable ${room.memGiB} GiB`,
      );
    ctx.print(
      "Restore proof running on ds-data-prod (check → restore → WAL replay); this can take a while.",
    );
    proof = await script("proof", proofScript({ brImage, pgImage, scratch }));
  } finally {
    try {
      td = await teardown();
    } finally {
      release();
    }
  }

  const info = parseInfo(before.info);
  let after;
  try {
    after = td["info-after-rc"] === "0" ? parseInfo(td["info-after"]) : null;
  } catch {
    after = null;
  }
  const histBefore =
    before["history-rc"] === "0"
      ? before.history.split("\n").filter(Boolean).length
      : null;
  const histAfter =
    td["history-after-rc"] === "0"
      ? td["history-after"].split("\n").filter(Boolean).length
      : null;
  const copyLog = `${proof["seg-restored"] ?? ""}\n${proof["copy-log"] ?? ""}`;
  const seg = parseCheckSeg(proof.check ?? "");
  const [migrations, migrationsMax] = (proof.migrations ?? "").split("|");
  const facts2 = {
    checkOk: proof["check-rc"] === "0",
    seg,
    restoreExit:
      proof["restore-rc"] === undefined ? null : Number(proof["restore-rc"]),
    segRestored: segRestored(copyLog, seg),
    recoveryComplete: /archive recovery complete/.test(copyLog),
    inRecovery: proof["in-recovery"] || null,
    migrations: Number(migrations) || 0,
    migrationsMax: migrationsMax || null,
    databases: (proof.databases ?? "").split("\n").filter(Boolean),
    counts: (proof.counts ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.split("|")[0], Number(l.split("|")[1])]),
    timelineEqual: !!after && after.timeline === info.timeline,
    historyEqual: histBefore !== null && histAfter === histBefore,
    teardownClean: teardownClean(td),
  };
  const report = sanitizeReport(
    renderReport({
      at: ctx.now,
      bundleDate:
        /ds-recovery-(\d{4}-\d{2}-\d{2})-/.exec(file)?.[1] ?? "unknown",
      fingerprints,
      info,
      versions: {
        pgbackrest: backrestVersion(before.info),
        postgres: /^\d+(\.\d+)?/.exec(proof.version ?? "")?.[0] ?? "unread",
      },
      images,
      headroom: room,
      ...facts2,
      redo: parseRedoLsn(copyLog),
      amcheck: proof.amcheck || "skipped",
      timeline: [info.timeline, after?.timeline ?? "unread"],
      history: [histBefore ?? "unread", histAfter ?? "unread"],
      verdict: proofVerdict(facts2),
    }),
    keyNames,
  );
  mkdirSync(`${ctx.out}/reports`, { recursive: true });
  const path = `${ctx.out}/reports/restore-proof-${stamp(ctx.now)}.md`;
  writeFileSync(path, `${report}\n`);
  ctx.print(`\n${report}\n\nReport: ${path} (sanitised; post it to #3662)`);
  return { verdict: proofVerdict(facts2).verdict, report: path };
}

const teardownClean = (td) =>
  td.ps === "" && td.scratch === "removed" && td.env === "removed";

async function teardownLeftovers(ctx) {
  const r = await ctx.run({
    cmd: "ssh",
    args: ctx.targets.data("sudo -n bash -s"),
    input: Buffer.from(teardownScript({})),
    label: "teardown leftovers",
  });
  const td = sections(r.stdout.toString());
  const ok = "end" in td && teardownClean(td);
  ctx.print(
    ok
      ? "OK ds-data-prod: no ds-recovery container, scratch directory or staged env file left"
      : `FAIL ds-data-prod: containers [${td.ps ?? "unread"}], scratch ${td.scratch ?? "unread"}, env ${td.env ?? "unread"}\n${MANUAL_TEARDOWN}`,
  );
  if (!ok) throw new Error("teardown: FAIL");
}

async function main(argv) {
  const opts = parseArgs(argv);
  const ctx = context(opts);
  if (opts.cmd === "doctor") return doctor(ctx);
  if (opts.cmd === "init-keys")
    return initKeys({
      out: ctx.out,
      exists: existsSync,
      run: ctx.run,
      mkdir: (p) => mkdirSync(p, { recursive: true }),
      writeFile: (p, s) => writeFileSync(p, s),
      rename: renameSync,
      remove: (p) => rmSync(p, { force: true }),
      readSecret: readSecretLine,
      print: ctx.print,
      isTTY: ctx.isTTY,
    });
  if (opts.cmd === "teardown") return teardownLeftovers(ctx);
  if (opts.cmd === "bundle") return bundle(ctx, { testB: opts.testB });
  let proof;
  if (opts.cmd === "restore-proof")
    proof = await restoreProof(ctx, { bundle: opts.bundle });
  else {
    await doctor(ctx);
    const b = await bundle(ctx, { testB: opts.testB });
    proof = await restoreProof(ctx, {
      bundle: b.dataBundle,
      fingerprints: b.fingerprints,
    });
  }
  if (proof.verdict !== "PASS") process.exitCode = 1;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (
  invoked &&
  invoked === resolve(fileURLToPath(import.meta.url)) &&
  import.meta.url === pathToFileURL(invoked).href
) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
