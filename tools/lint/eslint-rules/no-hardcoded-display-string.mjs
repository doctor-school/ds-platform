/**
 * no-hardcoded-display-string — RU-i18n coverage gate (#256, epic #247 Theme).
 *
 * WHY: the recurring "почему всё на английском?" defect class (#192/#196/#200/
 * #211/#212; memory `feedback_verify_every_field_kind_every_surface`,
 * `reference_zod_v4_schema_message_beats_error_map`) is, at root, user-facing copy
 * that did NOT flow through the i18n catalog — an English string baked into JSX or
 * a field prop instead of `t("…")`. A naive *language* detector over rendered
 * strings is brittle (false positives on brand names, units, technical terms,
 * intentionally-English identifiers — exactly the brittleness #251 deferred this
 * gate over). This rule sidesteps language detection entirely: it forbids a
 * hardcoded human-readable string in the first place, so every display string is
 * forced through the next-intl catalog. With the portal single-locale (RU)
 * (`apps/portal/i18n/request.ts`), "is it Russian?" collapses to a catalog-
 * completeness property the catalog already guarantees — no per-string guessing.
 *
 * SCOPE: wired in `eslint.config.js` to the portal auth surfaces
 * (`apps/portal/app/{login,register,verify,reset,account}/**` .tsx) — the same
 * surfaces as `no-raw-auth-field-input`, where the defect class actually lives and
 * where #237 rebuilds the UI. Widening to `promo`/`admin` is purely additive once
 * those apps carry catalogued copy rather than scaffold text (today they would
 * force noisy suppressions, which would defeat a reliable gate).
 *
 * WHAT IT FLAGS:
 *   1. JSXText with human-readable content — any text node carrying a letter
 *      (`\p{L}`), e.g. `<CardTitle>Sign in</CardTitle>` or `<p>Привет</p>`.
 *      Whitespace / punctuation / entity-only text is ignored. Catalogued copy is
 *      a `{t("…")}` expression (a JSXExpressionContainer), never JSXText, so clean
 *      code is untouched.
 *   2. A user-facing string-literal ATTRIBUTE — `placeholder`, `aria-label`,
 *      `title`, `alt`, `label` — when the value is a string literal rather than an
 *      expression. Clean code passes `label={tc("email")}` /
 *      `placeholder={tc("emailPlaceholder")}` (expressions); a literal
 *      `label="Email"` is the leak. Non-copy attributes (`data-testid`,
 *      `className`, `href`, `name`, `type`, `role`, `autoComplete`, `inputMode`,
 *      `id`, `value`…) are deliberately NOT checked.
 *
 * ESCAPE HATCH: a standard
 * `// eslint-disable-next-line local/no-hardcoded-display-string -- <reason>` on
 * the offending line, for a genuinely non-copy string the heuristic misfires on
 * (a technical token rendered verbatim). Never to dodge cataloguing real copy.
 */

/** Attributes whose value is shown to (or read to) the user — must be catalogued. */
const USER_FACING_ATTRS = new Set([
  "placeholder",
  "aria-label",
  "title",
  "alt",
  "label",
]);

/** True when the text carries at least one letter (human-readable copy), as
 * opposed to whitespace, punctuation, digits, or entity glue between elements. */
function hasLetter(text) {
  return /\p{L}/u.test(text);
}

/** Read a JSX attribute's static string value, or null if absent / non-literal.
 * Mirrors the helper in `no-raw-auth-field-input.mjs`: a bare string literal or a
 * `{"x"}` expression-wrapped literal counts as hardcoded; anything else (a
 * `{t(...)}` call, a variable, a template with expressions) is treated as dynamic
 * and left alone. */
function attrStringLiteral(attr) {
  if (!attr || attr.type !== "JSXAttribute" || !attr.value) return null;
  if (attr.value.type === "Literal" && typeof attr.value.value === "string") {
    return attr.value.value;
  }
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    return attr.value.expression.value;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid hardcoded human-readable copy (JSX text or a user-facing string attribute) on the portal auth surfaces; every display string must come from the next-intl catalog via t() (#256).",
    },
    schema: [],
    messages: {
      hardcodedText:
        "Hardcoded display text. User-facing copy must come from the next-intl catalog (`{t(\"…\")}`), not a literal — that is how RU coverage is guaranteed and the English-leak class (#200/#211) is prevented. Move it into `apps/portal/messages/ru.json`. A genuine non-copy token needs `// eslint-disable-next-line local/no-hardcoded-display-string -- <reason>`.",
      hardcodedAttr:
        'Hardcoded `{{attr}}` copy. A user-facing attribute (placeholder/aria-label/title/alt/label) must come from the catalog (e.g. `{{attr}}={t("…")}`), not a string literal (#256). A genuine non-copy value needs `// eslint-disable-next-line local/no-hardcoded-display-string -- <reason>`.',
    },
  },

  create(context) {
    return {
      JSXText(node) {
        if (hasLetter(node.value)) {
          context.report({ node, messageId: "hardcodedText" });
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const attrName = node.name.name.toLowerCase();
        if (!USER_FACING_ATTRS.has(attrName)) return;
        const literal = attrStringLiteral(node);
        if (literal !== null && hasLetter(literal)) {
          context.report({
            node,
            messageId: "hardcodedAttr",
            data: { attr: attrName },
          });
        }
      },
    };
  },
};

export default rule;
