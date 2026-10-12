// tools/deploy/idp-policy.mjs — pure seams for the prod IdP provisioning step
// of `pnpm deploy:prod` (Issue #1997).
//
// WHY THIS EXISTS. `infra/dev-stand/idp/provision.sh` is the managed owner of
// the prod Zitadel instance configuration (login / notification / password-
// complexity policies, active providers, message texts). Until #1997 the deploy
// pipeline shipped IMAGES ONLY and the IdP kept whatever the last manual
// provisioning run had left behind. The 2026-09-07 incident (#1994) is the cost
// of that split: PR #1396 landed the 003 EARS-36 length-only password policy as
// a converge step on 2026-08-20, nothing ever ran it on prod, and registration
// 422'd against the inherited provider default (min 8 + four character classes)
// for 18 days. #1995 answered with a checklist item — a memory-based control.
// #1997 makes the PIPELINE own the run: every `pnpm deploy:prod` converges the
// instance and then READS THE POLICY BACK, fail-closed.
//
// WHAT LIVES HERE. Only the decisions that can be made without touching a box:
// the read-back verdict and the extraction of the mirrored SSOT constant. The
// ssh/curl I/O stays in `prod.mjs`, so this whole file is unit-testable on any
// platform with no network and no ssh.

/** Thrown by every seam here — never a bare Error. */
export class IdpPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "IdpPolicyError";
  }
}

/**
 * The character-class flags the length-only policy (003 EARS-36) requires to be
 * `false`. Order is the order we report in; Zitadel omits them from the response
 * entirely when they hold their proto3 default `false` (see below).
 */
export const PASSWORD_COMPLEXITY_FLAGS = [
  "hasUppercase",
  "hasLowercase",
  "hasNumber",
  "hasSymbol",
];

/**
 * Read the mirrored SSOT constant out of the `@ds/schemas` source text.
 *
 * The deploy must never hardcode a literal `8`: the number is a product
 * decision that lives in `packages/schemas/src/auth/auth.schema.ts`, and the
 * read-back has to compare the LIVE instance against the constant AT THE
 * DEPLOYED SHA — which is why the caller feeds this the output of
 * `git show <sha>:packages/schemas/src/auth/auth.schema.ts` rather than
 * importing the package (the deploy script is a plain `.mjs` CLI that never
 * builds the workspace, and on a `--ref` hotfix the target SHA's value is not
 * necessarily the local checkout's value).
 *
 * Fail-closed: an absent, renamed or non-numeric declaration throws.
 *
 * @param {string} sourceText contents of `auth.schema.ts` at the target SHA
 * @returns {number}
 */
export function parsePasswordMinLength(sourceText) {
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new IdpPolicyError(
      "cannot read PASSWORD_MIN_LENGTH: empty auth.schema.ts source",
    );
  }
  const m = /export\s+const\s+PASSWORD_MIN_LENGTH\s*=\s*(\d+)\s*;/.exec(
    sourceText,
  );
  if (!m) {
    throw new IdpPolicyError(
      "cannot read PASSWORD_MIN_LENGTH from packages/schemas/src/auth/auth.schema.ts" +
        " — the constant was renamed or is no longer a numeric literal; the deploy" +
        " refuses to guess the minimum length.",
    );
  }
  const value = Number(m[1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new IdpPolicyError(
      `PASSWORD_MIN_LENGTH parsed as ${m[1]}, which is not a positive integer`,
    );
  }
  return value;
}

/**
 * Verdict on the LIVE instance password-complexity policy, read back from
 * `GET /admin/v1/policies/password/complexity` after the provision converge.
 *
 * Zitadel returns `minLength` as a JSON STRING (`"8"`), so the comparison is
 * numeric on purpose; a number is accepted too, in case the API ever changes.
 *
 * A MISSING class flag reads as `false`, because that is what the wire actually
 * means here. Zitadel's REST surface is grpc-gateway + protojson configured with
 * a single `runtime.JSONPb` and NO `EmitUnpopulated`
 * (`internal/api/grpc/server/gateway.go`), so proto3 default values are dropped
 * from the response body — and `false` is the proto3 default for exactly the
 * four `hasUppercase/hasLowercase/hasNumber/hasSymbol` fields that DEFINE the
 * converged length-only policy (003 EARS-36). `minLength` survives only because
 * `"8"` is non-default. Treating an absent flag as a hard failure would red
 * every deploy on the CORRECT policy, after `migrate` + `up -d`.
 * This repo's live-proven precedent reads the very same endpoint the same way:
 * `infra/dev-stand/idp/provision.sh:853-857` uses `(.hasUppercase // false)` and
 * `(.minLength // "0")`. We mirror it exactly, including the `"0"` default for a
 * missing `minLength` — which then mismatches `expectedMin` and fails closed.
 * A flag that IS present but is not a boolean (e.g. the string `"false"`) is
 * still an error: that is an unexpected shape, not a proto3 default.
 *
 * @param {unknown} policyJson the parsed response body, or its `.policy` object
 * @param {number} expectedMin from {@link parsePasswordMinLength}
 * @returns {{minLength: number, flags: Record<string, boolean>}} on success
 * @throws {IdpPolicyError} on any mismatch or unreadable shape
 */
