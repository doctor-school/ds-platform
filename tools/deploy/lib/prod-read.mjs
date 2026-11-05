// tools/deploy/lib/prod-read.mjs — the runner side and the operator side of the prod
// read path (Issue #3646; spec
// apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §4
// «Prod read results leave only encrypted.», §5 «Prod read verbs.», §10 «Owner
// action: the read key»).
//
// Runner side (`.github/workflows/prod-observe.yml`): the inputs' shape, the
// `capabilities` check and the status lines. Node builtins only — the job installs
// nothing. Operator side (`pnpm prod:read`, `prod:schema-drift`, `prod:read-key`,
// `prod:read-result-key`): every external command goes through the injected `run`,
// so the tests stub `gh` and keep the real `openssl`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const READ_VERBS = [
  "schema",
  "observe",
  "rehearse",
  "rehearse-restore",
  "rehearsal-status",
];
/** #3648: the verbs whose answer carries a rehearsal state word. */
export const REHEARSAL_VERBS = [
  "rehearse",
  "rehearse-restore",
  "rehearsal-status",
];
// The fixed failure reasons of a read (exit 1): ds-read-entrypoint READ_REASONS.
export const READ_REASONS = [
  "a release step is running",
  "a rehearsal is running",
  "the read-only transaction check failed",
  "the read timed out",
  "insufficient headroom (disk)",
  "insufficient headroom (memory)",
  "copy behind prod",
  "archive check failed",
  "the read failed",
];
export const BOX_TAG = "ds-read-entrypoint";
export const MAX_PARAMS_BYTES = 4096;
export const MAX_REASON = 160;
export const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const RUN_ID_RE = /^[0-9]{1,20}$/;
/** #3648: the state words of `rehearse` / `rehearsal-status`, the one plaintext a
 * rehearsal prints (ds-read-entrypoint REHEARSAL_STATE_RE). */
export const REHEARSAL_STATES = [
  "started",
  "running",
  "no pending migrations",
  "succeeded",
  "failed",
  "absent",
];
/** The rehearsal's runtime cap (spec «Durable unit.» RuntimeMaxSec=900): the poll's bound. */
export const REHEARSAL_POLL_CAP_SEC = 900;

export const ENVIRONMENT = "production-read";
export const READ_KEY_SECRET = "PROD_READ_SSH_KEY";
export const READ_PUBKEY_PATH = "infra/deploy/keys/prod-read.pub";
export const RECIPIENT_CERT_PATH = "infra/deploy/keys/prod-read-recipient.pem";
/** Under the operator's home: the result private key and the decrypted answers. */
export const RESULT_KEY_PATH = [".ds-platform", "prod-read-result.key"];
export const RESULT_DIR_PATH = [".ds-platform", "prod-read"];
export const artifactName = (runId) => `prod-read-${runId}`;

/**
 * The runner-side shape check of the dispatch inputs. The box checks every field
 * again; this keeps a malformed dispatch from ever reaching the key.
 * @returns {{ok: true, command: string, stdin: string|null} | {ok: false, error: string}}
 */
export function checkInputs({ verb = "", name = "", params = "", sha = "" }) {
  const fail = (error) => ({ ok: false, error });
  if (!READ_VERBS.includes(verb))
    return fail(`verb must be one of ${READ_VERBS.join(", ")}`);
  const text = params.trim() === "" ? "{}" : params;
  if (Buffer.byteLength(text, "utf8") > MAX_PARAMS_BYTES)
    return fail(`params exceeds ${MAX_PARAMS_BYTES} bytes`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("params is not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return fail("params is not one JSON object");
  const empty = Object.keys(parsed).length === 0;
  if (verb === "observe") {
    if (!NAME_RE.test(name))
      return fail("observe needs a name matching [a-z][a-z0-9-]{0,39}");
    if (sha !== "") return fail("observe takes no sha");
    return {
      ok: true,
      command: `observe ${name}`,
      stdin: JSON.stringify(parsed),
    };
  }
  if (name !== "") return fail(`${verb} takes no name`);
  if (!empty) return fail(`${verb} takes no params`);
  if (verb === "schema") {
    if (sha !== "") return fail("schema takes no sha");
    return { ok: true, command: "schema", stdin: null };
  }
  if (!SHA_RE.test(sha)) return fail(`${verb} needs the full 40-hex sha`);
  return { ok: true, command: `${verb} ${sha}`, stdin: null };
}

/** `capabilities` (plaintext, verbs only) must name the dispatched verb. */
export function checkCapabilities(text, verb) {
  let caps;
  try {
    caps = JSON.parse(text);
  } catch {
    return { ok: false, error: "capabilities did not answer JSON" };
  }
  if (
    caps?.role !== "prod" ||
    caps?.mode !== "read" ||
    !Array.isArray(caps?.verbs)
  ) {
    return { ok: false, error: "capabilities is not the prod read entrypoint" };
  }
  if (!caps.verbs.includes(verb)) {
    return {
      ok: false,
      error: `the box does not serve ${verb} (it serves: ${caps.verbs.filter((v) => /^[a-z-]{1,40}$/.test(v)).join(", ")})`,
    };
  }
  return { ok: true };
}

/** One line, control characters stripped, at most MAX_REASON characters. */
export function bound(text) {
  return [...String(text)]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join("")
    .slice(0, MAX_REASON);
}

/**
 * The failure reason the public log may carry: for exit 1 only a fixed reason of
 * READ_REASONS; for 2 / 3 the entrypoint's own fixed line; nothing else of stderr.
 */
export function failureReason(rc, stderr) {
  const prefix = `${BOX_TAG}: `;
  const own = String(stderr)
    .split(/\r?\n/)
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length));
  const last = own.at(-1);
  if (rc === 1) return READ_REASONS.includes(last) ? last : "the read failed";
  if ((rc === 2 || rc === 3) && last !== undefined) return bound(last);
  return `exited ${rc} without a reason`;
}

