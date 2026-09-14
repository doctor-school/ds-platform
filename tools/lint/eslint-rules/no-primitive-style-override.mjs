/**
 * no-primitive-style-override — the system-wide "hosts never style primitives"
 * contract (#2180, ADR-0013 §6 Enforcement; tech spec
 * `2026-09-07-one-code-two-storefronts-plan-en.md` §3/§5).
 *
 * WHY: one code, two storefronts. The geometry, typography, colour and borders
 * of a design element must live in exactly ONE place — the `@ds/design-system`
 * primitive — so a token or a geometry change reaches both storefronts by
 * construction. The moment a host (or a shared block) re-tunes a primitive at
 * the call site (`<DsLink className="px-6 py-3">`), that surface forks: the
 * next change to the primitive silently stops reaching it, and the two
 * storefronts drift apart exactly where they are supposed to be identical. The
 * #2180 auth chip is the ledger case — the two headers had hand-tuned the same
 * control differently.
 *
 * RELATION TO `primitives-first-lint.ts` (#828/#1103): that guard is the
 * app-surface, Button/Link-only, "at least one strong utility" heuristic. This
 * rule is the BLOCK generalisation the owner asked for on 2026-09-14 — EVERY DS
 * primitive, the shared chrome packages included, and an ALLOW-list posture
 * (positional utilities only) instead of a deny-list of strong ones. The two
 * overlap on `apps/**` Button/Link by design: the ESLint rule is the
 * editor-time, blocking surface; the tsx guard keeps its ledger-calibrated
 * reporting.
 *
 * WHAT IT CHECKS. In host and shared-chrome source (wired in `eslint.config.js`:
 * `apps/**` plus `packages/{storefront-shell,events-storefront,room}/src/**`;
 * NOT `packages/design-system/**` — the primitives legitimately own their own
 * styling — and not tests or the showcase):
 *
 * (1) PRIMITIVE OVERRIDE. A JSX element whose name resolves to an import from
 *     `@ds/design-system` (or `@ds/design-system/*`), under any local alias and
 *     including member access (`Card.Header`), whose `className` carries a
 *     utility outside the POSITIONAL allow-list. Reported per offending
 *     utility; the message names `variant` / `size` / `tone` as the only knob.
 *
 * (2) RAW INTERACTIVE ELEMENT. A raw `<a|button|input|select|textarea|summary>`
 *     in the same scope whose `className` carries a non-positional utility:
 *     that is a primitive being hand-assembled. Use the DS primitive.
 *
 * The POSITIONAL allow-list is where the element SITS, never what it LOOKS
 * like: external `m*-*`, `order-*`, display, `flex-*`, `shrink|grow`, `self-*`,
 * `justify-self-*`, `col-*|row-*`, position/inset/z, `w-full|max-w-*|min-w-*`,
 * `whitespace-*`, `sr-only`, `pointer-events-*`, child alignment
 * (`items-*|justify-*|content-*|place-*`) and text ALIGNMENT
 * (`text-left|center|right`) — the last two mirroring the WEAK set that
 * `primitives-first-lint.ts` already sanctions, so the two guards never
 * disagree. Any responsive / theme / state prefix (`layout:`, `md:`, `dark:`,
 * `hover:`) is stripped before the check, so it neither grants nor removes
 * permission: `md:ml-auto` is allowed, `layout:text-lg` is still a type-size
 * override.
 *
 * Everything else — spacing INSIDE the element (`p*-`, `gap-`, `space-`), sizing (`h-`,
 * `size-`, `min-h-`, `w-<n>`), typography (`text-<size>`, `font-`, `tracking-`,
 * `leading-`), colour (`bg-`, `text-<colour>`, `border-<colour>`), borders
 * (`border*`, `rounded*`), `shadow*`, `opacity-`, `transition*`, `translate-*`
 * — is an ERROR. Add the variant to the primitive instead; never invent a size
 * that no canvas backs.
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/no-primitive-style-override
 * -- <reason with Issue #N>`. ESLint performs the suppression itself; what this
 * rule adds is a report on a BARE directive — one with no `-- <reason>` —
 * because an undocumented fork is the failure mode the rule exists to prevent.
 * That report sits on the COMMENT line, which a `-next-line` / `-line` directive
 * does not cover; a file-wide `/* eslint-disable local/… *\/` does suppress it,
 * so the reason contract is enforced on the per-line form the repo uses.
 */

