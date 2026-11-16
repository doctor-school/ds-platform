#!/usr/bin/env node
// tools/deploy/data-secret.mjs — the data-box secret rotation's workstation and runner
// sides (Issue #4068; spec apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md
// §4 «Secrets and access», §5 «Data-prod verbs.» → secret-apply; infra/deploy/README.md
// → «Rotating the box's pgBackRest S3 key»).
//
// Operator (workstation):
//   pnpm prod:data-secret <live sha> < values.txt
//                                        NAME=value lines on stdin (SECRET_KEYS only) →
//                                        the base64 ciphertext for data-secret.yml on
//                                        stdout; the dispatch command on stderr. One use:
//                                        it names the live SHA, carries a fresh nonce,
//                                        and the box refuses it after 6 h or once a newer
//                                        or the same one has been applied
// Runner (data-secret.yml, node builtins only):
//   node tools/deploy/data-secret.mjs verdict <sha>   stdin one `status prod <sha>`
//                                        answer of ds-data-prod → one status line on
//                                        stderr, `running` | `succeeded` | `failed` on stdout
//
// The plaintext never touches disk: it goes to `openssl cms -encrypt` on stdin, and only
// the ciphertext — encrypted to the intake certificate ds-data-prod generated and holds
// the key of — leaves this process. The values never enter GitHub: the workflow input is
// the ciphertext, and its log carries names and status lines only.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The data.env names secret-apply replaces; pinned equal to the entrypoint's SECRET_KEYS. */
export const SECRET_KEYS = Object.freeze([
  "PGBACKREST_REPO1_S3_KEY",
  "PGBACKREST_REPO1_S3_KEY_SECRET",
]);
/** The value shape the box accepts; pinned equal to the entrypoint's SECRET_VALUE. */
export const SECRET_VALUE = /^[A-Za-z0-9+/=_.-]{8,256}$/;
/** The box refuses a ciphertext whose plaintext is older than this (6 h); pinned equal to the entrypoint's SECRET_MAX_AGE. */
export const SECRET_MAX_AGE_SEC = 6 * 3600;
/** The step ds-data-prod runs the rotation in: unit ds-prod-<sha12>-data-secret. */
export const SECRET_STEP = "data-secret";

export const RECIPIENT_PATH = fileURLToPath(
  new URL("../../infra/deploy/keys/data-secret-recipient.pem", import.meta.url),
);

export class SecretError extends Error {}

/**
 * `NAME=value` lines → `{NAME: value}`. Blank lines and `#` comments are skipped; any
 * other line must name one of SECRET_KEYS once, with a value of SECRET_VALUE's shape.
 * Errors name the line number and the name, never the value.
 */
export function parseSecretLines(text) {
  const values = {};
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) return;
      const eq = line.indexOf("=");
      const name = eq > 0 ? line.slice(0, eq) : "";
      if (!SECRET_KEYS.includes(name)) {
        throw new SecretError(
          `line ${i + 1}: not NAME=value with NAME one of ${SECRET_KEYS.join(", ")}`,
        );
      }
      if (name in values)
        throw new SecretError(`line ${i + 1}: ${name} is given twice`);
      if (!SECRET_VALUE.test(line.slice(eq + 1))) {
        throw new SecretError(
          `line ${i + 1}: the value of ${name} is not 8-256 characters of A-Z a-z 0-9 + / = _ . -`,
        );
      }
      values[name] = line.slice(eq + 1);
    });
  if (Object.keys(values).length === 0)
    throw new SecretError("no NAME=value line on stdin");
  return values;
}

/**
 * The plaintext the box's DATA_PY secret-stage reads. `sha` binds it to the live prod
 * SHA the apply names; `nonce` and `createdAt` let the box refuse a replay (it keeps
 * the last applied pair and accepts only a newer `createdAt`).
 */
export function secretPlaintext(
  values,
  { sha, now = new Date(), nonce = randomBytes(16).toString("hex") },
) {
  if (!/^[0-9a-f]{40}$/.test(String(sha)))
    throw new SecretError("the live prod SHA must be the full 40-hex id");
  const createdAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return JSON.stringify({ schema: 1, createdAt, sha, nonce, values });
}

/**
 * Refuses while ds-data-prod's intake certificate is not in the tree. The box
 * generates its key pair only once a release carrying the data-secret verbs has
 * installed them; the certificate is then committed from the recipient run's log.
 */
