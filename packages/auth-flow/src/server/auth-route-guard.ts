import { redirect } from "next/navigation";

import type { AuthFlowRoutes } from "../host-config";

/**
 * The ONE authenticated-visitor guard of the shared auth flow (wave-1 gate rows
 * 26-28, Q3; #2027 PR 1.4).
 *
 * The RULE is #675: a visitor who already holds a session must not be able to
 * re-walk the register/verify/login flow, and must never be shown an auth form.
 * `/reset` is the deliberate exemption 003 EARS-28 pins - the `/account`
 * change-password action is a handoff to the existing reset flow, so a signed-in
 * doctor has to be able to complete it there (completing a reset revokes all
 * sessions and auto-logs-in with the new password, EARS-12, so the authenticated
 * pass through `/reset` ends in a coherent state and nothing is re-walked).
 *
 * What #2027 changes is WHERE the decision is taken. The Academy decided it in a
 * client `useEffect` that read `GET /v1/auth/session` after mount, which means
 * the surface rendered nothing at all while the read was in flight (there is no
 * way to know the branch before it resolves), and the doctor host decided it in
 * page code of its own. Both hosts now resolve the session on the SERVER and ask
 * this one function, so the answer is known before paint - no pending frame, no
 * second mechanism, and no room for one host to drift from the other.
 *
 * The decision is a PURE function and the `redirect` effect is a wrapper over
 * it. That split is what makes the rule testable as a rule: the exemption list,
 * the trailing-slash normalisation and the landing precedence are asserted
 * directly, rather than through a thrown framework control-flow signal.
 */

/** What the host surface must do with THIS request. */
export type AuthRouteGuardDecision =
  | { action: "render" }
  | { action: "redirect"; to: string };

export type AuthRouteGuardInput = {
  /** The resolved server-side auth state, already read once for this request. */
  readonly authenticated: boolean;
  /** The pathname being served, as the host framework reports it. */
  readonly pathname: string;
  /** This host route table - the exemption list lives on it (row 27). */
  readonly routes: AuthFlowRoutes;
  /**
   * The landing the surrounding flow already resolved for this visitor (a
   * carried `returnTo`, a specialty-aware landing). `undefined` or `null` falls
   * back to `routes.account`, which is the #675 destination.
   */
  readonly landing?: string | null;
};

/**
 * Compare two paths as ROUTES rather than as strings: `/login` and `/login/`
 * address the same surface, and letting the trailing slash decide would hand an
 * authenticated visitor the very form the guard exists to withhold.
 */
function samePath(a: string, b: string): boolean {
  const normalise = (path: string) =>
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return normalise(a) === normalise(b);
}

/**
 * Rows 26-28 - decide whether this auth route may be rendered to this visitor.
 *
 * A guest is always rendered: the guard withholds nothing from the people the
 * auth surfaces exist for. An authenticated visitor is rendered only the routes
 * this host states on `routes.allowAuthenticated`; everything else sends them to
 * the resolved landing, and to `routes.account` when there is none.
 *
 * The exemption is host DATA, not a package literal: `/reset` is exempt on both
 * storefronts today for the EARS-28 reason above, but a host that serves its
 * reset flow elsewhere - or serves none - says so in its own config instead of
 * the package guessing.
 */
export function resolveAuthRouteGuard(
  input: AuthRouteGuardInput,
): AuthRouteGuardDecision {
  if (!input.authenticated) return { action: "render" };
  const exempt = input.routes.allowAuthenticated.some((allowed) =>
    samePath(allowed, input.pathname),
  );
  if (exempt) return { action: "render" };
  return { action: "redirect", to: input.landing ?? input.routes.account };
}

/**
 * The effect half: take the decision and, when it is a redirect, hand it to
 * Next, which throws its own control-flow signal and never returns.
 *
 * Called FIRST THING by each host auth route, from server code, so the redirect
 * happens before any of the surface is rendered. `redirectImpl` is injected only
 * by this module own test - production callers pass nothing.
 */
export function guardAuthRoute(
  input: AuthRouteGuardInput,
  redirectImpl: (to: string) => never = redirect,
): void {
  const decision = resolveAuthRouteGuard(input);
  if (decision.action === "redirect") redirectImpl(decision.to);
}