/** Raw tags that are a DS primitive hand-assembled (mirrors primitives-first-lint rule 1). */
const RAW_INTERACTIVE = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

/** Utilities that place an element without describing it. Everything else the primitive owns. */
const POSITIONAL = [
  // EXTERNAL margin, `auto` included. Margin places the element in its PARENT;
  // it never changes what the primitive looks like (padding does, and stays an
  // error). This matches the WEAK set of `primitives-first-lint.ts`, so the two
  // guards agree on the same call sites.
  /^-?m[ltrbxyse]?-/,
  /^-?order-/,
  /^(hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table|flow-root)$/,
  /^flex-/,
  /^basis-/,
  /^(shrink|grow)(-.+)?$/,
  /^self-/,
  /^justify-self-/,
  /^place-self-/,
  /^(col|row)-(span|start|end|auto)/,
  /^(static|fixed|absolute|relative|sticky)$/,
  /^-?(inset|top|right|bottom|left)-/,
  /^-?z-/,
  // Layout size: fill / fraction / intrinsic width and full height stretch the
  // element to its PARENT, they do not choose a geometry (`h-<n>`, `size-<n>`,
  // `w-<n>` do, and stay errors).
  /^w-(full|auto|screen|\d+\/\d+)$/,
  /^(max-w|min-w)-/,
  /^(h|min-h)-full$/,
  // Container layout: the grid template is the same axis as `flex-*` above.
  /^(grid-cols|grid-rows|grid-flow|auto-cols|auto-rows)-/,
  // Clipping/scroll is behaviour, not look.
  /^overflow(-x|-y)?-/,
  /^whitespace-/,
  /^(sr-only|not-sr-only)$/,
  /^pointer-events-/,
  // Child alignment + text ALIGNMENT: the WEAK/positional set that
  // primitives-first-lint already sanctions (#1103), kept identical so the two
  // guards never disagree.
  /^items-/,
  /^justify-(start|end|center|between|around|evenly|normal|stretch)$/,
  /^content-(start|end|center|between|around|evenly|normal|stretch|baseline)$/,
  /^place-(items|content)-/,
  /^text-(left|center|right|justify|start|end)$/,
  /^(truncate|line-clamp-.+)$/,
];

const RULE_NAME = "local/no-primitive-style-override";

/** Strip every responsive / theme / state variant prefix (`md:`, `dark:`, `group-hover:`). */
function baseUtility(token) {
  let rest = token;
  // A variant prefix is `<variant>:`; an arbitrary variant (`data-[x]:`) carries
  // its own punctuation, so consume up to the LAST colon.
  const idx = rest.lastIndexOf(":");
  if (idx >= 0) rest = rest.slice(idx + 1);
  // `!p-4` (important) keeps its axis; a negative `-` is handled by the patterns.
  if (rest.startsWith("!")) rest = rest.slice(1);
  return rest;
}

function isPositional(token) {
  const base = baseUtility(token);
  if (base === "") return true;
  return POSITIONAL.some((re) => re.test(base));
}

/** Split a className fragment into candidate utilities. */
function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

/** Collect the static className fragments of an expression (`cn(...)`, templates, conditionals). */
function collectFragments(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(node.value);
      break;
    case "TemplateLiteral":
      for (const quasi of node.quasis) out.push(quasi.value.cooked ?? quasi.value.raw);
      for (const expr of node.expressions) collectFragments(expr, out);
      break;
    case "CallExpression":
      // `cn(…)` / `clsx(…)` / `cx(…)` / `twMerge(…)` and any other joiner: the
      // arguments are className fragments.
      for (const arg of node.arguments) collectFragments(arg, out);
      break;
    case "ConditionalExpression":
      collectFragments(node.consequent, out);
      collectFragments(node.alternate, out);
      break;
    case "LogicalExpression":
      collectFragments(node.left, out);
      collectFragments(node.right, out);
      break;
    case "ArrayExpression":
      for (const element of node.elements) collectFragments(element, out);
      break;
    case "ObjectExpression":
      // `cn({ "px-4": cond })` — the KEY is the utility.
      for (const prop of node.properties) {
        if (prop.type === "Property") collectFragments(prop.key, out);
      }
      break;
    case "TSAsExpression":
    case "TSNonNullExpression":
      collectFragments(node.expression, out);
      break;
    default:
      break;
  }
}

