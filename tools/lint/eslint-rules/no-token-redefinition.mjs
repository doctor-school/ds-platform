/**
 * no-token-redefinition — Layer-3 enforcement of the design-system styling
 * contract (#234, spec §4 level 3: "forbid token redefinition outside
 * @ds/design-system").
 *
 * WHY: the design tokens (the `--color-*`, `--space-*`, `--spacing-*`, `--font-*`,
 * `--radius-*`, `--shadow-*`, … CSS custom properties) are generated from the
 * DTCG source by Style Dictionary and are the platform single-source-of-truth
 * (#233). Their VALUES must change in exactly one place: the token source. If an
 * app re-declares a token variable — `style={{ "--color-primary": "#f00" }}`,
 * `el.style.setProperty("--space-4", "13px")`, `node.style["--radius-md"] = …` —
 * it forks the SoT silently: the brand, dark-mode, and the lint guardrails all
 * still believe the generated value holds. This rule makes re-defining a known
 * design-token variable *impossible to ship* in app code.
 *
 * SINGLE SOURCE: the protected variable set is DERIVED at load time from
 * `packages/design-system/src/styles/allowed-tokens.json` (`cssVariables` +
 * `themeKeys`) — the same generated enumeration the styling pipeline emits — so
 * styling and linting share one source of truth (#234 acceptance). No
 * hand-maintained duplicate list.
 *
 * SCOPE: wired in `eslint.config.js` to `apps/**`. The `@ds/design-system`
 * package legitimately *defines* these variables (its generated tokens.css and,
 * rarely, a primitive that maps a token onto a local var) and is out of scope.
 *
 * WHAT IT FLAGS — assigning a value to a design-token custom property via:
 *   • a JSX/object inline-style key:  `style={{ "--color-primary": v }}`
 *   • `setProperty("--token", v)`     (CSSStyleDeclaration.setProperty)
 *   • a computed style assignment:    `el.style["--token"] = v`
 * Reading a token (`var(--color-primary)`, `getPropertyValue("--…")`) is fine —
 * only (re)definition is forbidden.
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/no-token-redefinition -- <reason>`
 * for a deliberate, reviewed local override (rare). Never to fork a token value.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load the generated token-variable enumeration (the SoT) once at module load. */
function loadProtectedVars() {
  const path = join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "design-system",
    "src",
    "styles",
    "allowed-tokens.json",
  );
  const json = JSON.parse(readFileSync(path, "utf8"));
  const set = new Set();
  for (const v of json.cssVariables ?? []) set.add(v);
  for (const v of json.themeKeys ?? []) set.add(v);
  return set;
}

const PROTECTED_VARS = loadProtectedVars();

/** Is `name` a known design-token custom property? */
function isProtectedToken(name) {
  return typeof name === "string" && PROTECTED_VARS.has(name);
}

/** Static string value of a Literal or single-quasi template, else null. */
function staticKey(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid (re)defining a design-token CSS variable (from allowed-tokens.json) in app code via inline style, setProperty, or a style assignment; token values change only in the @ds/design-system token source (#234, spec §4).",
    },
    schema: [],
    messages: {
      tokenRedefinition:
        'Design token "{{name}}" is redefined here, forking the design-system single source of truth (#233/#234). Change the value in the token source (packages/design-system/tokens/*.json) and rebuild, or use an undecorated local variable name. A deliberate local override needs `// eslint-disable-next-line local/no-token-redefinition -- <reason>`.',
    },
  },

  create(context) {
    function reportKey(keyNode) {
      const name = staticKey(keyNode);
      if (isProtectedToken(name)) {
        context.report({
          node: keyNode,
          messageId: "tokenRedefinition",
          data: { name },
        });
      }
    }

    return {
      // Object-literal property key: `{ "--color-primary": … }` (covers React
      // inline `style={{ … }}` and any style object).
      Property(node) {
        if (node.computed && node.key) {
          reportKey(node.key);
        } else if (!node.computed) {
          reportKey(node.key);
        }
      },
      // `foo.style.setProperty("--token", …)`.
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "setProperty" &&
          node.arguments.length >= 1
        ) {
          reportKey(node.arguments[0]);
        }
      },
      // `el.style["--token"] = …` — computed member as an assignment target.
      AssignmentExpression(node) {
        const left = node.left;
        if (
          left &&
          left.type === "MemberExpression" &&
          left.computed &&
          left.property
        ) {
          reportKey(left.property);
        }
      },
    };
  },
};

export default rule;
