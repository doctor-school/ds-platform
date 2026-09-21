import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import {
  RETURN_CONTEXT_PARAM,
  guardAuthRoute,
  isAccountReturnTarget,
  resolveArrivalLanding,
  resolveReturnContext,
  resolveReturnLandingPath,
  resolveReturnTargetPath,
  resolveServerAuth,
} from "../server";
import { AuthShell } from "../shell";
import { LoginDoor } from "./login-door";
import { returnContextSlots } from "./return-context-card";

/**
 * `<LoginRoute>` — the ONE server mount of the sign-in door, hosted by both
 * storefronts (#2027 PR 1.5; ADR-0013 A1 cross-front reuse).
 *
 * Each host's `app/.../login/page.tsx` is now a MOUNT: it names its own
 * `AuthFlowHostConfig` and forwards `searchParams`. Everything below — the
 * arrival read, the landing decision, the signed-in guard, the return-context
 * slots and the frame — is host-NEUTRAL, and every difference between the two
 * storefronts is config DATA: the routes, the эфир path projection, whether the
 * host publishes a return-context card, whether its landing is specialty-aware.
 *
 * WHY A SERVER COMPONENT. Both per-visitor facts — «is this visitor already
 * signed in» and «where does sign-in lead» — are decided before the first byte
 * of HTML, from ONE `headers()` read forwarded through the shared resolvers. The
 * Academy used to split them across a server layout (#675 guard) and a client
 * page, so the two halves could not see each other and the guard pre-empted the
 * returnTo-aware landing; one mount now decides both, in order.
 *
 * `searchParams` stays the PROMISE it arrives as and is awaited HERE, so the
 * host route file keeps its single JSX mount with no await of its own.
 */
export async function LoginRoute({
  config,
  searchParams,
}: {
  config: AuthFlowHostConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — a malformed return context degrades to no context,
  // it never breaks the door.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;
  // The guard reconstruction of the эфир arrival target — the ONE vocabulary,
  // resolved before any read, and the raw param never stands in for it.
  const safeTarget = resolveReturnTargetPath(returnTo);
  // WHERE THIS host takes them afterwards: the same guard output projected onto
  // this storefront's own paths (#1945), so `/webinars/<slug>` and
  // `/events/<slug>` are one arrival seen from two hosts.
  const landingTarget = resolveReturnLandingPath(config, returnTo);
  // ONE read of the request headers, serving both per-visitor facts below.
  const requestHeaders = await headers();

  // Already signed in ⇒ the door is not for this visitor (#1955). Taken before
  // the upstream эфир read, because a NON-gate arrival's landing is decided by
  // the arrival rule alone and that round-trip would answer a question nobody
  // asks. A gate arrival genuinely needs both facts and pays for both.
  const auth = await resolveServerAuth(requestHeaders);
  const authenticated = auth.status === "doctor";
  if (authenticated && !landingTarget) {
    guardAuthRoute({
      authenticated,
      pathname: config.routes.login,
      routes: config.routes,
      landing: await resolveArrivalLanding(config, requestHeaders),
    });
  }

  // 021 EARS-3 — the эфир READ exists to fill the return-context CARD, so a host
  // that publishes none never pays for it. The gate is then kept on the guard
  // reconstruction alone, which stands on its own.
  const returnEvent =
    config.returnTo?.card && safeTarget
      ? await resolveReturnContext(safeTarget)
      : null;
  const gateResolved = config.returnTo?.card
    ? returnEvent !== null
    : Boolean(safeTarget);

  // #1987 — an account arrival resolves NO эфир, so the gate branch would refuse
  // it and drop the doctor on the default landing, which is precisely the
  // destination they declined by asking for «Личный кабинет». It is a landing in
  // its own right — asked of the codec, which admits the whole family under this
  // host's own `routes.account`, not just the cabinet index (014 EARS-6.5).
  const accountLanding = isAccountReturnTarget(config, returnTo);

  const landing =
    landingTarget && (gateResolved || accountLanding)
      ? landingTarget
      : await resolveArrivalLanding(config, requestHeaders);

  guardAuthRoute({
    authenticated,
    pathname: config.routes.login,
    routes: config.routes,
    landing,
  });

  const { panel, plate } = returnContextSlots({
    config,
    event: returnEvent,
    variant: "login",
  });

  return (
    <AuthShell config={config} returnContext={panel}>
      <LoginDoor
        config={config}
        landing={landing}
        // The RAW arrival value: the door's shared carry helper answers both the
        // эфир and the account shape and re-appends only what the guards
        // reconstructed, so a hostile param is dropped at the hop (#2258 / S3).
        returnTo={returnTo}
        // 005 EARS-2 — the эфир intent to COMPLETE after sign-in, in this host's
        // vocabulary, supplied only when the arrival actually resolved.
        returnTarget={landingTarget && gateResolved ? landingTarget : null}
        returnContextPlate={plate}
      />
    </AuthShell>
  );
}