export function assertPasswordPolicyConverged(policyJson, expectedMin) {
  if (!Number.isInteger(expectedMin) || expectedMin <= 0) {
    throw new IdpPolicyError(
      `expected minimum length must be a positive integer, got ${JSON.stringify(expectedMin)}`,
    );
  }
  if (policyJson === null || typeof policyJson !== "object") {
    throw new IdpPolicyError(
      "IdP password-complexity read-back is not an object — the policy could not be read",
    );
  }
  // The endpoint wraps the policy in `{ policy: {...} }`; accept either form so
  // the caller may hand over the raw body.
  const policy =
    "policy" in policyJson &&
    policyJson.policy !== null &&
    typeof policyJson.policy === "object"
      ? policyJson.policy
      : policyJson;

  // provision.sh:854 `(.minLength // "0")` — an absent length defaults to 0 and
  // therefore mismatches any positive `expectedMin` below (fail-closed).
  const rawMin =
    policy.minLength === undefined ||
    policy.minLength === null ||
    policy.minLength === ""
      ? "0"
      : policy.minLength;
  const minLength = Number(rawMin);
  if (!Number.isFinite(minLength)) {
    throw new IdpPolicyError(
      `IdP password-complexity \`minLength\` is not numeric: ${JSON.stringify(rawMin)}`,
    );
  }

  const problems = [];
  if (minLength !== expectedMin) {
    problems.push(
      `minLength=${minLength}, expected ${expectedMin} (@ds/schemas PASSWORD_MIN_LENGTH)`,
    );
  }
  const flags = {};
  for (const flag of PASSWORD_COMPLEXITY_FLAGS) {
    const raw = policy[flag];
    // provision.sh:855-858 `(.hasUppercase // false)` — absent == proto3 `false`.
    const value = raw === undefined || raw === null ? false : raw;
    if (typeof value !== "boolean") {
      problems.push(
        `${flag} is present but not a boolean in the read-back: ${JSON.stringify(raw)}`,
      );
      continue;
    }
    flags[flag] = value;
    if (value === true) {
      problems.push(`${flag}=true, expected false (length-only, 003 EARS-36)`);
    }
  }

  if (problems.length > 0) {
    throw new IdpPolicyError(
      "prod IdP password-complexity policy did NOT converge:\n" +
        problems.map((p) => `    - ${p}`).join("\n"),
    );
  }
  return { minLength, flags };
}

/** One-line operator summary of a converged policy. */
export function formatPasswordPolicy({ minLength, flags }) {
  const flagText = PASSWORD_COMPLEXITY_FLAGS.map(
    (f) => `${f}=${flags[f]}`,
  ).join(" ");
  return `minLength=${minLength} ${flagText} — length-only creation policy (003 EARS-36)`;
}

// --- emailed/SMS code generators (#2636 six digits; #2555 epic #2552) -------
//
// provision.sh step 8.septies converges every generator whose code reaches a
// user — verify-email, password-reset, login OTP email + SMS — to one format
// (six digits) and reads them back itself; the deploy re-reads them on the box
// for the same reason it re-reads the password policy — a green provision exit
// code is not evidence of the instance state.

/** The four generators step 8.septies owns (#2636), in read-back order. */
export const EMAILED_CODE_GENERATOR_TYPES = [
  "SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE",
  "SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE",
  "SECRET_GENERATOR_TYPE_OTP_EMAIL",
  "SECRET_GENERATOR_TYPE_OTP_SMS",
];

