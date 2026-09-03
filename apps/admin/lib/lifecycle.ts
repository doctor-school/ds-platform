import type { EventLifecycleState } from "@ds/schemas";
import type { TaxonomyHttpError } from "@/providers/data-provider";
import { taxonomyErrorKey } from "./taxonomy-errors";

/**
 * The admin lifecycle-action model (007 EARS-5/6/7, design §2, §8). The admin UI
 * offers ONLY the transitions valid from the current
 * state — and it derives that offer from the server's
 * `EventAdminDetail.validTransitions`, which the server computes from the SAME
 * closed map (`@ds/schemas` `LIFECYCLE_TRANSITIONS`) its guard enforces, so the
 * UI offer and the API refusal can never drift. This module maps each legal edge
 * to the named command endpoint + the message-catalog key for its button label;
 * it invents no transition the schema does not permit.
 */

/** The named transition command a legal `(from, to)` edge fires (design §5, §7). */
export interface LifecycleAction {
  /** The origin `EventLifecycleState` this action is offered from. */
  readonly from: EventLifecycleState;
  /** The target `EventLifecycleState` this action moves the event to. */
  readonly to: EventLifecycleState;
  /**
   * The command path segment under `/v1/admin/events/:id/` (design §7, and 014
   * design §3.1 for the two `*-legacy` commands of the second machine).
   */
  readonly command:
    | "publish"
    | "open"
    | "close"
    | "hide"
    | "archive-legacy"
    | "hide-legacy";
  /** The message-catalog key (under `events.action.*`) for the button label. */
  readonly labelKey: string;
  /** A stable test id / data attribute so the e2e can address the button. */
  readonly testId: string;
}

/**
 * The single table from a legal forward EDGE to its named command (007 design §2
 * + 014-design §3.1). Keyed on the `(from, to)` PAIR, not on the target alone.
 *
 * Only `live → ended` (`CloseRoom`) lands on `ended` today — 014 EARS-23 moved the
 * off-platform эфир onto its OWN machine (`hidden ⇄ in_archive`, origin `legacy`),
 * so the `published → ended` `MarkEventEnded` fork is gone from the 007 machine
 * entirely. The pair key stays: it is the honest key for an edge→command table
 * (the origin state is always known on the admin surface via
 * `EventAdminDetail.state`), and it keeps a second command landing on an already
 * occupied target from silently reintroducing the ambiguity.
 *
 * Since 014 EARS-25 (#1741) the table carries BOTH machines' edges: the two
 * `legacy` rows (`hidden → in_archive` = `ArchiveLegacyBroadcast`,
 * `in_archive → hidden` = `HideLegacyBroadcast`) sit beside the four `platform`
 * rows. They cannot leak into each other's bar, and that is a property of the
 * derivation rather than a branch anyone has to remember: `validTransitions` is
 * computed per-`origin` on the SERVER, so a platform event never lists
 * `hidden → in_archive` and a legacy one never lists `draft → published` —
 * {@link actionsFor} therefore names a legacy command only on a legacy event and
 * a platform command only on a platform one (EARS-27, the two vocabularies never
 * appear together on one screen). An `origin` test in the UI would be a SECOND
 * copy of that rule, free to drift from the server's; there is deliberately none.
 *
 * This is the ONLY place an edge is turned into a command — there is no second
 * table to drift.
 */
const ACTIONS: readonly LifecycleAction[] = [
  {
    from: "draft",
    to: "published",
    command: "publish",
    labelKey: "events.action.publish",
    testId: "action-publish",
  },
  {
    from: "published",
    to: "live",
    command: "open",
    labelKey: "events.action.open",
    testId: "action-open",
  },
  {
    from: "live",
    to: "ended",
    command: "close",
    labelKey: "events.action.close",
    testId: "action-close",
  },
  {
    from: "ended",
    to: "hidden",
    command: "hide",
    labelKey: "events.action.hide",
    testId: "action-hide",
  },
  // ── 014 EARS-25: the legacy (off-platform) эфир machine ────────────────────
  {
    from: "hidden",
    to: "in_archive",
    command: "archive-legacy",
    labelKey: "events.action.archiveLegacy",
    testId: "action-archive-legacy",
  },
  {
    from: "in_archive",
    to: "hidden",
    command: "hide-legacy",
    labelKey: "events.action.hideLegacy",
    testId: "action-hide-legacy",
  },
];

/**
 * Derive the lifecycle actions the admin surface offers from the event's current
 * state plus the server-supplied `validTransitions` (never from a UI-local
 * guess). An empty list (a terminal `hidden` event) yields no actions — the UI
 * presents no transition the current state disallows (EARS-7). An edge absent
 * from {@link ACTIONS} names no command and is simply never offered.
 *
 * No control here needs a client-side precondition check: the server computes
 * `validTransitions` from the same closed map its guard enforces (and, since 014
 * EARS-23, for the event's own `origin`), so a control appears exactly when the
 * command would succeed — one authority, not a second copy of the rule in the
 * browser (014-design §3.1).
 */
export function actionsFor(
  state: EventLifecycleState,
  validTransitions: readonly EventLifecycleState[],
): LifecycleAction[] {
  return validTransitions
    .map((to) => ACTIONS.find((a) => a.from === state && a.to === to))
    .filter((a): a is LifecycleAction => a !== undefined);
}

/**
 * Build the `useCustomMutation` request for one named lifecycle command
 * (007 EARS-7, 014 EARS-17).
 *
 * Since #1593 every named command is CONDITIONAL: the server refuses one that
 * carries no `If-Match` validator with `428 PRECONDITION_REQUIRED`, and the data
 * provider (`providers/data-provider.ts` → `custom`) derives that header from
 * `meta.version` alone. So the version the operator's screen was rendered from
 * is part of the request, not of the button — and it is passed EXPLICITLY from
 * the detail the caller holds rather than re-read at click time, because the
 * whole point of the precondition is that a command applies to the state the
 * operator actually saw. A concurrently changed event answers 412 and the bar
 * surfaces the refusal; it never silently overwrites the other operator.
 */
