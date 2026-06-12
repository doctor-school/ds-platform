/**
 * no-raw-auth-field-input — Layer-1 enforcement of EARS-22 (003 design §8.2, #197).
 *
 * WHY: portal auth forms used to be assembled from a raw design-system `<Input>`
 * plus a per-form loose resolver, so the validation + input mask relevant to a
 * credential field (identifier / email / phone / OTP / password) was hand-wired at
 * every call site — and forgetting it was the *default* failure mode, not the
 * exception. That is exactly how the live defects #192 (`/login` identifier) and
 * #196 (`/reset` identifier) happened: an identifier box with no union validation
 * and no phone mask. This rule makes an unvalidated/unmasked credential field
 * *impossible to render* on the auth surfaces, the same way
 * `tools/lint/endpoint-authz-lint.ts` makes an unguarded endpoint impossible to
 * ship: such a field MUST come from the semantic primitive registry
 * (`apps/portal/components/fields` — `<EmailField>`, `<PhoneField>`, `<OtpField>`,
 * `<PasswordField>`, `<IdentifierField>`), which bake the validation/mask/a11y in.
 *
 * SCOPE: wired in `eslint.config.js` to apply ONLY to the auth surfaces
 * (`apps/portal/app/{login,register,verify,reset,account}/**` .tsx). It flags both
 * a raw design-system `<Input>` (uppercase component) AND a raw lowercase HTML
 * `<input>` whose props read as a credential field — a lowercase `<input>` would
 * otherwise be an open hole in the "impossible to render" guarantee (the
 * design-system `<Input>` ultimately renders one, so hand-rolling the native
 * element must not be an escape from the gate). A genuinely free-form input
 * (a search/name box) that matches none of the heuristics is intentionally NOT
 * flagged, whichever casing it uses.
 *
 * HEURISTIC — a raw `<Input>` is treated as a credential field when ANY holds:
 *   • `type="password"`
 *   • `autoComplete` ∈ {username, current-password, new-password, email, tel,
 *     one-time-code}
 *   • `inputMode` ∈ {email, tel, numeric}
 *   • a `name` / `data-testid` / `placeholder` literal that reads as an
 *     identifier / email / phone / otp / code / password.
 *
 * ESCAPE HATCH: a standard `// eslint-disable-next-line local/no-raw-auth-field-input -- <reason>`
 * on the offending line. Use it only for a genuinely free-form field that the
 * heuristic misfires on, with a one-line reason — never to dodge wiring a real
 * credential field, which is what the primitives are for.
 */

const CREDENTIAL_AUTOCOMPLETE = new Set([
  "username",
  "current-password",
  "new-password",
  "email",
  "tel",
  "one-time-code",
]);

const CREDENTIAL_INPUTMODE = new Set(["email", "tel", "numeric"]);

// Substrings that, in a `name` / `data-testid` / `placeholder`, read as a
// credential field. Kept conservative: matches the auth vocabulary, not generic
// words, so an ordinary free-form input is not swept up.
const CREDENTIAL_NAME_PATTERN =
  /(identifier|e-?mail|phone|tel|otp|one-?time|password|passwd|\bcode\b|newpassword)/i;

/** The element names we gate: the design-system export `Input` (uppercase) and the
 * native HTML `input` (lowercase). Either can carry a credential field, so both
 * must be checked — gating only `Input` would let a hand-rolled `<input>` bypass
 * the guarantee. */
const GATED_ELEMENTS = new Set(["Input", "input"]);

/** Read a JSX attribute's static string value, or null if absent / non-literal. */
function attrStringValue(attr) {
  if (!attr || attr.type !== "JSXAttribute" || !attr.value) return null;
  if (attr.value.type === "Literal" && typeof attr.value.value === "string") {
    return attr.value.value;
  }
  // `prop={"x"}` — a JSX expression wrapping a string literal.
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    return attr.value.expression.value;
  }
  return null;
}

/** Collect the plain JSXAttributes of an opening element, keyed by lowercased name. */
function indexAttrs(openingElement) {
  const byName = new Map();
  for (const attr of openingElement.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") {
      continue;
    }
    byName.set(attr.name.name.toLowerCase(), attr);
  }
  return byName;
}

function looksLikeCredentialField(byName) {
  // type="password"
  if (attrStringValue(byName.get("type")) === "password") return true;

  const autoComplete = attrStringValue(byName.get("autocomplete"));
  if (autoComplete && CREDENTIAL_AUTOCOMPLETE.has(autoComplete)) return true;

  const inputMode = attrStringValue(byName.get("inputmode"));
  if (inputMode && CREDENTIAL_INPUTMODE.has(inputMode)) return true;

  // name / data-testid / placeholder reading as a credential.
  for (const key of ["name", "data-testid", "placeholder"]) {
    const v = attrStringValue(byName.get(key));
    if (v && CREDENTIAL_NAME_PATTERN.test(v)) return true;
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a raw design-system <Input> or native <input> for a credential field (identifier/email/phone/otp/password) on the portal auth surfaces; use the semantic field primitives instead (EARS-22, #197).",
    },
    schema: [],
    messages: {
      rawAuthField:
        "Credential field rendered with a raw <Input>/<input>: validation/mask is hand-wired and can be forgotten (#192/#196). Use the semantic primitive from `@/components/fields` (EmailField / PhoneField / OtpField / PasswordField / IdentifierField). A genuinely free-form field needs `// eslint-disable-next-line local/no-raw-auth-field-input -- <reason>`.",
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          !GATED_ELEMENTS.has(node.name.name)
        ) {
          return;
        }
        const byName = indexAttrs(node);
        if (looksLikeCredentialField(byName)) {
          context.report({ node, messageId: "rawAuthField" });
        }
      },
    };
  },
};

export default rule;
