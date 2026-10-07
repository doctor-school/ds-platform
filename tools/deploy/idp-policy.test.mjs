// tools/deploy/idp-policy.test.mjs — the pipeline-owned IdP provision converge
// (Issue #1997, incident #1994). Pure-seam tests: no ssh, no curl, no box. The
// whole read-back decision table runs deterministically on any platform (CI is
// Linux — no drive-letter literals, no repo-root probing).
//
// Run: pnpm test:tools   (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCodeGeneratorConverged,
  assertPasswordPolicyConverged,
  EMAILED_CODE_GENERATOR_TYPES,
  formatCodeGenerator,
  formatPasswordPolicy,
  IdpPolicyError,
  LEGACY_LOGIN_OTP_GENERATOR_TYPES,
  parseEmailedCodeShape,
  parsePasswordMinLength,
  parseVerifyCodeLength,
  resolveEmailedCodeExpectation,
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


// --- emailed/SMS code generators (#2636: six digits; #2555 epic #2552) -------
// Every code a user receives — verify-email, password-reset, login OTP email and
// SMS — is exactly six digits. The deploy reads all four generators back.

const digitsConverged = {
  secretGenerator: {
    generatorType: "SECRET_GENERATOR_TYPE_OTP_EMAIL",
    length: 6,
    expiry: "300s",
    includeDigits: true,
  },
};
const digits6 = { length: 6, alphabet: "digits" };

