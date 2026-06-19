/**
 * auth-catch-uses-error-mapper — actionable-errors gate (#256, epic #247 Theme).
 *
 * WHY: every portal auth call throws `AuthError{ status, message }` on a non-2xx,
 * but the pages historically DISCARDED the status and showed one hardcoded generic
 * for every failure — so a 429 rate-limit looked identical to a wrong password
 * (GH #175; memory `feedback_actionable_errors_except_enumeration`). The fix
 * (#175) centralised the correct mapping in `authErrorMessage(err, t, generic)`:
 * 429 → "too many attempts", 5xx/network → "unavailable", and ONLY the auth
 * OUTCOME (400/401) stays EARS-16-generic to avoid an enumeration oracle. The
 * recurring deviation is a NEW catch block that surfaces an error WITHOUT routing
 * the caught error through that mapper — re-introducing the opaque-generic defect.
 *
 * A blunt "no generic error" gate would fight the EARS-16 exception; a brittle
 * allowlist of "generic-ok" surfaces would rot. This rule encodes the exception
 * the reliable way: it does not judge the message at all — it mandates that a
 * catch which DISPLAYS an error consult `authErrorMessage`, whose body already
 * bakes in the EARS-16 rule. Encode the exception once, in the helper; enforce
 * "you must use the helper" here.
 *
 * The fully-silent discard (`catch (e) { showGeneric() }` with `e` unreferenced)
 * is already caught repo-wide by `@typescript-eslint/no-unused-vars` with its
 * default `caughtErrors: "all"`. This rule adds the subtler, higher-value case:
 * the error is in scope but a hardcoded generic is shown instead of the mapper.
 *
 * SCOPE: wired in `eslint.config.js` to the portal auth surfaces
 * (`apps/portal/app/{login,register,verify,reset,account}/**` .tsx) — the only
 * place `AuthError` is thrown and caught, and where #237 rebuilds the UI.
 *
 * HEURISTIC: a `catch` clause is flagged when its body calls an error-display
 * setter (an identifier matching `/^set[A-Za-z]*[Ee]rror$/`, e.g. `setError`,
 * `setLoginError`) but contains NO call to `authErrorMessage`. A catch that does
 * not display an error (cleanup, control-flow fall-through, rethrow) is never
 * flagged.
 *
 * ESCAPE HATCH: a standard
 * `// eslint-disable-next-line local/auth-catch-uses-error-mapper -- <reason>` for
 * a genuine case where a non-mapped message is correct (rare). Never to dodge
 * surfacing an actionable error.
 */

/** An error-display state setter: `setError`, `setLoginError`, `setFormError`… */
const ERROR_SETTER_RE = /^set[A-Za-z]*[Ee]rror$/;

const MAPPER_NAME = "authErrorMessage";

/** Recursively visit every CallExpression in an AST subtree. Self-contained (no
 * estraverse dep): walks own enumerable node/array properties, skipping the
 * `parent` back-reference and non-AST values. */
function forEachCall(node, visit) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "CallExpression") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") forEachCall(child, visit);
      }
    } else if (value && typeof value.type === "string") {
      forEachCall(value, visit);
    }
  }
}

/** The simple identifier name of a call's callee, or null. */
function calleeName(call) {
  return call.callee.type === "Identifier" ? call.callee.name : null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "On the portal auth surfaces, a catch clause that displays an error must route the caught error through authErrorMessage (which bakes in the EARS-16-generic exception), never discard its actionable status for a hardcoded generic (#175, #256).",
    },
    schema: [],
    messages: {
      discardActionableError:
        "This catch displays an error without `authErrorMessage`. Routing the caught error through it surfaces an actionable message (429 → too-many-attempts, 5xx/network → unavailable) while keeping the auth OUTCOME EARS-16-generic — discarding the error re-introduces the opaque-generic defect (#175). Use `setError(authErrorMessage(err, te, te(\"…\")))`, or `// eslint-disable-next-line local/auth-catch-uses-error-mapper -- <reason>` for a genuine exception.",
    },
  },

  create(context) {
    return {
      CatchClause(node) {
        const setters = [];
        let usesMapper = false;
        forEachCall(node.body, (call) => {
          const name = calleeName(call);
          if (name === MAPPER_NAME) usesMapper = true;
          else if (name && ERROR_SETTER_RE.test(name)) setters.push(call);
        });
        if (setters.length > 0 && !usesMapper) {
          for (const setter of setters) {
            context.report({ node: setter, messageId: "discardActionableError" });
          }
        }
      },
    };
  },
};

export default rule;