/** The root identifier of a JSX element name (`Card.Header` gives `Card`). */
function rootName(nameNode) {
  if (!nameNode) return null;
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return rootName(nameNode.object);
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Hosts and shared blocks consume @ds/design-system primitives through their variant/size/tone props and positional utilities only; geometry, typography, colour and borders live in the primitive (#2180, ADR-0013 §6).",
    },
    schema: [],
    messages: {
      primitiveStyleOverride:
        "Utility \"{{token}}\" restyles the design-system primitive <{{name}}> at the call site, forking its look for this surface only — the next token or geometry change stops reaching it and the two storefronts drift (#2180, ADR-0013 §6). The `variant` / `size` / `tone` props of the primitive are the ONLY knob: pass one, or add the variant to the primitive in `packages/design-system` (a new size needs a canvas that backs its geometry — never invent one). Positional utilities (ml-auto, hidden, flex-1, w-full, z-10) stay allowed. A reviewed exception needs `// eslint-disable-next-line local/no-primitive-style-override -- <reason with Issue #N>`.",
      useDsPrimitive:
        "Utility \"{{token}}\" styles a raw <{{name}}>, hand-assembling a control the design system owns (#2180, ADR-0013 §6). Use the `@ds/design-system` primitive (Button / Link / Input / NativeSelect / …) and pick its `variant` / `size` / `tone`; a raw tag may carry positional utilities only. A reviewed exception needs `// eslint-disable-next-line local/no-primitive-style-override -- <reason with Issue #N>`.",
      disableNeedsReason:
        "A bare `eslint-disable` of local/no-primitive-style-override hides a design-system fork with no record of why. Give it a reason: `// eslint-disable-next-line local/no-primitive-style-override -- <reason with Issue #N>`.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    /** Local names imported from `@ds/design-system`. */
    const dsLocals = new Set();

    // Its own disable directives: ESLint itself performs the suppression (this
    // rule must NOT, or every reasoned disable would then read as an UNUSED
    // directive). What the rule adds is the demand for a reason.
    for (const comment of sourceCode.getAllComments()) {
      const text = comment.value;
      const match = /eslint-disable(-next-line|-line)?\s+([\s\S]*)/.exec(text);
      if (!match) continue;
      const [ruleList, ...reasonParts] = match[2].split(" -- ");
      if (!ruleList.includes(RULE_NAME)) continue;
      const reason = reasonParts.join(" -- ").trim();
      if (reason === "") {
        context.report({ loc: comment.loc, messageId: "disableNeedsReason" });
      }
    }

    function report(node, messageId, token, name) {
      context.report({ node, messageId, data: { token, name } });
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          typeof source !== "string" ||
          !(source === "@ds/design-system" || source.startsWith("@ds/design-system/"))
        ) {
          return;
        }
        for (const spec of node.specifiers) dsLocals.add(spec.local.name);
      },

      JSXOpeningElement(node) {
        const name = rootName(node.name);
        if (!name) return;
        const isDs = dsLocals.has(name);
        const isRaw = RAW_INTERACTIVE.has(name);
        if (!isDs && !isRaw) return;

        const attr = node.attributes.find(
          (a) =>
            a.type === "JSXAttribute" &&
            a.name.type === "JSXIdentifier" &&
            a.name.name === "className",
        );
        if (!attr || !attr.value) return;

        const fragments = [];
        if (attr.value.type === "Literal") {
          collectFragments(attr.value, fragments);
        } else if (attr.value.type === "JSXExpressionContainer") {
          collectFragments(attr.value.expression, fragments);
        }

        const seen = new Set();
        for (const fragment of fragments) {
          for (const token of tokenize(fragment)) {
            if (isPositional(token) || seen.has(token)) continue;
            seen.add(token);
            report(attr, isDs ? "primitiveStyleOverride" : "useDsPrimitive", token, name);
          }
        }
      },
    };
  },
};

export default rule;