export function lifecycleCommandRequest(
  // The structural `{ id, version }` shape rather than `EventAdminDetail` is
  // DELIBERATE: it is what keeps this builder (and `lifecycleErrorOutcome`
  // below) in the pure node tier, testable without React. Do not tighten it back
  // to the full DTO.
  detail: { readonly id: string; readonly version: number },
  command: LifecycleAction["command"],
): {
  url: string;
  method: "post";
  values: Record<string, never>;
  meta: { version: number };
} {
  return {
    url: `/v1/admin/events/${detail.id}/${command}`,
    method: "post",
    values: {},
    meta: { version: detail.version },
  };
}

/** What the action bar does with one refused lifecycle command. */
export interface LifecycleErrorOutcome {
  /** The RU message-catalog key the alert renders. */
  readonly messageKey: string;
  /** Whether the screen must re-read the event before the operator retries. */
  readonly refetch: boolean;
}

/**
 * Explain and recover from a refused lifecycle command (#1593).
 *
 * A conditional command has two refusal families, and they need different
 * words: a precondition refusal (412 `PRECONDITION_FAILED`, 428
 * `PRECONDITION_REQUIRED`) says the operator's screen is behind the row and
 * gets the shipped `errors.stale` sentence, while a domain refusal (409
 * `INVALID_TRANSITION`) keeps its own cause. Both families
 * refetch: a domain refusal on a held page is very often ALSO a symptom of the
 * event having moved in another window (publish pressed on an event someone
 * else already published), so leaving the screen on its stale state after the
 * refusal strands the operator with wrong status and wrong actions — the owner
 * hit exactly that dead end at Stage-B (2026-09-01, #1593). Only a refusal the
 * server never classified (no mapped code — transport failure, unknown shape)
 * skips the refetch, because there is no evidence the row is readable at all.
 * `EVENT_NOT_FINISHED` (#1815 review NIT D) joins the refetching family for the
 * same reason as the domain refusal: it can only be answered to a command built
 * from a detail whose state has already moved on the row, so the screen the
 * operator is reading is exactly the thing that must be replaced.
 * Sentences resolve through the same `taxonomyErrorKey` mapper every other
 * admin surface keys off, not a second copy of the code table.
 */
export function lifecycleErrorOutcome(error: unknown): LifecycleErrorOutcome {
  const messageKey = taxonomyErrorKey(
    error,
    "events.errors.transitionRefused",
  );
  const code = (error as TaxonomyHttpError | undefined)?.errorCode;

  return {
    messageKey,
    refetch:
      code === "PRECONDITION_FAILED" ||
      code === "PRECONDITION_REQUIRED" ||
      code === "INVALID_TRANSITION" ||
      code === "EVENT_NOT_FINISHED",
  };
}

/**
 * How long a refusal alert stays on screen AFTER the re-read it triggered has
 * replaced the state it was describing (#1593, owner Stage-B 2026-09-01).
 *
 * Not zero: the sentence is the only explanation the operator gets for why their
 * click did nothing, and yanking it the instant the refetch resolves — often
 * within a few hundred ms — would make the refusal invisible. Not infinite
 * either, which is the bug: the alert used to be cleared ONLY by the next button
 * click, so it sat beside an already-corrected badge and an already-corrected
 * action bar, still claiming a refusal about a version nobody was looking at.
 * Six seconds is a full read of either RU sentence with room to spare.
 */
export const REFUSAL_DISMISS_MS = 6_000;

/**
 * A stable identity for the lifecycle facts a refusal alert is ABOUT — the state
 * on the badge, the actions on the bar, and the version the commands are built
 * from. The alert is raised against the signature the screen held at click time;
 * once the refetch lands on a different one, the alert has outlived its subject
 * and {@link REFUSAL_DISMISS_MS} later it goes.
 *
 * `version` is part of it deliberately: the 412 family changes NOTHING visible —
 * same state, same offered actions — and only spends the validator, so a
 * signature over the visible fields alone would leave the stale-read alert
 * permanent in exactly the case it was written for.
 */
export function lifecycleSignature(detail: {
  readonly state: EventLifecycleState;
  readonly validTransitions: readonly EventLifecycleState[];
  readonly version: number;
}): string {
  return `${detail.state}|${detail.validTransitions.join(",")}|${detail.version}`;
}

/** What the lifecycle bar puts on screen for one render. */
export interface LifecycleBarContent {
  /** The refusal sentence to show, or `null` when there is none. */
  readonly refusal: string | null;
  /** Whether the «no transitions offered» notice replaces the button row. */
  readonly emptyNotice: boolean;
}

/**
 * What the bar renders, as a rule rather than as a control-flow accident.
 *
 * The refusal is INDEPENDENT of whether any transition is still offered. That
 * independence is the whole point: the bar used to return the «no transitions»
 * notice early, before it ever reached the alert, so on the one screen where the
 * operator most needs the explanation — a refusal whose re-read then withdrew
 * every action, e.g. an event someone else hidden — the sentence disappeared in
 * the same frame it was raised, and the operator was left with a silent, empty
 * bar and no account of why their click did nothing.
 */
export function lifecycleBarContent(
  refusal: string | null,
  actions: readonly LifecycleAction[],
): LifecycleBarContent {
  return { refusal, emptyNotice: actions.length === 0 };
}

/** The message-catalog key (under `events.state.*`) for a lifecycle-state badge label. */
export function stateLabelKey(state: EventLifecycleState): string {
  return `events.state.${state}`;
}
