// tools/deploy/idp-policy.test.mjs — the pipeline-owned IdP provision converge
// (Issue #1997, incident #1994). Pure-seam tests: no ssh, no curl, no box. The
// whole read-back decision table runs deterministically on any platform (CI is
// Linux — no drive-letter literals, no repo-root probing).
//
// Run: pnpm test:tools   (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertLoginOtpGeneratorConverged,
  assertPasswordPolicyConverged,
  formatLoginOtpGenerator,
  formatPasswordPolicy,
  IdpPolicyError,
  LOGIN_OTP_GENERATOR_TYPES,
  parsePasswordMinLength,
  parseVerifyCodeLength,
} from "./idp-policy.mjs";

const converged = {
  minLength: "8",
  hasUppercase: false,
  hasLowercase: false,
  hasNumber: false,
  hasSymbol: false,
};

// --- parsePasswordMinLength (the SSOT constant, read at the target SHA) ----

test("#1997: PASSWORD_MIN_LENGTH is read from the schema source, never hardcoded", () => {
  const src = `export const PASSWORD_MAX_LENGTH = 128;\nexport const PASSWORD_MIN_LENGTH = 8;\n`;
  assert.equal(parsePasswordMinLength(src), 8);
});

test("#1997: a changed constant is picked up (no literal 8 anywhere in the deploy)", () => {
  assert.equal(
    parsePasswordMinLength("export const PASSWORD_MIN_LENGTH = 12;"),
    12,
  );
});

test("#1997: a renamed/absent constant fails closed rather than defaulting", () => {
  assert.throws(
    () => parsePasswordMinLength("export const MIN_PASSWORD = 8;"),
    IdpPolicyError,
  );
  assert.throws(() => parsePasswordMinLength(""), IdpPolicyError);
  assert.throws(() => parsePasswordMinLength(undefined), IdpPolicyError);
});

test("#1997: a non-literal constant fails closed", () => {
  assert.throws(
    () => parsePasswordMinLength("export const PASSWORD_MIN_LENGTH = MIN;"),
    IdpPolicyError,
  );
});

// --- assertPasswordPolicyConverged (the read-back verdict) ----------------

test("#1997: a converged length-only policy passes (minLength is a JSON string)", () => {
  const verdict = assertPasswordPolicyConverged(converged, 8);
  assert.equal(verdict.minLength, 8);
  assert.deepEqual(verdict.flags, {
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  });
});

test("#1997: minLength as a NUMBER is accepted too (API-shape tolerance)", () => {
  assert.equal(
    assertPasswordPolicyConverged({ ...converged, minLength: 8 }, 8).minLength,
    8,
  );
});

test("#1997: the `{ policy: {...} }` envelope is unwrapped", () => {
  assert.equal(
    assertPasswordPolicyConverged({ policy: converged }, 8).minLength,
    8,
  );
});

test("#1994 regression: a still-strict instance (any class flag true) is REJECTED", () => {
  for (const flag of [
    "hasUppercase",
    "hasLowercase",
    "hasNumber",
    "hasSymbol",
  ]) {
    assert.throws(
      () => assertPasswordPolicyConverged({ ...converged, [flag]: true }, 8),
      (e) => e instanceof IdpPolicyError && e.message.includes(`${flag}=true`),
      `expected ${flag}=true to be rejected`,
    );
  }
});

test("#1997: a minLength that disagrees with @ds/schemas is REJECTED", () => {
  assert.throws(
    () => assertPasswordPolicyConverged({ ...converged, minLength: "10" }, 8),
    (e) =>
      e instanceof IdpPolicyError && /minLength=10, expected 8/.test(e.message),
  );
});

test("#1997: Zitadel omits proto3 `false` — a body with NO class flags is CONVERGED", () => {
  // grpc-gateway/protojson without EmitUnpopulated drops every default value,
  // so the correct length-only policy arrives as `{ minLength: "8" }` alone.
  // provision.sh:853-857 reads the same endpoint with `// false` defaulting.
  const verdict = assertPasswordPolicyConverged({ minLength: "8" }, 8);
  assert.equal(verdict.minLength, 8);
  assert.deepEqual(verdict.flags, {
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  });
});

test("#1997: a single omitted flag reads as false alongside explicit ones", () => {
  const { hasSymbol, ...withoutSymbol } = converged;
  void hasSymbol;
  assert.equal(
    assertPasswordPolicyConverged(withoutSymbol, 8).flags.hasSymbol,
    false,
  );
});

test('#1997: a flag PRESENT but not a boolean (string "false") is REJECTED', () => {
  assert.throws(
    () =>
      assertPasswordPolicyConverged({ ...converged, hasNumber: "false" }, 8),
    (e) =>
      e instanceof IdpPolicyError &&
      /hasNumber is present but not a boolean/.test(e.message),
  );
});