/** The pair a pre-#2636 (#2555) target converges — upper letters + digits. */
export const LEGACY_LOGIN_OTP_GENERATOR_TYPES = [
  "SECRET_GENERATOR_TYPE_OTP_EMAIL",
  "SECRET_GENERATOR_TYPE_OTP_SMS",
];

/** Alphabet flags per converged code alphabet, and the value each must hold. */
const CODE_ALPHABETS = {
  digits: {
    label: "digits only",
    flags: [
      ["includeDigits", true],
      ["includeUpperLetters", false],
      ["includeLowerLetters", false],
      ["includeSymbols", false],
    ],
  },
  "upper-alnum": {
    label: "upper letters + digits",
    flags: [
      ["includeUpperLetters", true],
      ["includeDigits", true],
      ["includeLowerLetters", false],
      ["includeSymbols", false],
    ],
  },
};

/**
 * Read `VERIFY_CODE_LENGTH` out of `packages/schemas/src/storefront/register-fields.ts`
 * at the deployed SHA — the code length the shipped app accepts, which the
 * generators must produce (epic #2552: one code format). Fail-closed.
 *
 * @param {string} sourceText contents of `register-fields.ts` at the target SHA
 * @returns {number}
 */
export function parseVerifyCodeLength(sourceText) {
  const m =
    typeof sourceText === "string"
      ? /export\s+const\s+VERIFY_CODE_LENGTH\s*=\s*(\d+)\s*;/.exec(sourceText)
      : null;
  const value = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    throw new IdpPolicyError(
      "cannot read VERIFY_CODE_LENGTH from packages/schemas/src/storefront/register-fields.ts" +
        " — the constant is absent, renamed or not a positive numeric literal; the deploy" +
        " refuses to guess the code length.",
    );
  }
  return value;
}

function parseLengthConstant(provisionText, name) {
  const line = new RegExp(`^${name}=(.*)$`, "m").exec(provisionText);
  if (!line) return null;
  const m = /^(\d+)\s*$/.exec(line[1]);
  const value = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    throw new IdpPolicyError(
      `provision.sh defines ${name}=${line[1]} — not a positive numeric` +
        " literal; the deploy refuses to guess the code length.",
    );
  }
  return value;
}

/**
 * The generator types a provision.sh bash array (`NAME=(A B …)`) lists, or
 * `null` when the target has no such array. The target commit decides which
 * generators converge (003 EARS-47 added `VERIFY_PHONE_CODE`), so the deploy
 * reads the list instead of pinning it.
 *
 * @param {string} provisionText
 * @param {string} name
 * @returns {string[] | null}
 */
function parseGeneratorList(provisionText, name) {
  const match = provisionText.match(new RegExp(`^${name}=\\(([^)]*)\\)`, "m"));
  if (!match) return null;
  const types = match[1].split(/\s+/).filter(Boolean);
  if (
    types.length === 0 ||
    types.some((t) => !/^SECRET_GENERATOR_TYPE_[A-Z_]+$/.test(t))
  ) {
    throw new IdpPolicyError(
      `target provision.sh ${name} is not a list of SECRET_GENERATOR_TYPE_* literals —` +
        " the deploy refuses to guess which generators converge.",
    );
  }
  return types;
}

/**
 * Read the code shape `infra/dev-stand/idp/provision.sh` converges at the
 * deployed SHA. provision.sh runs from the TARGET commit, so only that commit's
 * step 8.septies decides which generators converge and to what alphabet:
 * - `EMAILED_CODE_LENGTH` (#2636+): the generators its `EMAILED_CODE_GENERATORS`
 *   lists (the four of #2636 when it lists none), digits only;
 * - `LOGIN_OTP_CODE_LENGTH` (#2555): the login OTP pair, upper letters + digits;
 * - neither (pre-#2555): nothing converges.
 *
 * @param {string} provisionText contents of provision.sh at the target SHA
 * @returns {{length: number, alphabet: "digits" | "upper-alnum", generators: string[]} | null}
 * @throws {IdpPolicyError} when a length constant is present but not a
 *   positive numeric literal — the deploy refuses to guess
 */
