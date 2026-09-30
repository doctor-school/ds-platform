import type { AuthFlowHostConfig } from "../host-config";
import {
  guardAuthRoute,
  isAccountReturnTarget,
  isRoomReturnTarget,
  readReturnEvent,
  resolveArrivalLanding,
  resolveCarriedReturnTarget,
  resolveReturnLandingPath,
  resolveReturnTargetPath,
  resolveServerAuth,
  type ReturnContextEvent,
} from "../server";
// Deliberately NOT through the `../server` barrel: that barrel also reaches
// client components and the host proxy, where an inline server action may not
// be defined. Only the server mounts build the action.
import { signedInLandingAction } from "../server/signed-in-landing";
import {
  completionTargetAction,
  type CompletionTarget,
} from "../server/completion-target";

/** What a registration arrival resolves to, before the first byte of HTML. */
export type RegistrationArrival = {
  /** Where the visitor lands when nothing carried is honoured (021 EARS-3 / LD-4). */
  landing: string;
  /** #2333 — the re-decision once the confirmed doctor is signed in; absent where it cannot change. */
  resolveSignedInLanding?: () => Promise<string>;
  /**
   * 021 EARS-10 (#2455) — the эфир target judged again when the code is
   * accepted; present only while the arrival carries a standing эфир target.
   */
  resolveCompletionTarget?: () => Promise<CompletionTarget>;
  /**
   * 021 EARS-10 — the эфир intent to COMPLETE after sign-up, in this host's
   * vocabulary, supplied only when the arrival actually resolved.
   */
  returnTarget: string | null;
  /** Rule S3 — what the confirmation step's sideways hops carry onward. */
  carriedTarget: string | null;
  /** 021 EARS-3 — the carried эфир for the return-context card; `null` = no card. */
  returnEvent: ReturnContextEvent | null;
};

/**
 * The ONE server decision of a registration journey (#2027 PR 1.6), shared by
 * the two routes the journey crosses: the sign-up door and its `/verify` step
 * (003 EARS-24, #2455). Both decide from the same arrival `returnTo` and the
 * same request, so the confirmation step lands, completes and carries exactly
 * what the door it came from promised.
 *
 * It also runs the #675 signed-in guard for `pathname`: a doctor who already
 * holds a session is not offered a second account or a second confirmation.
 */
export async function resolveRegistrationArrival({
  config,
  returnTo,
  requestHeaders,
  pathname,
}: {
  config: AuthFlowHostConfig;
  /** The RAW arrival param (first value of a repeated one). */
  returnTo: string | undefined;
  requestHeaders: Headers;
  pathname: string;
}): Promise<RegistrationArrival> {
  // The guard reconstruction of the эфир arrival target — the ONE vocabulary,
  // resolved before any read, and the raw param never stands in for it.
  const safeTarget = resolveReturnTargetPath(returnTo);
  // Rule S3 / #2258 — the value that rides ONWARD out of the journey. A
  // different question from `safeTarget`, which is the эфир-only EARS-3 context
  // target: this one also admits the account family, so a doctor who arrived
  // from a closed page keeps it across the confirmation step's sideways hops.
  const carriedTarget = resolveCarriedReturnTarget(config, returnTo) ?? null;
  // WHERE THIS host takes them afterwards: the same guard output projected onto
  // this storefront's own paths (#1945), so `/webinars/<slug>` and
  // `/events/<slug>` are one arrival seen from two hosts.
  const landingTarget = resolveReturnLandingPath(config, returnTo);

  // #675 — taken before the upstream эфир read, because a NON-gate arrival's
  // landing is decided by the arrival rule alone and that round-trip would
  // answer a question nobody asks. A gate arrival genuinely needs both facts
  // and pays for both.
  const auth = await resolveServerAuth(requestHeaders);
  const authenticated = auth.status === "doctor";
  if (authenticated && !landingTarget) {
    guardAuthRoute({
      authenticated,
      pathname,
      routes: config.routes,
      landing: await resolveArrivalLanding(config, requestHeaders),
    });
  }

  // 021 EARS-10 (owner decision Б, amendment 2026-09-29) — the ONE эфир read,
  // asked on every host; only its «gone» answer drops the target. The card is
  // drawn only from a page that answered (EARS-2/3), on every host (#2455).
  const eventRead = safeTarget ? await readReturnEvent(safeTarget) : null;
  const gateResolved = eventRead !== null && eventRead.status !== "gone";
  const returnEvent = eventRead?.status === "found" ? eventRead.event : null;

  // #1987 / rule S4 — an account arrival resolves NO эфир, so the gate branch
  // would refuse it and drop the doctor on the LD-4 default, which is precisely
  // the destination they declined by asking for «Личный кабинет». Asked of the
  // codec, which admits the whole family under this host's own
  // `routes.account` (014 EARS-6.5).
  const accountLanding = isAccountReturnTarget(config, returnTo);
  // 006 EARS-6 · 020 EARS-7 — a room arrival is the same kind of landing: no
  // эфир card, and a host with no parking cookie has no other carrier.
  const roomLanding = isRoomReturnTarget(config, returnTo);

  const landsOnCarriedTarget = Boolean(
    landingTarget && (gateResolved || accountLanding || roomLanding),
  );
  const landing =
    landsOnCarriedTarget && landingTarget
      ? landingTarget
      : await resolveArrivalLanding(config, requestHeaders);
  // #2333 — `landing` above was decided for a GUEST (no session, so a profile
  // specialty is invisible). When it is the LD-4 arrival decision on a
  // specialty-aware host, the step also gets the server action that decides it
  // again once the sign-in has set the session; a carried target is final.
  const resolveSignedInLanding = landsOnCarriedTarget
    ? undefined
    : signedInLandingAction(config);

  guardAuthRoute({ authenticated, pathname, routes: config.routes, landing });

  // 021 EARS-10 — the render-time answer is re-asked at completion.
  const resolveCompletionTarget =
    safeTarget && landingTarget && gateResolved
      ? completionTargetAction(config, safeTarget, landingTarget)
      : undefined;

  return {
    landing,
    ...(resolveSignedInLanding ? { resolveSignedInLanding } : {}),
    ...(resolveCompletionTarget ? { resolveCompletionTarget } : {}),
    returnTarget: landingTarget && gateResolved ? landingTarget : null,
    carriedTarget,
    returnEvent,
  };
}
