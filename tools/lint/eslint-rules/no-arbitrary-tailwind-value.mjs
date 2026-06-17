/**
 * no-arbitrary-tailwind-value — Layer-3 enforcement of the design-system
 * styling contract (#234, spec §4 level 3: "forbid arbitrary Tailwind values in
 * apps/*").
 *
 * WHY: the design system is the platform SoT. Styling must flow through the
 * token-backed Tailwind utilities (`bg-primary`, `p-4`, `rounded-md`, `text-sm`,
 * …), which resolve to the generated tokens. The Tailwind v4 *arbitrary value*
 * escape hatch — `prop-[<literal>]` (e.g. `bg-[#ff5733]`, `p-[13px]`,
 * `text-[15px]`, `rounded-[7px]`, `w-[323px]`) — bypasses that system entirely:
 * it hardcodes a one-off value that is invisible to the token pipeline, the
 * brand, and dark-mode. This rule makes that escape hatch *impossible to ship*
 * in `apps/*`, the same way the other repo gates make an unguarded endpoint or a
 * raw auth field impossible to ship.
 *
 * SCOPE: wired in `eslint.config.js` to apply to `apps/**` JSX/TSX className
 * strings. The `@ds/design-system` package is intentionally NOT in scope — it is
 * the SoT and the one place that legitimately owns primitive component CSS; the
 * component layer there is reviewed by hand and may, narrowly, need a computed
 * dimension. App code never should.
 *
 * COMPLEMENTS, does not duplicate: the color- and scale-specific gates
 * (`tailwindcss/no-hardcoded-colors` via oxlint; `rhythmguard-tailwind/
 * tailwind-class-use-scale` via the rhythmguard ESLint plugin) give a tighter,
 * autofixing message for those two axes. This rule is the broad backstop that
 * also catches the axes those two do not (arbitrary size/width/grid/etc.) so no
 * arbitrary value slips through in app code.
 *
 * ARBITRARY VALUE vs ARBITRARY VARIANT: Tailwind has two bracket syntaxes and
 * only the first is forbidden here:
 *   • arbitrary VALUE — `utility-[literal]` (the bracket closes the utility, e.g.
 *     `bg-[#fff]`, `p-[13px]`). FORBIDDEN.
 *   • arbitrary VARIANT — `variant-[selector]:utility` (the bracket is a
 *     selector and is followed by `:`, e.g. `data-[state=active]:bg-background`,
 *     `has-[:disabled]:opacity-50`, `group-[.is-open]:flex`, `supports-[…]:`,
 *     `aria-[…]:`, `@[…]:`). ALLOWED — these are legitimate conditional styling,
 *     not a hardcoded value, and the design-system primitives use them.
 * The discriminator: a `[...]` group whose closing `]` is NOT followed by `:`
 * (ignoring a trailing `!` important marker / opacity `/<mod>`) is an arbitrary
 * value. A `[...]` group followed by `:` is a variant.
 *
 * Also forbids the arbitrary *property* form `[mask-type:luminance]` (a bare
 * leading `[` with a `:` INSIDE the bracket and no `:` after the `]`), which is
 * the CSS-property escape hatch.
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/no-arbitrary-tailwind-value -- <reason>`
 * on the offending line, for a genuinely unavoidable one-off (justify narrowly).
 * Never use it to dodge adding a token — add the token to the design system.
 */

/** className-bearing JSX attributes we scan. */
const CLASS_ATTRS = new Set(["classname", "class"]);

/**
 * Does a single whitespace-delimited class token contain an arbitrary *value*
 * (not merely an arbitrary variant)? Walks the token left→right tracking bracket
 * depth; a top-level `[...]` group is a VALUE unless the char after its `]`
 * (skipping a `/opacity` modifier and a trailing `!`) is `:` (→ variant).
 */
function hasArbitraryValue(token) {
  let i = 0;
  const n = token.length;
  while (i < n) {
    if (token[i] === "[") {
      // find matching top-level `]`
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (token[j] === "[") depth++;
        else if (token[j] === "]") depth--;
        j++;
      }
      // j now points just past the matching `]` (or n if unbalanced)
      // Look at what follows, skipping a `/<modifier>` then any `!`.
      let k = j;
      if (k < n && token[k] === "/") {
        // opacity / line-height modifier after a bracket value, e.g. bg-[…]/50
        while (k < n && token[k] !== ":" && token[k] !== "[") k++;
      }
      while (k < n && token[k] === "!") k++;
      const isVariant = k < n && token[k] === ":";
      if (!isVariant) return true;
      // It's a variant prefix — continue scanning the rest of the token (the
      // utility after the `:` may itself carry an arbitrary value).
      i = k + 1;
      continue;
    }
    i++;
  }
  return false;
}

/** Scan a class string, returning true if any class token uses an arbitrary value. */
function classStringHasArbitraryValue(value) {
  for (const token of value.split(/\s+/)) {
    if (token && hasArbitraryValue(token)) return true;
  }
  return false;
}

/**
 * Collect every static string fragment inside a className value: a plain string
 * literal, a template literal's quasis, and string literals nested in a call
 * (`cn("…", cond && "…")`) or conditional/logical expression. We only inspect
 * static text — a fully dynamic expression cannot be statically classified and
 * is left to runtime, the same conservative stance the other class linters take.
 */
function collectStaticStrings(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(node.value);
      break;
    case "TemplateLiteral":
      for (const q of node.quasis) out.push(q.value.cooked ?? q.value.raw);
      for (const e of node.expressions) collectStaticStrings(e, out);
      break;
    case "JSXExpressionContainer":
      collectStaticStrings(node.expression, out);
      break;
    case "CallExpression":
      for (const arg of node.arguments) collectStaticStrings(arg, out);
      break;
    case "ConditionalExpression":
      collectStaticStrings(node.consequent, out);
      collectStaticStrings(node.alternate, out);
      break;
    case "LogicalExpression":
      collectStaticStrings(node.left, out);
      collectStaticStrings(node.right, out);
      break;
    case "ArrayExpression":
      for (const el of node.elements) collectStaticStrings(el, out);
      break;
    default:
      break;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid Tailwind arbitrary VALUES (e.g. bg-[#ff5733], p-[13px], rounded-[7px]) in app className strings; style only via the token-backed utilities of @ds/design-system (#234, spec §4). Arbitrary VARIANTS (data-[…]:, has-[…]:) are allowed.",
    },
    schema: [],
    messages: {
      arbitraryValue:
        "Tailwind arbitrary value in className bypasses the design-system token pipeline. Use a token-backed utility (e.g. `p-4`, `bg-primary`, `rounded-md`, `text-sm`) instead — or add the value to the design tokens. A genuine one-off needs `// eslint-disable-next-line local/no-arbitrary-tailwind-value -- <reason>`.",
    },
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          !CLASS_ATTRS.has(node.name.name.toLowerCase())
        ) {
          return;
        }
        const strings = [];
        collectStaticStrings(node.value, strings);
        for (const s of strings) {
          if (classStringHasArbitraryValue(s)) {
            context.report({ node, messageId: "arbitraryValue" });
            return;
          }
        }
      },
    };
  },
};

export default rule;