export function requireRecipient(certPath = RECIPIENT_PATH) {
  if (existsSync(certPath)) return;
  throw new SecretError(
    [
      `${certPath} is not committed yet, so there is nothing to encrypt to.`,
      "After a release carrying the data-secret verbs is live, dispatch",
      "`gh workflow run data-secret.yml --ref main -f action=recipient` and commit the",
      "certificate it prints (infra/deploy/README.md → «Rotating the box's pgBackRest S3 key», step 1).",
    ].join(" "),
  );
}

/** The ciphertext (base64 of CMS AuthEnvelopedData, DER) of `plaintext` to `certPath`. */
export function encryptSecret(
  plaintext,
  certPath = RECIPIENT_PATH,
  run = execFileSync,
) {
  requireRecipient(certPath);
  const der = run(
    "openssl",
    ["cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER", certPath],
    { input: plaintext, stdio: ["pipe", "pipe", "pipe"] },
  );
  return Buffer.from(der).toString("base64");
}

/** The SHA-256 fingerprint of the PEM certificate, as `openssl x509 -fingerprint` prints it. */
export function certFingerprint(pem) {
  const der = new X509Certificate(pem).raw;
  return createHash("sha256")
    .update(der)
    .digest("hex")
    .toUpperCase()
    .match(/../g)
    .join(":");
}

/**
 * One `status prod <sha>` answer of ds-data-prod → the rotation's state and one status
 * line: `running` while the data-secret step has no exit code, `succeeded` / `failed`
 * by its exit code. Only the step name, the unit state and the exit code are printed.
 */
export function rotationVerdict(stdout, sha) {
  let answer;
  try {
    answer = JSON.parse(String(stdout).trim());
  } catch {
    return {
      state: "failed",
      line: "status: ds-data-prod answered no status JSON",
    };
  }
  const release = answer?.release;
  if (!release || release.sha !== sha) {
    return {
      state: "failed",
      line: `status: no data-secret attempt recorded for ${sha.slice(0, 12)}`,
    };
  }
  const step = (release.steps ?? []).find((s) => s.name === SECRET_STEP);
  if (!step)
    return {
      state: "failed",
      line: `status: the ${SECRET_STEP} step is not recorded`,
    };
  if (step.rc === null || step.rc === undefined) {
    if (answer.unitAlive === false) {
      return {
        state: "failed",
        line: `status: ${SECRET_STEP} ended without recording a verdict`,
      };
    }
    return { state: "running", line: `status: ${SECRET_STEP} running` };
  }
  return step.rc === 0
    ? {
        state: "succeeded",
        line: `status: ${SECRET_STEP} succeeded (pgbackrest check passed)`,
      }
    : {
        state: "failed",
        line: `status: ${SECRET_STEP} failed, exit ${Number(step.rc)} (the previous data.env is back)`,
      };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "verdict") {
    if (rest.length !== 1 || !/^[0-9a-f]{40}$/.test(rest[0])) {
      process.stderr.write(
        "usage: data-secret.mjs verdict <sha> < status-answer\n",
      );
      return 2;
    }
    const { state, line } = rotationVerdict(readFileSync(0, "utf8"), rest[0]);
    process.stderr.write(`${line}\n`);
    process.stdout.write(`${state}\n`);
    return 0;
  }
  if (rest.length !== 0 || !/^[0-9a-f]{40}$/.test(cmd ?? "")) {
    process.stderr.write(
      "usage: pnpm prod:data-secret <live sha> < NAME=value lines\n",
    );
    return 2;
  }
  const sha = cmd;
  try {
    requireRecipient();
    const values = parseSecretLines(readFileSync(0, "utf8"));
    const ciphertext = encryptSecret(secretPlaintext(values, { sha }));
    process.stdout.write(`${ciphertext}\n`);
    process.stderr.write(
      [
        `data-secret: ${Object.keys(values).join(", ")} encrypted to ${certFingerprint(readFileSync(RECIPIENT_PATH, "utf8"))}`,
        `data-secret: valid for 6 h, once, for ${sha.slice(0, 12)} only. On the owner's word:`,
        `  gh workflow run data-secret.yml --ref main -f action=apply -f sha=${sha} -f owner_quote="<the owner's words>" -f ciphertext=<the line above>`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    if (!(err instanceof SecretError)) throw err;
    process.stderr.write(`data-secret: ${err.message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
