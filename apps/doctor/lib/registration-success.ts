import type {
  DoctorConfirmLandingReason,
  DoctorConfirmResponse,
} from "@ds/schemas";

/**
 * 021 EARS-9 + EARS-10 (#1546) — the doctor host's projection of the
 * confirmation response into the success state's copy and its two destinations.
 *
 * Pure and transport-free on purpose: the decision «where does a confirmed
 * doctor go» is the clause's whole substance, so it is a function of the
 * response and the door's own landing — testable without a browser, and
 * impossible to drift between the render and the assertion.
 *
 * WHAT IT NEVER DOES (021-design §3, property 1): compose a destination. Every
 * href it returns is either the server's own reconstruction or the `landing`
 * the door already decided server-side. There is no `document.referrer`, no
 * storage read, and no string concatenated from the raw `returnTo` param.
 */

/** The success heading — canvas «Успех» artboard (`design-source/auth.dc.html`). */
export const SUCCESS_TITLE = "Почта подтверждена";

/** EARS-10 — «в личный кабинет», the secondary rank and never the default. */
export const CABINET_LABEL = "В личный кабинет";

/**
 * EARS-9 / LD-6 — the accrual as a PROMISE while `credited` is `null`.
 *
 * The canvas states «+20 Pul за регистрацию» beside a «История начислений»
 * link; both are release-2 (#1545 / feature 025). Stating an amount here would
 * mean deriving it from configuration, which LD-6 forbids, and linking a ledger
 * that does not exist would be a dead affordance — so release 1 names the
 * accrual as the pending fact it is, with no number and no link.
 */
export const ACCRUAL_PROMISE =
  "Стартовые очки за регистрацию начислим на ваш счёт";

/** EARS-9 — the same row once the server asserts an amount (the canvas line). */
export function accrualFact(credited: number): string {
  return `Вам начислено ${credited} Pul — стартовые очки за регистрацию.`;
}

/**
 * LD-8 — what happened to the carried target, in plain RU.
 *
 * One sentence per reason, each naming the outcome AND the destination it
 * implies, because the doctor is about to press a button that no longer goes
 * where they asked. The four reasons are the closed set the contract declares;
 * `missing` deliberately does not distinguish a draft from a non-existent эфир
 * (004 EARS-6 — a public surface is not an existence oracle).
 */
export const LANDING_REASON_COPY: Record<DoctorConfirmLandingReason, string> = {
  ended: "Эфир, на который вы записывались, уже завершился — вот его страница.",
  full: "На эфире, куда вы шли, места закончились — вот его страница.",
  unpublished:
    "Эфир, на который вы шли, снят с публикации — вот ближайшие эфиры.",
  missing: "Эфир, на который вы шли, больше не доступен — вот ближайшие эфиры.",
};

/** The three destination shapes this host can land a confirmed doctor on. */
type LandingShape = "event" | "feed" | "home";

/**
 * Classify a destination by its PATH shape, never by the response's `kind`.
 *
 * The doctor host serves an эфир at `/events/<slug>` and the feed at `/events`
 * (020-design §1), and the LD-4 direct-arrival landing is one of those two or
 * the storefront home. A degraded landing can be either an event page (the эфир
 * is still readable — `ended`, `full`, `unpublished`) or the feed (`missing`),
 * so the label has to follow the href rather than the reason.
 */
function landingShape(href: string): LandingShape {
  if (href.startsWith("/events/")) return "event";
  if (href === "/events" || href.startsWith("/events?")) return "feed";
  return "home";
}

/**
 * The primary label.
 *
 * A honoured return says «вернуться»; a degraded one says «открыть», because
 * the doctor is NOT going back to what they asked for. Neither label carries
 * the эфир title: the door drops its return context at submit on purpose
 * (`registration-screen.tsx`), and re-fetching a title just to decorate a
 * button would put a second server read on the success path for nothing. A
 * title-less label is the honest one.
 */
function primaryLabel(href: string, honouredReturn: boolean): string {
  switch (landingShape(href)) {
    case "event":
      return honouredReturn ? "Вернуться к эфиру →" : "Открыть страницу эфира →";
    case "feed":
      return "К ближайшим эфирам →";
    case "home":
      return "На главную →";
  }
}

/** The resolved success state, ready to hand to `<RegistrationSuccessCard>`. */
export type RegistrationSuccessView = {
  title: string;
  accrual: string;
  profileCompletion: string | null;
  reason: string | null;
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
};

/**
 * Compose the success state from the confirmation response and the door's own
 * landing.
 *
 * The href rule, in full:
 *
 * • `kind: "return"` — the carried point of interest is live and the server's
 *   href IS the guard's reconstruction of it. Use it.
 * • `kind: "landing"` WITH a `reason` — LD-8: a target was carried and went
 *   stale, and the server picked the nearest honest destination knowing WHY.
 *   Use it; the client has no better answer.
 * • `kind: "landing"` WITHOUT a `reason` — nothing was carried (or the value
 *   was hostile and treated as absent). The server's default is `/events`; the
 *   DOOR's `landingFallback` is the same LD-4 decision taken with the one fact
 *   the confirmation API does not have — 017's remembered specialty, read from
 *   the cookie on the register route — so the door's answer is the better one
 *   and the doctor lands where the door promised them they would.
 *
 * The cabinet href is the response's, not a literal: the secondary destination
 * is part of the contract (`DOCTOR_CABINET_PATH`), and re-typing it here would
 * be a second source for one decision.
 */
export function resolveRegistrationSuccess(
  response: DoctorConfirmResponse,
  landingFallback: string,
): RegistrationSuccessView {
  const { primaryAction, secondaryAction, credited, profileCompletion } =
    response;
  const honouredReturn = primaryAction.kind === "return";
  const degraded = primaryAction.reason !== undefined;
  const href =
    honouredReturn || degraded ? primaryAction.href : landingFallback;

  return {
    title: SUCCESS_TITLE,
    accrual: credited === null ? ACCRUAL_PROMISE : accrualFact(credited),
    // EARS-9 — `null` stays `null`: the row is absent from the tree, never a
    // placeholder and never a number this client invented.
    profileCompletion,
    reason: primaryAction.reason
      ? LANDING_REASON_COPY[primaryAction.reason]
      : null,
    primary: { href, label: primaryLabel(href, honouredReturn) },
    secondary: { href: secondaryAction.href, label: CABINET_LABEL },
  };
}
