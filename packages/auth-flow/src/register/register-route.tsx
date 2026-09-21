import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import { returnContextSlots } from "../login/return-context-card";
import {
  RETURN_CONTEXT_PARAM,
  guardAuthRoute,
  isAccountReturnTarget,
  resolveArrivalLanding,
  resolveCarriedReturnTarget,
  resolveReturnContext,
  resolveReturnLandingPath,
  resolveReturnTargetPath,
  resolveServerAuth,
} from "../server";
import { AuthShell } from "../shell";
import { RegisterDoor } from "./register-door";

/**
 * `<RegisterRoute>` — the ONE server mount of the sign-up door, hosted by both
 * storefronts (#2027 PR 1.6; ADR-0013 A1 cross-front reuse).
 *
 * The sibling of `<LoginRoute>` and deliberately its twin: each host's
 * `app/.../register/page.tsx` is now a MOUNT that names its own
 * `AuthFlowHostConfig` and forwards `searchParams`, and everything below — the
 * arrival read, the landing decision, the signed-in guard, the return-context
 * slots and the frame — is host-NEUTRAL. Every difference between the two
 * storefronts is config DATA: the routes, the эфир path projection, whether the
 * host publishes a return-context card, whether its landing is specialty-aware,
 * the attribution line and the points promise.
 *
 * WHY A SERVER COMPONENT. Both per-visitor facts — «is this visitor already
 * signed in» (#675) and «where does sign-up lead» (021 EARS-3 / LD-4) — are
 * decided before the first byte of HTML, from ONE `headers()` read forwarded
 * through the shared resolvers. The Academy decided them in two places that
 * could not see each other: a server layout held the guard and a client page
 * held the door, so the guard could not honour the returnTo-aware landing the
 * door was about to publish. One mount now decides both, in order.
 *
 * `searchParams` stays the PROMISE it arrives as and is awaited HERE, so the
 * host route file keeps its single JSX mount with no await of its own.
 */
export async function RegisterRoute({
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
  // Rule S3 / #2258 — the value that rides ONWARD out of this door. A different
  // question from `safeTarget`, which is the эфир-only EARS-3 context target:
  // this one also admits the account family, so a doctor who arrived from a
  // closed page keeps it across the confirmation step's sideways hops.
  const carriedTarget = resolveCarriedReturnTarget(config, returnTo) ?? null;
  // WHERE THIS host takes them afterwards: the same guard output projected onto
  // this storefront's own paths (#1945), so `/webinars/<slug>` and
  // `/events/<slug>` are one arrival seen from two hosts.
  const landingTarget = resolveReturnLandingPath(config, returnTo);
  // ONE read of the request headers, serving both per-visitor facts below.
  const requestHeaders = await headers();

  // #675 — a doctor who already holds a session is not offered a second
  // account. Taken before the upstream эфир read, because a NON-gate arrival's
  // landing is decided by the arrival rule alone and that round-trip would
  // answer a question nobody asks. A gate arrival genuinely needs both facts
  // and pays for both.
  const auth = await resolveServerAuth(requestHeaders);
  const authenticated = auth.status === "doctor";
  if (authenticated && !landingTarget) {
    guardAuthRoute({
      authenticated,
      pathname: config.routes.register,
      routes: config.routes,
      landing: await resolveArrivalLanding(config, requestHeaders),
    });
  }

  // 021 EARS-3 — the эфир READ exists to fill the return-context CARD, so a
  // host that publishes none never pays for it. The gate is then kept on the
  // guard reconstruction alone, which stands on its own.
  const returnEvent =
    config.returnTo?.card && safeTarget
      ? await resolveReturnContext(safeTarget)
      : null;
  const gateResolved = config.returnTo?.card
    ? returnEvent !== null
    : Boolean(safeTarget);

  // #1987 / rule S4 — an account arrival resolves NO эфир, so the gate branch
  // would refuse it and drop the doctor on the LD-4 default, which is precisely
  // the destination they declined by asking for «Личный кабинет». The sign-in
  // door has answered it since #1987; the sign-up door does now too. Asked of
  // the codec, which admits the whole family under this host's own
  // `routes.account`, not just the cabinet index (014 EARS-6.5).
  const accountLanding = isAccountReturnTarget(config, returnTo);

  const landing =
    landingTarget && (gateResolved || accountLanding)
      ? landingTarget
      : await resolveArrivalLanding(config, requestHeaders);

  guardAuthRoute({
    authenticated,
    pathname: config.routes.register,
    routes: config.routes,
    landing,
  });

  const { panel, plate } = returnContextSlots({
    config,
    event: returnEvent,
    variant: "register",
  });

  return (
    <AuthShell config={config} returnContext={panel}>
      <RegisterDoor
        config={config}
        landing={landing}
        // The RAW arrival value: the door's shared carry helper answers both the
        // эфир and the account shape and re-appends only what the guards
        // reconstructed, so a hostile param is dropped at the hop (#2258 / S3).
        returnTo={returnTo ?? null}
        // 021 EARS-10 — the эфир intent to COMPLETE after sign-up, in this
        // host's vocabulary, supplied only when the arrival actually resolved.
        // An unresolvable target is the same as no target, and sending it anyway
        // would ask the confirm command to name a degradation reason for a page
        // this route already knows nothing answers.
        returnTarget={landingTarget && gateResolved ? landingTarget : null}
        // Rule S3 — what the confirmation step's «Войти» / «Забыли пароль» hops
        // carry onward. The CARRY vocabulary, not the эфир-only confirm intent
        // above: an account arrival has no `returnTarget` at all.
        carriedTarget={carriedTarget}
        returnContextPlate={plate}
      />
    </AuthShell>
  );
}
