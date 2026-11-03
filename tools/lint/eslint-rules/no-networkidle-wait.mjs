/**
 * no-networkidle-wait — e2e wait gate (#3465).
 *
 * WHY: `networkidle` means «no request in flight for 500 ms». A page carrying the
 * real Yandex SmartCaptcha widget never reaches that state when the captcha is
 * slow: the widget iframe fires a Metrika beacon, the iframe switches to
 * `about:blank`, and Playwright never sees the beacon finish — the wait sits
 * until the test timeout (#3229, #3465). The state also says nothing about what
 * a step needs next. A step waits for that instead: an auto-waiting locator /
 * `expect`, `waitForResponse` on a named request, `waitForLoadState("load")`, or
 * the shared `waitForClientReady` helper (`packages/e2e/lib/page-ready.ts`)
 * before an interaction that needs hydrated handlers.
 *
 * Flags the literal `networkidle` passed to `waitForLoadState(...)` or as the
 * `waitUntil` option of a Playwright navigation (`goto`, `waitForURL`,
 * `waitForNavigation`, `reload`, `goBack`, `goForward`, `setContent`).
 *
 * SCOPE: wired in `eslint.config.js` to the shared e2e package
 * (`packages/e2e/**`) at `error`.
 */
const NAVIGATIONS = new Set([
  "goto",
  "waitForURL",
  "waitForNavigation",
  "reload",
  "goBack",
  "goForward",
  "setContent",
]);

function literalValue(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  )
    return node.quasis[0].value.cooked;
  return null;
}

function calleeName(callee) {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow waiting for Playwright `networkidle` in e2e steps (#3465).",
    },
    schema: [],
    messages: {
      networkidle:
        'Do not wait for `networkidle`: the SmartCaptcha widget\'s Metrika beacon never settles, so the wait hangs to the test timeout (#3465). Wait for what the step needs next — an auto-waiting locator/expect, `waitForResponse`, `waitForLoadState("load")`, or `waitForClientReady(page)`.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!name) return;
        if (name === "waitForLoadState") {
          if (literalValue(node.arguments[0]) === "networkidle")
            context.report({
              node: node.arguments[0],
              messageId: "networkidle",
            });
          return;
        }
        if (!NAVIGATIONS.has(name)) return;
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") continue;
          for (const prop of arg.properties) {
            if (
              prop.type === "Property" &&
              !prop.computed &&
              ((prop.key.type === "Identifier" &&
                prop.key.name === "waitUntil") ||
                literalValue(prop.key) === "waitUntil") &&
              literalValue(prop.value) === "networkidle"
            )
              context.report({ node: prop.value, messageId: "networkidle" });
          }
        }
      },
    };
  },
};

export default rule;
