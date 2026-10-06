import type { LoginCardMethod } from "@ds/design-system/blocks";
import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import {
  RETURN_CONTEXT_PARAM,
  guardAuthRoute,
  isAccountReturnTarget,
  isLandOnlyReturnTarget,
  isRoomReturnTarget,
  readReturnEvent,
  resolveArrivalLanding,
  resolveReturnLandingPath,
  resolveReturnTargetPath,
  resolveServerAuth,
} from "../server";
// Deliberately NOT through the `../server` barrel: that barrel also reaches
// client components and the host proxy, where an inline server action may not
// be defined. Only these server mounts build the action.
import { signedInLandingAction } from "../server/signed-in-landing";
import { AuthShell } from "../shell";
import { LoginDoor } from "./login-door";
import { LOGIN_HANDOFF_PARAM, resolveHandoffRef } from "./login-handoff";
import { returnContextSlots } from "./return-context-card";

/** 003 EARS-43 — the search param that preselects the sign-in method. */
export const LOGIN_METHOD_PARAM = "method";

/**
 * 003 EARS-43 — `?method=` read through a CLOSED allow-list: only `code` opens
 * the card on the email-code method; any other value, a repeated param's later
 * values, or no param at all keep the default «Пароль». The raw value is never
 * rendered, so a hostile one has nothing to echo into.
 */
export function resolveLoginMethod(
  raw: string | string[] | undefined,
): LoginCardMethod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "code" ? "otp" : "password";
}

/**
 * `<LoginRoute>` — the ONE server mount of the sign-in door, hosted by both
 * storefronts (#2027 PR 1.5; ADR-0013 A1 cross-front reuse).
 *
 * Each host's `app/.../login/page.tsx` is now a MOUNT: it names its own
 * `AuthFlowHostConfig` and forwards `searchParams`. Everything below — the
 * arrival read, the landing decision, the signed-in guard, the return-context
 * slots and the frame — is host-NEUTRAL, and every difference between the two
 * storefronts is config DATA: the routes, the эфир path projection, whether its
 * landing is specialty-aware.
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
  // 003 EARS-43 — independent of the return context: it decides only which tab
  // the card opens on, never where sign-in leads.
  const defaultMethod = resolveLoginMethod(params[LOGIN_METHOD_PARAM]);
  // 003 EARS-44 — the Congress hand-off reference, redeemed only on the code
  // entry and only when it has the reference's shape; anything else is never
  // sent and the door falls back to the EARS-43 state.
  const handoffRef =
    defaultMethod === "otp"
      ? resolveHandoffRef(params[LOGIN_HANDOFF_PARAM])
      : null;
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

  // 021 EARS-10 — the ONE эфир read, the rule the registration door and the
  // confirmation step take (`resolveRegistrationArrival`): only a «gone» answer
  // drops the target — the carried one AND its parked copy (the door consumes
  // that without using it). The card is drawn from a page that answered
  // (EARS-2/3), on every host — the canvas «Вход» gates it on the return context
  // alone (#2455).
  const eventRead = safeTarget ? await readReturnEvent(safeTarget) : null;
  const eventGone = eventRead?.status === "gone";
  const gateResolved = eventRead !== null && !eventGone;
  const returnEvent = eventRead?.status === "found" ? eventRead.event : null;

  // #1987 — an account arrival resolves NO эфир, so the gate branch would refuse
  // it and drop the doctor on the default landing, which is precisely the
  // destination they declined by asking for «Личный кабинет». It is a landing in
  // its own right — asked of the codec, which admits the whole family under this
  // host's own `routes.account`, not just the cabinet index (014 EARS-6.5).
  const accountLanding = isAccountReturnTarget(config, returnTo);
  // 006 EARS-6 · 020 EARS-7 — a room arrival is the same kind of landing: no эфир
  // card, and the parked cookie is only the fallback for a hop that lost the
  // query param, so without it the door would drop a guest the room sent here on
  // the default landing instead of back in the room.
  const roomLanding = isRoomReturnTarget(config, returnTo);

  // 014 EARS-6 amendment 2026-09-30 (#2487) — the header's land-only эфир
  // return is one more landing of that kind: back on the event page, no эфир
  // card, no registration (the parked copy keeps its marker for the door).
  const landOnlyLanding = isLandOnlyReturnTarget(returnTo);

  const landsOnCarriedTarget = Boolean(
    landingTarget &&
    (gateResolved || accountLanding || roomLanding || landOnlyLanding),
  );
  const landing =
    landsOnCarriedTarget && landingTarget
      ? landingTarget
      : await resolveArrivalLanding(config, requestHeaders);
  // #2333 — `landing` above was decided for a GUEST (no session, so a profile
  // specialty is invisible). When it is the LD-4 arrival decision on a
  // specialty-aware host, the door also gets the server action that decides it
  // again once the sign-in has set the session; a carried target is final.
  const resolveSignedInLanding = landsOnCarriedTarget
    ? undefined
    : signedInLandingAction(config);

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
        {...(resolveSignedInLanding ? { resolveSignedInLanding } : {})}
        // The RAW arrival value: the door's shared carry helper answers both the
        // эфир and the account shape and re-appends only what the guards
        // reconstructed, so a hostile param is dropped at the hop (#2258 / S3).
        returnTo={returnTo ?? null}
        // 005 EARS-2 — the эфир intent to COMPLETE after sign-in, in this host's
        // vocabulary, supplied only when the arrival actually resolved.
        returnTarget={landingTarget && gateResolved ? landingTarget : null}
        returnTargetGone={eventGone}
        returnContextPlate={plate}
        defaultMethod={defaultMethod}
        handoffRef={handoffRef}
      />
    </AuthShell>
  );
}