test("#1997: a missing or non-numeric minLength is REJECTED", () => {
  // provision.sh:854 `(.minLength // "0")` — absent defaults to 0, which can
  // never equal a positive PASSWORD_MIN_LENGTH, so the deploy still fails closed.
  const { minLength, ...withoutMin } = converged;
  void minLength;
  assert.throws(
    () => assertPasswordPolicyConverged(withoutMin, 8),
    (e) =>
      e instanceof IdpPolicyError && /minLength=0, expected 8/.test(e.message),
  );
  assert.throws(
    () => assertPasswordPolicyConverged({}, 8),
    (e) =>
      e instanceof IdpPolicyError && /minLength=0, expected 8/.test(e.message),
  );
  assert.throws(
    () =>
      assertPasswordPolicyConverged({ ...converged, minLength: "eight" }, 8),
    IdpPolicyError,
  );
});

test("#1997: a non-object read-back (curl failure, HTML error page) is REJECTED", () => {
  for (const body of [null, undefined, "", "<html>502</html>", 8]) {
    assert.throws(
      () => assertPasswordPolicyConverged(body, 8),
      IdpPolicyError,
      `expected ${JSON.stringify(body)} to be rejected`,
    );
  }
});

test("#1997: an unusable expected minimum is REJECTED before the comparison", () => {
  assert.throws(
    () => assertPasswordPolicyConverged(converged, 0),
    IdpPolicyError,
  );
  assert.throws(
    () => assertPasswordPolicyConverged(converged, Number.NaN),
    IdpPolicyError,
  );
});

// --- formatPasswordPolicy (operator line) ---------------------------------

test("#1997: the operator line names the length and every class flag", () => {
  const line = formatPasswordPolicy(
    assertPasswordPolicyConverged(converged, 8),
  );
  assert.match(line, /minLength=8/);
  assert.match(
    line,
    /hasUppercase=false hasLowercase=false hasNumber=false hasSymbol=false/,
  );
});

// --- login OTP secret generators (#2555, epic #2552 «one email code») -------

const otpConverged = {
  secretGenerator: {
    generatorType: "SECRET_GENERATOR_TYPE_OTP_EMAIL",
    length: 6,
    expiry: "300s",
    includeUpperLetters: true,
    includeDigits: true,
  },
};

test("#2555: the deploy reads back BOTH login OTP generators (email + SMS)", () => {
  assert.deepEqual(LOGIN_OTP_GENERATOR_TYPES, [
    "SECRET_GENERATOR_TYPE_OTP_EMAIL",
    "SECRET_GENERATOR_TYPE_OTP_SMS",
  ]);
});

test("#2555: VERIFY_CODE_LENGTH is read from the schema source, never hardcoded", () => {
  assert.equal(
    parseVerifyCodeLength("export const VERIFY_CODE_LENGTH = 6;\n"),
    6,
  );
  assert.throws(
    () => parseVerifyCodeLength("export const CODE_LEN = 6;"),
    IdpPolicyError,
  );
  assert.throws(() => parseVerifyCodeLength(""), IdpPolicyError);
});

test("#2555: a 6-char upper-alnum generator passes; omitted proto3 `false` flags read as false", () => {
  const verdict = assertLoginOtpGeneratorConverged(otpConverged, 6);
  assert.deepEqual(verdict, { length: 6, expiry: "300s" });
});

test("#2555: the unwrapped generator object is accepted too", () => {
  assert.equal(
    assertLoginOtpGeneratorConverged(otpConverged.secretGenerator, 6).length,
    6,
  );
});

test("#2555: the inherited provider default (8 digits) is REJECTED", () => {
  assert.throws(
    () =>
      assertLoginOtpGeneratorConverged(
        { secretGenerator: { length: 8, expiry: "300s", includeDigits: true } },
        6,
      ),
    (e) =>
      e instanceof IdpPolicyError &&
      /length=8, expected 6/.test(e.message) &&
      /includeUpperLetters=false, expected true/.test(e.message),
  );
});

test("#2555: lower letters or symbols in the alphabet are REJECTED", () => {
  for (const flag of ["includeLowerLetters", "includeSymbols"]) {
    assert.throws(
      () =>
        assertLoginOtpGeneratorConverged(
          {
            secretGenerator: { ...otpConverged.secretGenerator, [flag]: true },
          },
          6,
        ),
      new RegExp(`${flag}=true, expected false`),
    );
  }
});

test("#2555: a generator without an expiry or with a non-boolean flag is REJECTED", () => {
  const noExpiry = { ...otpConverged.secretGenerator, expiry: undefined };
  assert.throws(() => assertLoginOtpGeneratorConverged(noExpiry, 6), /expiry/);
  assert.throws(
    () =>
      assertLoginOtpGeneratorConverged(
        { ...otpConverged.secretGenerator, includeDigits: "true" },
        6,
      ),
    /includeDigits is present but not a boolean/,
  );
});

test("#2555: a non-object read-back is REJECTED", () => {
  assert.throws(
    () => assertLoginOtpGeneratorConverged(null, 6),
    IdpPolicyError,
  );
  assert.throws(
    () => assertLoginOtpGeneratorConverged("<html>", 6),
    IdpPolicyError,
  );
});

test("#2555: the operator line names the generator, length and expiry", () => {
  const line = formatLoginOtpGenerator(
    "SECRET_GENERATOR_TYPE_OTP_SMS",
    assertLoginOtpGeneratorConverged(otpConverged, 6),
  );
  assert.match(
    line,
    /SECRET_GENERATOR_TYPE_OTP_SMS: length=6 upper letters \+ digits, expiry 300s/,
  );
});
