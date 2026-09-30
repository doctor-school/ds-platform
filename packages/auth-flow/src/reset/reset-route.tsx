import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import { withReturnTarget } from "../return-target-href";
import {
  RETURN_CONTEXT_PARAM,
  guardAuthRoute,
  resolveReturnLandingPath,
  resolveServerAuth,
} from "../server";
import { AuthShell } from "../shell";
import { ResetDoor } from "./reset-door";

/**
 * `<ResetRoute>` — the ONE server mount of password recovery (#2027 PR 1.8,
 * rows 78 and 83; ADR-0013 A1 cross-front reuse), the sibling of `VerifyRoute`.
 * The host route file is a MOUNT naming its own `AuthFlowHostConfig`;
 * everything below is host-neutral.
 *
 * Server-side, before the first byte of HTML:
 *   • the #675 guard, which LETS a signed-in doctor through because `/reset` is
 *     is the host's reset route, which `authenticatedAllowedRoutes` derives
 *     (003 EARS-28 — the cabinet «Сменить пароль» entry is by definition a
 *     signed-in doctor). The exemption is package mechanics, not the absence
 *     of a call;
 *   • the two ends of the journey (rules S3 + S4): «Вернуться ко входу» is this
 *     host's `routes.login` carrying the guard-reconstructed arrival target, and
 *     the post-reset landing is that target's host projection (#1945 re-homes an
 *     эфир onto this host's event route) or `routes.account` when the arrival
 *     carried nothing (#221's default).
 *
 * Nothing the recovery card RENDERS depends on who is asking — the identifier is
 * typed, not resolved — so no эфир is read and no return-context card is drawn.
 */
export async function ResetRoute({
  config,
  searchParams,
}: {
  config: AuthFlowHostConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — the degradation rule every auth mount applies.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;

  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: config.routes.reset,
    routes: config.routes,
  });

  // The guard reconstruction projected onto THIS host's paths — never the raw
  // param, so a hostile value reaches neither end.
  const landingTarget = resolveReturnLandingPath(config, returnTo);

  return (
    <AuthShell config={config}>
      <ResetDoor
        config={config}
        loginHref={withReturnTarget(config.routes.login, returnTo)}
        landing={landingTarget ?? config.routes.account}
        returnTarget={landingTarget}
      />
    </AuthShell>
  );
}
