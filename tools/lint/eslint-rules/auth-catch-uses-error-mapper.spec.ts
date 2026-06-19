import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./auth-catch-uses-error-mapper.mjs";

/**
 * Unit proof for the `auth-catch-uses-error-mapper` gate (#256).
 *
 * On the auth surfaces a catch that displays an error MUST route the caught error
 * through `authErrorMessage` (which bakes in the EARS-16-generic exception), so an
 * actionable status (429 / 5xx / network) is never flattened to an opaque generic
 * (#175). The "valid" cases prove it does not over-fire (mapped catches + catches
 * that don't display an error pass); the "invalid" cases are the discard defect.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("auth-catch-uses-error-mapper", () => {
  it("flags an error-displaying catch that skips the mapper; allows mapped / non-display catches", () => {
    ruleTester.run("auth-catch-uses-error-mapper", rule, {
      valid: [
        // The sanctioned pattern: the caught error flows through authErrorMessage.
        {
          code: `async function f(){ try { await go(); } catch (err) { setError(authErrorMessage(err, te, te("loginFailed"))); } }`,
        },
        // A differently-named setter still passes when it uses the mapper.
        {
          code: `async function f(){ try { await go(); } catch (err) { setLoginError(authErrorMessage(err, te, te("x"))); } }`,
        },
        // A catch that does not display an error (control-flow fall-through) is fine.
        {
          code: `async function f(){ try { await go(); } catch { return; } }`,
        },
        // A catch that only logs / rethrows, no error-setter — not flagged.
        {
          code: `async function f(){ try { await go(); } catch (err) { console.error(err); throw err; } }`,
        },
        // A non-error state setter is not an error display — not flagged.
        {
          code: `async function f(){ try { await go(); } catch (err) { setLoading(false); } }`,
        },
      ],
      invalid: [
        // The discard defect: a hardcoded generic shown, the error's status dropped.
        {
          code: `async function f(){ try { await go(); } catch (err) { setError(te("loginFailed")); } }`,
          errors: [{ messageId: "discardActionableError" }],
        },
        // A literal generic, error ignored entirely.
        {
          code: `async function f(){ try { await go(); } catch (err) { setError("Что-то пошло не так"); } }`,
          errors: [{ messageId: "discardActionableError" }],
        },
        // Differently-named error setter, still no mapper → flagged.
        {
          code: `async function f(){ try { await go(); } catch (err) { setFormError(te("x")); } }`,
          errors: [{ messageId: "discardActionableError" }],
        },
      ],
    });
  });
});
