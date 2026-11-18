#!/usr/bin/env node
// tools/deploy/data-secret.mjs — the box secret rotation's workstation and runner sides:
// ds-data-prod's data.env (Issue #4068) and ds-api-prod's api.env + compose .env
// (Issue #4153); spec apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md
// §4 «Secrets and access», §5 «Data-prod verbs.» → secret-apply and «Api-prod secret
// verbs.»; infra/deploy/README.md → «Rotating the box's pgBackRest S3 key» and
// «Changing an api.env or compose .env line».
//
// Operator (workstation):
//   pnpm prod:data-secret <live sha> < values.txt
//   pnpm prod:api-secret <live sha> < values.txt      (= data-secret.mjs --box api)
//                                        NAME=value lines on stdin (the box's allowlist,
//                                        BOXES[box].names) → the base64 ciphertext for
//                                        data-secret.yml on stdout; the dispatch command
//                                        on stderr. One use: it names the live SHA,
//                                        carries a fresh nonce, and the box refuses it
//                                        after 6 h or once a newer or the same one has
//                                        been applied. On the api box `NAME=<generate>`
//                                        has the box generate the value of an absent or
//                                        empty generatable name; it is never printed
// Runner (data-secret.yml, node builtins only):
//   node tools/deploy/data-secret.mjs verdict [--box api] <sha>
//                                        stdin one status answer of the box → one status
//                                        line on stderr, `running` | `succeeded` |
//                                        `failed` on stdout
//
// The plaintext never touches disk: it goes to `openssl cms -encrypt` on stdin, and only
// the ciphertext — encrypted to the intake certificate the box generated and holds the
// key of — leaves this process. The values never enter GitHub: the workflow input is
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
/** The value of a `NAME=<generate>` line: the api box generates that value itself. */
export const GENERATE = "<generate>";

export const RECIPIENT_PATH = fileURLToPath(
  new URL("../../infra/deploy/keys/data-secret-recipient.pem", import.meta.url),
);

export class SecretError extends Error {}

// The value shapes (regex sources, anchored on use), pinned equal to the entrypoint's
// API_SECRETS. None admits whitespace, a quote or a shell metacharacter: api.env is
// sourced by bash (provision.sh, the runbooks).
const TOKEN = {
  shape: "[A-Za-z0-9+/=_.-]{8,256}",
  hint: "8-256 characters of A-Z a-z 0-9 + / = _ . -",
};
const HEX64 = {
  shape: "[0-9a-f]{64}",
  hint: "64 lowercase hex characters (openssl rand -hex 32)",
  generate: "hex32",
};
const B64_32 = {
  shape: "[A-Za-z0-9+/]{43}=",
  hint: "base64 of exactly 32 bytes (openssl rand -base64 32)",
  generate: "base64-32",
};
const ORIGIN = {
  shape: "https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?",
  hint: "an https origin without a path",
};
const inApiEnv = (spec) => Object.freeze({ file: "api", ...spec });

/**
 * The boxes the rotation serves. `names`: NAME → {file, shape, hint, generate?}, pinned
 * equal to the entrypoint's SECRET_KEYS / API_SECRETS; `file` is the box file the name
 * lives in (`data`: data.env; `api`: /etc/ds-platform/api.env; `compose`: the api-prod
 * compose `.env`). `step`: the ds-release step (unit ds-prod-<sha12>-<step>).
 */