test("#2636: the deploy reads back ALL FOUR code generators", () => {
  assert.deepEqual(EMAILED_CODE_GENERATOR_TYPES, [
    "SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE",
    "SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE",
    "SECRET_GENERATOR_TYPE_OTP_EMAIL",
    "SECRET_GENERATOR_TYPE_OTP_SMS",
  ]);
  assert.deepEqual(LEGACY_LOGIN_OTP_GENERATOR_TYPES, [
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

test("#2636: a 6-digit generator passes; omitted proto3 `false` flags read as false", () => {
  const verdict = assertCodeGeneratorConverged(digitsConverged, digits6);
  assert.deepEqual(verdict, { length: 6, alphabet: "digits", expiry: "300s" });
  assert.equal(
    assertCodeGeneratorConverged(digitsConverged.secretGenerator, digits6)
      .length,
    6,
  );
});

test("#2636: the former 6-char upper-alnum shape is REJECTED (letters in a code)", () => {
  assert.throws(
    () =>
      assertCodeGeneratorConverged(
        {
          secretGenerator: {
            ...digitsConverged.secretGenerator,
            includeUpperLetters: true,
          },
        },
        digits6,
      ),
    (e) =>
      e instanceof IdpPolicyError &&
      /includeUpperLetters=true, expected false/.test(e.message),
  );
});

test("#2636: the inherited provider default (8 digits) is REJECTED on length", () => {
  assert.throws(
    () =>
      assertCodeGeneratorConverged(
        { secretGenerator: { length: 8, expiry: "300s", includeDigits: true } },
        digits6,
      ),
    /length=8, expected 6/,
  );
});

test("#2636: lower letters, symbols or missing digits are REJECTED", () => {
  for (const flag of ["includeLowerLetters", "includeSymbols"]) {
    assert.throws(
      () =>
        assertCodeGeneratorConverged(
          {
            secretGenerator: {
              ...digitsConverged.secretGenerator,
              [flag]: true,
            },
          },
          digits6,
        ),
      new RegExp(`${flag}=true, expected false`),
    );
  }
  assert.throws(
    () =>
      assertCodeGeneratorConverged(
        { secretGenerator: { length: 6, expiry: "300s" } },
        digits6,
      ),
    /includeDigits=false, expected true/,
  );
});

test("#2555: a generator without an expiry or with a non-boolean flag is REJECTED", () => {
  const noExpiry = { ...digitsConverged.secretGenerator, expiry: undefined };
  assert.throws(() => assertCodeGeneratorConverged(noExpiry, digits6), /expiry/);
  assert.throws(
    () =>
      assertCodeGeneratorConverged(
        { ...digitsConverged.secretGenerator, includeDigits: "true" },
        digits6,
      ),
    /includeDigits is present but not a boolean/,
  );
});

test("#2555: a non-object read-back is REJECTED", () => {
  assert.throws(() => assertCodeGeneratorConverged(null, digits6), IdpPolicyError);
  assert.throws(
    () => assertCodeGeneratorConverged("<html>", digits6),
    IdpPolicyError,
  );
});

test("#2636: an unknown expected alphabet is a programming error, never a pass", () => {
  assert.throws(
    () =>
      assertCodeGeneratorConverged(digitsConverged, {
        length: 6,
        alphabet: "emoji",
      }),
    IdpPolicyError,
  );
});

test("#2636: the operator line names the generator, length, alphabet and expiry", () => {
  const line = formatCodeGenerator(
    "SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE",
    assertCodeGeneratorConverged(digitsConverged, digits6),
  );
  assert.match(
    line,
    /SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE: length=6 digits only, expiry 300s/,
  );
});

// --- the expected code shape comes from the TARGET provision.sh --------------
// provision.sh runs from the deployed commit, so only that commit decides
// whether (and to what) the generators converge. Three target generations:
//   #2636+  EMAILED_CODE_LENGTH      → four generators, digits only
//   #2555   LOGIN_OTP_CODE_LENGTH    → OTP email + SMS, upper letters + digits
//   older   neither                  → skip (PR #2568 Mode (a) blocker)

const provisionDigits = [
  "# ── 8.septies. emailed code format",
  "EMAILED_CODE_LENGTH=6",
  "EMAILED_CODE_GENERATORS=(SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE SECRET_GENERATOR_TYPE_OTP_EMAIL SECRET_GENERATOR_TYPE_OTP_SMS)",
  "",
].join("\n");
const provisionLegacyAlnum = [
  "# ── 8.septies. login OTP code format",
  "LOGIN_OTP_CODE_LENGTH=6",
  "LOGIN_OTP_GENERATORS=(SECRET_GENERATOR_TYPE_OTP_EMAIL SECRET_GENERATOR_TYPE_OTP_SMS)",
  "",
].join("\n");
const provisionWithoutStep = "# ── 9. MFA capability\n";
const schemaSix = "export const VERIFY_CODE_LENGTH = 6;\n";

test("#2636: a target with EMAILED_CODE_LENGTH converges all four generators to digits", () => {
  assert.deepEqual(parseEmailedCodeShape(provisionDigits), {
    length: 6,
    alphabet: "digits",
    generators: EMAILED_CODE_GENERATOR_TYPES,
  });
});

test("#2555: a pre-#2636 target (LOGIN_OTP_CODE_LENGTH) keeps the upper-alnum OTP pair", () => {
  assert.deepEqual(parseEmailedCodeShape(provisionLegacyAlnum), {
    length: 6,
    alphabet: "upper-alnum",
    generators: LEGACY_LOGIN_OTP_GENERATOR_TYPES,
  });
});

test("#2555: a target without the step yields null (no converge)", () => {
  assert.equal(parseEmailedCodeShape(provisionWithoutStep), null);
});

test("#2555: a present but non-numeric length constant is REJECTED, never guessed", () => {
  for (const text of [
    "EMAILED_CODE_LENGTH=${LEN}\n",
    "EMAILED_CODE_LENGTH=0\n",
    "LOGIN_OTP_CODE_LENGTH=${LEN}\n",
  ]) {
    assert.throws(() => parseEmailedCodeShape(text), IdpPolicyError);
  }
  assert.throws(() => parseEmailedCodeShape(42), IdpPolicyError);
});

test("#2636: target WITH the digits step → check all four against its length", () => {
  assert.deepEqual(
    resolveEmailedCodeExpectation({
      provisionText: provisionDigits,
      verifyCodeSchemaText: schemaSix,
    }),
    {
      check: true,
      length: 6,
      alphabet: "digits",
      generators: EMAILED_CODE_GENERATOR_TYPES,
    },
  );
});

test("#2555: target WITHOUT the step → SKIP with a clear reason, VERIFY_CODE_LENGTH not consulted", () => {
  const verdict = resolveEmailedCodeExpectation({
    provisionText: provisionWithoutStep,
    verifyCodeSchemaText: "",
  });
  assert.equal(verdict.check, false);
  assert.match(
    verdict.reason,
    /skipped: target provision\.sh does not converge the code generators/,
  );
});

test("#2555: target whose provision length disagrees with VERIFY_CODE_LENGTH is REJECTED", () => {
  assert.throws(
    () =>
      resolveEmailedCodeExpectation({
        provisionText: provisionDigits,
        verifyCodeSchemaText: "export const VERIFY_CODE_LENGTH = 8;\n",
      }),
    (e) =>
      e instanceof IdpPolicyError &&
      /code length 6/.test(e.message) &&
      /VERIFY_CODE_LENGTH=8/.test(e.message),
  );
});