/**
 * The state word of a rehearsal answer: the last `ds-read-entrypoint: state <word>`
 * line of stderr when the word is one of REHEARSAL_STATES, else null.
 */
export function stateWord(stderr) {
  const prefix = `${BOX_TAG}: state `;
  const last = String(stderr)
    .split(/\r?\n/)
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
    .at(-1);
  return REHEARSAL_STATES.includes(last) ? last : null;
}

/** A DER CMS answer starts with a SEQUENCE; plaintext JSON never does. */
export function isCiphertext(buf) {
  return Buffer.isBuffer(buf) && buf.length > 0 && buf[0] === 0x30;
}

/**
 * The status line of one read (spec §4): verb, exit code, ciphertext size and
 * sha256, and for a failure the fixed reason. `upload` says the ciphertext may go.
 */
export function statusLine({ verb, rc, cms, stderr }) {
  const rehearsal = REHEARSAL_VERBS.includes(verb);
  const state = rehearsal ? stateWord(stderr) : null;
  if (rc === 0 && isCiphertext(cms) && (!rehearsal || state !== null)) {
    const sum = createHash("sha256").update(cms).digest("hex");
    // #3648: a rehearsal still `running` after the poll's cap is not an answer, and a
    // `failed` one fails the job: green from prod-observe.yml means a green rehearsal.
    // Either way the report is uploaded.
    const done = !rehearsal || !["started", "running"].includes(state);
    return {
      upload: true,
      failed: !done || state === "failed",
      line: `prod-observe: verb=${verb} rc=0${state ? ` state=${state.replaceAll(" ", "-")}` : ""} bytes=${cms.length} sha256=${sum}`,
    };
  }
  const reason =
    rc !== 0
      ? failureReason(rc, stderr)
      : isCiphertext(cms)
        ? "the answer carries no rehearsal state"
        : "the answer is not CMS ciphertext";
  return {
    upload: false,
    failed: true,
    line: `prod-observe: verb=${verb} rc=${rc} reason=${reason}`,
  };
}

function defaultRun(cmd, args, { input, cwd } = {}) {
  const r = spawnSync(cmd, args, { input, cwd, maxBuffer: 64 * 1024 * 1024 });
  return {
    status: r.error ? 127 : r.status,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: r.error ? String(r.error.message) : String(r.stderr ?? ""),
  };
}

class ReadError extends Error {}

function must(r, what) {
  if (r.status !== 0)
    throw new ReadError(
      `${what} failed (exit ${r.status}): ${bound(r.stderr.trim().split("\n").at(-1) ?? "")}`,
    );
  return r;
}

/**
 * `pnpm prod:read <run-id>`: download the run's `prod-read-<run-id>` artifact,
 * decrypt it with the result key into `~/.ds-platform/prod-read/<run-id>.json`
 * (0600). The plaintext never touches disk elsewhere.
 * @returns {{path: string, answer: object}}
 */