export const BOXES = Object.freeze({
  data: Object.freeze({
    label: "data-secret",
    host: "ds-data-prod",
    recipient: RECIPIENT_PATH,
    step: SECRET_STEP,
    checked: "pgbackrest check passed",
    restored: "the previous data.env is back",
    runbook:
      "infra/deploy/README.md → «Rotating the box's pgBackRest S3 key», step 1",
    names: Object.freeze(
      Object.fromEntries(
        SECRET_KEYS.map((n) => [n, Object.freeze({ file: "data", ...TOKEN })]),
      ),
    ),
  }),
  api: Object.freeze({
    label: "api-secret",
    host: "ds-api-prod",
    recipient: fileURLToPath(
      new URL(
        "../../infra/deploy/keys/api-secret-recipient.pem",
        import.meta.url,
      ),
    ),
    step: "api-secret",
    checked: "the recreated stack answers /v1/health at the live SHA and /v1/ready",
    restored: "the previous api.env and compose .env are back",
    runbook:
      "infra/deploy/README.md → «Changing an api.env or compose .env line», step 1",
    names: Object.freeze({
      // The runtime-env contract (packages/schemas/src/runtime-env/runtime-env-contract.json).
      DATABASE_URL: inApiEnv({
        shape:
          "postgres(ql)?://[A-Za-z0-9._%+-]{1,128}(:[A-Za-z0-9._%+-]{1,256})?@[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?/[A-Za-z0-9_-]{1,63}",
        hint: "a postgresql://user:password@host:port/db URL",
      }),
      AUDIT_IDENTIFIER_PEPPER: inApiEnv(HEX64),
      LIFECYCLE_IMPACT_TOKEN_SECRET: inApiEnv(HEX64),
      SIGN_IN_RECORD_KEY: inApiEnv(B64_32),
      ACADEMY_PUBLIC_ORIGIN: inApiEnv(ORIGIN),
      DOCTOR_PUBLIC_ORIGIN: inApiEnv(ORIGIN),
      // The IdP re-provision (provision.sh's output).
      IDP_SERVICE_TOKEN: inApiEnv(TOKEN),
      IDP_CLIENT_ID: inApiEnv({
        shape: "[A-Za-z0-9@._-]{1,128}",
        hint: "1-128 characters of A-Z a-z 0-9 @ . _ -",
      }),
      IDP_CLIENT_SECRET: inApiEnv(TOKEN),
      IDP_PROJECT_ID: inApiEnv({ shape: "[0-9]{1,24}", hint: "1-24 digits" }),
      // The captcha toggle (OFF: both keys empty).
      BOT_PROTECTION_ENABLED: inApiEnv({
        shape: "true|false",
        hint: "true or false",
      }),
      SMARTCAPTCHA_SERVER_KEY: inApiEnv({
        shape: "(ysc2_[A-Za-z0-9_-]{20,250})?",
        hint: "ysc2_… or empty",
      }),
      SMARTCAPTCHA_SITE_KEY: Object.freeze({
        file: "compose",
        shape: "(ysc1_[A-Za-z0-9_-]{20,250})?",
        hint: "ysc1_… or empty",
      }),
      // 048's Telegram connector (048-design; unset = the connector is off).
      TELEGRAM_BOT_TOKEN: inApiEnv({
        shape: "[0-9]{1,20}:[A-Za-z0-9_-]{30,100}",
        hint: "<digits>:<30-100 characters of A-Z a-z 0-9 _ ->",
      }),
      TELEGRAM_WEBHOOK_SECRET: inApiEnv({
        shape: "[A-Za-z0-9_-]{1,256}",
        hint: "1-256 characters of A-Z a-z 0-9 _ -",
        generate: "hex32",
      }),
      TELEGRAM_WEBHOOK_URL: inApiEnv({
        shape: "https://api[.]doctor[.]school/v1/integrations/telegram/webhook",
        hint: "https://api.doctor.school/v1/integrations/telegram/webhook",
      }),
    }),
  }),
});

function boxOf(box) {
  if (!Object.hasOwn(BOXES, box))
    throw new SecretError(`no such box: ${box} (data or api)`);
  return BOXES[box];
}

/**
 * `NAME=value` lines → `{NAME: value}`. Blank lines and `#` comments are skipped; any
 * other line must name one of the box's names once, with a value of its shape — or
 * GENERATE for a name the box generates. Errors name the line number and the name,
 * never the value.
 */
export function parseSecretLines(text, box = "data") {
  const { names } = boxOf(box);
  const values = {};
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) return;
      const eq = line.indexOf("=");
      const name = eq > 0 ? line.slice(0, eq) : "";
      if (!Object.hasOwn(names, name)) {
        throw new SecretError(
          `line ${i + 1}: not NAME=value with NAME one of ${Object.keys(names).join(", ")}`,
        );
      }
      if (name in values)
        throw new SecretError(`line ${i + 1}: ${name} is given twice`);
      const value = line.slice(eq + 1);
      const spec = names[name];
      if (value === GENERATE) {
        if (!spec.generate)
          throw new SecretError(
            `line ${i + 1}: ${name} is not generated by the box`,
          );
      } else if (!new RegExp(`^(?:${spec.shape})$`).test(value)) {
        throw new SecretError(
          `line ${i + 1}: the value of ${name} is not ${spec.hint}`,
        );
      }
      values[name] = value;
    });
  if (Object.keys(values).length === 0)
    throw new SecretError("no NAME=value line on stdin");
  return values;
}

/**
 * The plaintext the box's DATA_PY secret-stage reads. `sha` binds it to the live prod
 * SHA the apply names; `nonce` and `createdAt` let the box refuse a replay (it keeps
 * the last applied pair and accepts only a newer `createdAt`). GENERATE values go to
 * `generate` (present only when non-empty), never among the values.
 */
export function secretPlaintext(
  values,
  { sha, now = new Date(), nonce = randomBytes(16).toString("hex") },
) {
  if (!/^[0-9a-f]{40}$/.test(String(sha)))
    throw new SecretError("the live prod SHA must be the full 40-hex id");
  const createdAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const given = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== GENERATE),
  );
  const generate = Object.keys(values).filter((n) => values[n] === GENERATE);
  return JSON.stringify({
    schema: 1,
    createdAt,
    sha,
    nonce,
    values: given,
    ...(generate.length ? { generate } : {}),
  });
}