export function parseEmailedCodeShape(provisionText) {
  if (typeof provisionText !== "string") {
    throw new IdpPolicyError(
      "cannot read infra/dev-stand/idp/provision.sh at the target SHA — not a text body",
    );
  }
  const digitsLength = parseLengthConstant(
    provisionText,
    "EMAILED_CODE_LENGTH",
  );
  if (digitsLength !== null) {
    return {
      length: digitsLength,
      alphabet: "digits",
      generators:
        parseGeneratorList(provisionText, "EMAILED_CODE_GENERATORS") ??
        EMAILED_CODE_GENERATOR_TYPES,
    };
  }
  const legacyLength = parseLengthConstant(
    provisionText,
    "LOGIN_OTP_CODE_LENGTH",
  );
  if (legacyLength !== null) {
    return {
      length: legacyLength,
      alphabet: "upper-alnum",
      generators: LEGACY_LOGIN_OTP_GENERATOR_TYPES,
    };
  }
  return null;
}

/**
 * Which `apps/api/src/mailer/code-emails.ts` constant states each emailed
 * generator's lifetime (#2814). The email copy is rendered FROM these
 * constants, so the number the deploy pins is the number the user reads.
 * Generators whose code no email states a lifetime for (SMS, phone) are absent
 * and keep the presence-only expiry check.
 */
export const CODE_EMAIL_LIFETIME_CONSTANTS = {
  SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE: "VERIFY_EMAIL_CODE_LIFETIME_SECONDS",
  SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE:
    "PASSWORD_RESET_CODE_LIFETIME_SECONDS",
  SECRET_GENERATOR_TYPE_OTP_EMAIL: "LOGIN_EMAIL_CODE_LIFETIME_SECONDS",
};

/**
 * Read the code lifetimes the email copy states out of `code-emails.ts` at the
 * deployed SHA (same reason as {@link parsePasswordMinLength}: the deploy is a
 * plain `.mjs` CLI and a `--ref` target's value is that commit's, not the
 * checkout's).
 *
 * A target that declares none of the constants predates #2814 and pins
 * nothing (`{}`); a target that declares some but not all, or one that is not a
 * positive integer literal, is refused — the deploy never guesses a lifetime.
 *
 * @param {string} sourceText contents of `code-emails.ts` at the target SHA
 * @returns {Record<string, number>} seconds per generator type
 */
