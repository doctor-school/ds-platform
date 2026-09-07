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
 * `false`. Order is the order Zitadel returns them and the order we report in.
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
 * A missing flag is NOT read as `false`: an absent field means the response
 * shape is not the one we verified against, and a deploy must never certify a
 * policy it could not actually read.
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

  const rawMin = policy.minLength;
  if (rawMin === undefined || rawMin === null || rawMin === "") {
    throw new IdpPolicyError(
      "IdP password-complexity read-back has no `minLength` — refusing to certify an unread policy",
    );
  }
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
    const value = policy[flag];
    if (typeof value !== "boolean") {
      problems.push(`${flag} is missing or not a boolean in the read-back`);
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