/**
 * Refuses when the intake certificate is not in the tree, so a ciphertext is never
 * made to anything but the certificate committed from the box's recipient run.
 */
export function requireRecipient(certPath = RECIPIENT_PATH, box = "data") {
  if (existsSync(certPath)) return;
  const { host, runbook } = boxOf(box);
  const flag = box === "data" ? "" : ` -f box=${box}`;
  throw new SecretError(
    [
      `${certPath} is missing, so there is nothing to encrypt to.`,
      `Restore it from main; for a rebuilt ${host}, or before its first rotation, dispatch`,
      `\`gh workflow run data-secret.yml --ref main${flag} -f action=recipient\` and commit the`,
      `certificate it prints (${runbook}).`,
    ].join(" "),
  );
}

/** The ciphertext (base64 of CMS AuthEnvelopedData, DER) of `plaintext` to `certPath`. */
export function encryptSecret(
  plaintext,
  certPath = RECIPIENT_PATH,
  run = execFileSync,
  box = "data",
) {
  requireRecipient(certPath, box);
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
 * One `status prod <sha>` answer of the box → the rotation's state and one status
 * line: `running` while the box's step has no exit code, `succeeded` / `failed` by its
 * exit code. Only the step name, the unit state and the exit code are printed.
 */
export function rotationVerdict(stdout, sha, box = "data") {
  const { host, step: name, checked, restored } = boxOf(box);
  let answer;
  try {
    answer = JSON.parse(String(stdout).trim());
  } catch {
    return {
      state: "failed",
      line: `status: ${host} answered no status JSON`,
    };
  }
  const release = answer?.release;
  if (!release || release.sha !== sha) {
    return {
      state: "failed",
      line: `status: no ${name} attempt recorded for ${sha.slice(0, 12)}`,
    };
  }
  const step = (release.steps ?? []).find((s) => s.name === name);
  if (!step)
    return {
      state: "failed",
      line: `status: the ${name} step is not recorded`,
    };
  if (step.rc === null || step.rc === undefined) {
    if (answer.unitAlive === false) {
      return {
        state: "failed",
        line: `status: ${name} ended without recording a verdict`,
      };
    }
    return { state: "running", line: `status: ${name} running` };
  }
  return step.rc === 0
    ? { state: "succeeded", line: `status: ${name} succeeded (${checked})` }
    : {
        state: "failed",
        line: `status: ${name} failed, exit ${Number(step.rc)} (${restored})`,
      };
}

const SHA40 = /^[0-9a-f]{40}$/;

/** `--box <name>` anywhere in argv → {box, rest}; `data` without the flag. */
function takeBox(argv) {
  const i = argv.indexOf("--box");
  if (i < 0) return { box: "data", rest: argv };
  return {
    box: argv[i + 1],
    rest: [...argv.slice(0, i), ...argv.slice(i + 2)],
  };
}

function main(argv) {
  const { box, rest: args } = takeBox(argv);
  if (!Object.hasOwn(BOXES, box ?? "")) {
    process.stderr.write("data-secret: --box takes data or api\n");
    return 2;
  }
  const { label, recipient, host } = BOXES[box];
  const [cmd, ...rest] = args;
  if (cmd === "verdict") {
    if (rest.length !== 1 || !SHA40.test(rest[0])) {
      process.stderr.write(
        "usage: data-secret.mjs verdict [--box api] <sha> < status-answer\n",
      );
      return 2;
    }
    const { state, line } = rotationVerdict(
      readFileSync(0, "utf8"),
      rest[0],
      box,
    );
    process.stderr.write(`${line}\n`);
    process.stdout.write(`${state}\n`);
    return 0;
  }
  if (rest.length !== 0 || !SHA40.test(cmd ?? "")) {
    process.stderr.write(
      `usage: pnpm prod:${label} <live sha> < NAME=value lines\n`,
    );
    return 2;
  }
  const sha = cmd;
  try {
    requireRecipient(recipient, box);
    const values = parseSecretLines(readFileSync(0, "utf8"), box);
    const ciphertext = encryptSecret(
      secretPlaintext(values, { sha }),
      recipient,
      execFileSync,
      box,
    );
    const flag = box === "data" ? "" : ` -f box=${box}`;
    process.stdout.write(`${ciphertext}\n`);
    process.stderr.write(
      [
        `${label}: ${Object.keys(values).join(", ")} encrypted to ${certFingerprint(readFileSync(recipient, "utf8"))} (${host})`,
        `${label}: valid for 6 h, once, for ${sha.slice(0, 12)} only. On the owner's word:`,
        `  gh workflow run data-secret.yml --ref main${flag} -f action=apply -f sha=${sha} -f owner_quote="<the owner's words>" -f ciphertext=<the line above>`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    if (!(err instanceof SecretError)) throw err;
    process.stderr.write(`${label}: ${err.message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