export function parseCodeEmailLifetimes(sourceText) {
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new IdpPolicyError(
      "cannot read the code-email lifetimes: empty apps/api/src/mailer/code-emails.ts source",
    );
  }
  const declared = Object.entries(CODE_EMAIL_LIFETIME_CONSTANTS).map(
    ([type, name]) => [
      type,
      name,
      new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([^;\\n]*);`).exec(
        sourceText,
      ),
    ],
  );
  if (declared.every(([, , m]) => m === null)) return {};
  const lifetimes = {};
  for (const [type, name, m] of declared) {
    const literal = m ? /^\s*(\d+)\s*$/.exec(m[1]) : null;
    const value = literal ? Number(literal[1]) : NaN;
    if (!Number.isInteger(value) || value <= 0) {
      throw new IdpPolicyError(
        `cannot read ${name} from apps/api/src/mailer/code-emails.ts` +
          (m ? ` (declared as ${JSON.stringify(m[1].trim())})` : " (absent)") +
          " — not a positive integer literal; the deploy refuses to guess the code lifetime.",
      );
    }
    lifetimes[type] = value;
  }
  return lifetimes;
}

/**
 * Decide what the deploy's code-generator read-back checks, from the TARGET
 * commit's own sources. A target whose provision.sh converges nothing is
 * skipped (a `--ref` hotfix to a pre-#2555 commit ships an app and an IdP that
 * agree on the inherited format). A target that converges must also ship an app
 * whose `VERIFY_CODE_LENGTH` matches — otherwise the converge would succeed and
 * every code would be rejected by the code input.
 *
 * The target's code-email lifetimes ride along as `expirySeconds` (#2814).
 *
 * @param {{provisionText: string, verifyCodeSchemaText: string, codeEmailsText: string}} sources
 * @returns {{check: true, length: number, alphabet: string, generators: string[], expirySeconds: Record<string, number>} | {check: false, reason: string}}
 * @throws {IdpPolicyError}
 */
export function resolveEmailedCodeExpectation({
  provisionText,
  verifyCodeSchemaText,
  codeEmailsText,
}) {
  const shape = parseEmailedCodeShape(provisionText);
  if (shape === null) {
    return {
      check: false,
      reason:
        "skipped: target provision.sh does not converge the code generators" +
        " (no EMAILED_CODE_LENGTH / LOGIN_OTP_CODE_LENGTH in step 8.septies) —" +
        " the instance keeps its current generators",
    };
  }
  const appLength = parseVerifyCodeLength(verifyCodeSchemaText);
  if (appLength !== shape.length) {
    throw new IdpPolicyError(
      `target provision.sh converges code length ${shape.length} but the shipped` +
        ` app accepts VERIFY_CODE_LENGTH=${appLength} — emailed codes would not match` +
        " the code input.",
    );
  }
  return {
    check: true,
    ...shape,
    expirySeconds: parseCodeEmailLifetimes(codeEmailsText),
  };
}

/**
 * Verdict on one LIVE code generator, read back from
 * `GET /admin/v1/secretgenerators/{type}`. Absent alphabet flags read as
 * `false` (proto3 defaults are dropped from the body — see
 * {@link assertPasswordPolicyConverged}); a present non-boolean is an error.
 * The expiry must be present. provision.sh preserves it rather than writing it,
 * so when the target's code email states this generator's lifetime the expiry
 * must equal it (#2814) — otherwise the email promises a lifetime the code does
 * not have and nothing else would fail.
 *
 * @param {unknown} generatorJson the body, or its `.secretGenerator` object
 * @param {{length: number, alphabet: string}} expected from {@link resolveEmailedCodeExpectation}
 * @param {number} [expectedExpirySeconds] the lifetime the code email states
 *   ({@link parseCodeEmailLifetimes}); omitted ⇒ presence-only
 * @returns {{length: number, alphabet: string, expiry: string}}
 * @throws {IdpPolicyError}
 */
export function assertCodeGeneratorConverged(
  generatorJson,
  expected,
  expectedExpirySeconds,
) {
  const alphabet = CODE_ALPHABETS[expected?.alphabet];
  if (!alphabet) {
    throw new IdpPolicyError(
      `unknown expected code alphabet ${JSON.stringify(expected?.alphabet)} — the deploy refuses to guess`,
    );
  }
  if (generatorJson === null || typeof generatorJson !== "object") {
    throw new IdpPolicyError(
      "IdP code generator read-back is not an object — the generator could not be read",
    );
  }
  const gen =
    generatorJson.secretGenerator !== null &&
    typeof generatorJson.secretGenerator === "object"
      ? generatorJson.secretGenerator
      : generatorJson;

  const problems = [];
  const length = Number(gen.length ?? 0);
  if (length !== expected.length) {
    problems.push(
      `length=${JSON.stringify(gen.length ?? null)}, expected ${expected.length} (target provision.sh step 8.septies)`,
    );
  }
  for (const [flag, want] of alphabet.flags) {
    const raw = gen[flag];
    const value = raw === undefined || raw === null ? false : raw;
    if (typeof value !== "boolean") {
      problems.push(
        `${flag} is present but not a boolean in the read-back: ${JSON.stringify(raw)}`,
      );
    } else if (value !== want) {
      problems.push(`${flag}=${value}, expected ${want}`);
    }
  }
  const expiry = gen.expiry;
  if (typeof expiry !== "string" || expiry === "") {
    problems.push(
      `expiry is missing from the read-back: ${JSON.stringify(expiry ?? null)}`,
    );
  } else if (expectedExpirySeconds !== undefined) {
    // protojson renders google.protobuf.Duration as decimal seconds + "s".
    const m = /^(\d+(?:\.\d+)?)s$/.exec(expiry);
    if (!m) {
      problems.push(
        `expiry=${expiry} is not a protobuf duration — cannot compare it with the ${expectedExpirySeconds}s the code email states`,
      );
    } else if (Number(m[1]) !== expectedExpirySeconds) {
      problems.push(
        `expiry=${expiry}, expected ${expectedExpirySeconds}s (the lifetime apps/api/src/mailer/code-emails.ts states in the email)`,
      );
    }
  }

  if (problems.length > 0) {
    throw new IdpPolicyError(
      "prod IdP code generator did NOT converge:\n" +
        problems.map((p) => `    - ${p}`).join("\n"),
    );
  }
  return { length, alphabet: expected.alphabet, expiry };
}

/** One-line operator summary of a converged code generator. */
export function formatCodeGenerator(type, { length, alphabet, expiry }) {
  return `${type}: length=${length} ${CODE_ALPHABETS[alphabet].label}, expiry ${expiry} (#2636 one code format)`;
}
