import type { EventLifecycleState } from "@ds/schemas";

/**
 * The admin lifecycle-action model (007 EARS-5/6/7, design §2, §8). The admin UI
 * offers ONLY the transitions valid from the current state — and it derives that
 * offer from the server's `EventAdminDetail.validTransitions`, the SAME closed
 * map (`@ds/schemas` `LIFECYCLE_TRANSITIONS`) the server-side guard enforces, so
 * the UI offer and the API refusal can never drift. This module maps each legal
 * target state to the named command endpoint + the message-catalog key for its
 * button label; it invents no transition the schema does not permit.
 */

/** The named transition command a legal target state fires (design §5, §7). */
export interface LifecycleAction {
  /** The target `EventLifecycleState` this action moves the event to. */
  readonly to: EventLifecycleState;
  /** The command path segment under `/v1/admin/events/:id/` (design §7). */
  readonly command: "publish" | "open" | "close" | "archive";
  /** The message-catalog key (under `events.action.*`) for the button label. */
  readonly labelKey: string;
  /** A stable test id / data attribute so the e2e can address the button. */
  readonly testId: string;
}

/**
 * The single map from a legal forward target to its named command (design §2:
 * `draft→published` = publish, `published→live` = open room, `live→ended` =
 * close room, `ended→archived` = archive). `archived` is terminal and appears as
 * no key's value. This is the ONLY place a target state is turned into a command
 * — there is no second table to drift.
 */
const ACTION_BY_TARGET: Record<
  Exclude<EventLifecycleState, "draft">,
  LifecycleAction
> = {
  published: {
    to: "published",
    command: "publish",
    labelKey: "events.action.publish",
    testId: "action-publish",
  },
  live: {
    to: "live",
    command: "open",
    labelKey: "events.action.open",
    testId: "action-open",
  },
  ended: {
    to: "ended",
    command: "close",
    labelKey: "events.action.close",
    testId: "action-close",
  },
  archived: {
    to: "archived",
    command: "archive",
    labelKey: "events.action.archive",
    testId: "action-archive",
  },
};

/**
 * Derive the lifecycle actions the admin surface offers from the server-supplied
 * `validTransitions` (never from a UI-local guess). An empty list (a terminal
 * `archived` event) yields no actions — the UI presents no transition the current
 * state disallows (EARS-7). Any target outside the four forward moves is simply
 * absent from {@link ACTION_BY_TARGET}, so it can never be offered.
 */
export function actionsFor(
  validTransitions: readonly EventLifecycleState[],
): LifecycleAction[] {
  return validTransitions
    .filter((to): to is Exclude<EventLifecycleState, "draft"> => to !== "draft")
    .map((to) => ACTION_BY_TARGET[to]);
}

/** The message-catalog key (under `events.state.*`) for a lifecycle-state badge label. */
export function stateLabelKey(state: EventLifecycleState): string {
  return `events.state.${state}`;
}