export function readRun({ runId, home, repoRoot, run = defaultRun }) {
  if (!RUN_ID_RE.test(String(runId)))
    throw new ReadError(
      "usage: pnpm prod:read <run-id> (the numeric Actions run id)",
    );
  const key = join(home, ...RESULT_KEY_PATH);
  if (!existsSync(key))
    throw new ReadError(
      `the result key ${key} is missing (pnpm prod:read-result-key)`,
    );
  const cert = join(repoRoot, RECIPIENT_CERT_PATH);
  const work = mkdtempSync(join(tmpdir(), "prod-read-"));
  try {
    must(
      run(
        "gh",
        [
          "run",
          "download",
          String(runId),
          "-n",
          artifactName(runId),
          "-D",
          work,
        ],
        { cwd: repoRoot },
      ),
      "gh run download",
    );
    const cms = join(work, "result.cms");
    if (!existsSync(cms))
      throw new ReadError(
        `the artifact ${artifactName(runId)} carries no result.cms`,
      );
    const args = [
      "cms",
      "-decrypt",
      "-binary",
      "-inform",
      "DER",
      "-in",
      cms,
      "-inkey",
      key,
    ];
    if (existsSync(cert)) args.push("-recip", cert);
    const plain = must(run("openssl", args), "openssl cms -decrypt").stdout;
    let answer;
    try {
      answer = JSON.parse(plain.toString("utf8"));
    } catch {
      throw new ReadError("the decrypted answer is not JSON");
    }
    if (answer === null || typeof answer !== "object")
      throw new ReadError("the decrypted answer is not one JSON object");
    const dir = join(home, ...RESULT_DIR_PATH);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${runId}.json`);
    writeFileSync(path, plain, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { path, answer };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** An already-decrypted answer of the run, or a fresh `readRun`. */
export function answerOf({ runId, home, repoRoot, run = defaultRun }) {
  if (RUN_ID_RE.test(String(runId))) {
    const path = join(home, ...RESULT_DIR_PATH, `${runId}.json`);
    if (existsSync(path)) {
      try {
        return { path, answer: JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        throw new ReadError(`${path} is not JSON`);
      }
    }
  }
  return readRun({ runId, home, repoRoot, run });
}

const PUBKEY_RE = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [A-Za-z0-9@._-]+)?$/;

/**
 * `pnpm prod:read-key` (the owner's terminal, spec §10): a fresh ed25519 pair in a
 * temporary directory, the private half into `PROD_READ_SSH_KEY` of Environment
 * `production-read`, the public half into `infra/deploy/keys/prod-read.pub`, the
 * directory deleted. The private half never leaves the directory except into gh.
 */
export function readKey({ repoRoot, run = defaultRun }) {
  const work = mkdtempSync(join(tmpdir(), "prod-read-key-"));
  try {
    const keyFile = join(work, "prod-read");
    must(
      run("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "gha-prod-read",
        "-f",
        keyFile,
      ]),
      "ssh-keygen",
    );
    const pub = readFileSync(`${keyFile}.pub`, "utf8").trim();
    if (!PUBKEY_RE.test(pub))
      throw new ReadError("ssh-keygen wrote an unexpected public key line");
    must(
      run("gh", ["secret", "set", READ_KEY_SECRET, "--env", ENVIRONMENT], {
        input: readFileSync(keyFile),
        cwd: repoRoot,
      }),
      `gh secret set ${READ_KEY_SECRET}`,
    );
    const dest = join(repoRoot, READ_PUBKEY_PATH);
    mkdirSync(join(repoRoot, "infra/deploy/keys"), { recursive: true });
    writeFileSync(dest, `${pub}\n`);
    return { pubkeyPath: dest };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * `pnpm prod:read-result-key [--rotate]` (the lead, spec §10): the RSA-4096 result
 * key pair. The private half goes 0600 to `~/.ds-platform/prod-read-result.key`
 * (refused over an existing one without `--rotate`), the self-signed certificate to
 * `infra/deploy/keys/prod-read-recipient.pem`, which the release installs.
 * @returns {{keyPath: string, certPath: string, fingerprint: string}}
 */
export function resultKey({
  repoRoot,
  home,
  rotate = false,
  run = defaultRun,
}) {
  const keyPath = join(home, ...RESULT_KEY_PATH);
  if (existsSync(keyPath) && !rotate)
    throw new ReadError(`${keyPath} exists; pass --rotate to replace it`);
  const work = mkdtempSync(join(tmpdir(), "prod-read-result-"));
  try {
    const k = join(work, "key.pem");
    const c = join(work, "cert.pem");
    must(
      run("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:4096",
        "-nodes",
        "-sha256",
        "-days",
        "3650",
        "-subj",
        "/CN=ds-prod-read-result",
        "-keyout",
        k,
        "-out",
        c,
      ]),
      "openssl req",
    );
    const fp = must(
      run("openssl", ["x509", "-in", c, "-noout", "-fingerprint", "-sha256"]),
      "openssl x509",
    )
      .stdout.toString("utf8")
      .trim();
    mkdirSync(join(home, ".ds-platform"), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, readFileSync(k), { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    const certPath = join(repoRoot, RECIPIENT_CERT_PATH);
    mkdirSync(join(repoRoot, "infra/deploy/keys"), { recursive: true });
    writeFileSync(certPath, readFileSync(c));
    return {
      keyPath,
      certPath,
      fingerprint: fp.replace(/^.*Fingerprint=/i, ""),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export { ReadError };
