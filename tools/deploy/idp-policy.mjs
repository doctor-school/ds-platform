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
