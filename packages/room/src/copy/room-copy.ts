/**
 * 006 EARS-10 — the room's copy contract (D19 / D22).
 *
 * The shared room unit renders no catalogue: it is `next-intl`-free by
 * construction (`../purity.test.ts`) because the doctor storefront has neither
 * `next-intl` nor a messages catalogue. Every user-facing string the room paints
 * is therefore INJECTED by its host, and this module is the whole surface of that
 * injection.
 *
 * Two shapes, one contract:
 *
 * - {@link RoomCopyStrings} — plain strings only. This is what a SERVER component
 *   may pass across the RSC boundary (D14), so the Academy page builds it with
 *   `getTranslations` and hands it to its `"use client"` wrapper untouched.
 * - {@link RoomCopy} — `RoomCopyStrings` plus the four ICU-parameterised values,
 *   which are FUNCTIONS because their arguments are live client state (a presence
 *   push, an unread tally, the elapsed live minutes, the doctor's own name). They
 *   cannot be pre-rendered server-side, and a function cannot cross the RSC
 *   boundary — so the host's client wrapper builds them.
 *
 * Deliberately ABSENT (D22): `room.accessGuidance.*`. Those two keys are read by
 * the EVENT page (`?from=room`, EARS-10 guidance), never by the room composition;
 * pulling them in would force a host to author copy for a screen it does not
 * render.
 *
 * `errors.*` (D18) does not come from the `room` namespace at all. The Academy
 * resolves display-name validation through its `errors.validation` catalogue, so
 * the room's prompt takes those four strings explicitly rather than pretending
 * every value is `t("<same key>")` from one namespace.
 */

/** Display-name prompt copy (006 EARS-14) — the JIT «Имя и фамилия» step. */
export interface RoomDisplayNamePromptCopy {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submit: string;
  /** The SUBMIT-FAILURE string — not a validation message (those are `errors.*`). */
  error: string;
}

/**
 * D18 — the display-name VALIDATION strings. They key off the zod issue
 * code/shape of `SetDisplayNameRequestSchema`, mirroring the Academy's own
 * `translateIssue` mapping, so the prompt never falls back to a generic message
 * where a specific one exists.
 */
export interface RoomValidationCopy {
  /** Empty / whitespace-only name. */
  displayNameRequired: string;
  /** Over 100 characters. */
  displayNameTooLong: string;
  /** A missing required value with no more specific mapping. */
  required: string;
  /** The last-resort message for an unmapped issue. */
  fallback: string;
}

/**
 * The SERIALIZABLE half of the room copy contract — every string the room paints
 * that carries no runtime argument.
 */
export interface RoomCopyStrings {
  // Header bar (EARS-2 / EARS-11 / EARS-12 / EARS-15).
  liveBadge: string;
  brandHome: string;
  exit: string;
  /** Rendered by the HOST inside the injected `userCluster`, never by the package. */
  themeToggle: string;
  // Room body (EARS-2 / EARS-9 / EARS-11 / EARS-18).
  onAir: string;
  chatTab: string;
  infoTab: string;
  chatHeading: string;
  chatCollapse: string;
  chatExpand: string;
  chatUnavailable: string;
  unavailableTitle: string;
  unavailableBody: string;
  playerTitle: string;
  playerRefresh: string;
  playerFailedTitle: string;
  playerFailedBody: string;
  playerEmbeddingDisabled: string;
  playerUnavailable: string;
  playerRetrying: string;
  playerSuspectedBody: string;
  playerRestart: string;
  programNow: string;
  // Chat panel (EARS-3).
  moderatorPin: string;
  chatLoading: string;
  chatEmpty: string;
  chatParticipant: string;
  chatYou: string;
  chatNewMessages: string;
  chatSendError: string;
  chatReconnecting: string;
  chatDisconnected: string;
  composerPlaceholder: string;
  composerSend: string;
  // Nested groups.
  displayNamePrompt: RoomDisplayNamePromptCopy;
  errors: RoomValidationCopy;
}

/**
 * The FULL copy contract the room composition consumes — the strings plus the
 * four ICU-parameterised values as callbacks (D22).
 */
export interface RoomCopy extends RoomCopyStrings {
  /** «N врачей в комнате» — Russian plural over the live presence aggregate. */
  presenceCount: (count: number) => string;
  /** «· N мин» — elapsed minutes since the real go-live instant. */
  liveDuration: (minutes: number) => string;
  /** «Ваш профиль: <name>» — the host renders it inside `userCluster`. */
  avatarLabel: (name: string) => string;
  /** «N новых сообщений» — the collapsed-chat unread tally. */
  chatUnread: (count: number) => string;
}

/**
 * Every key of {@link RoomCopyStrings}, dotted for the nested groups.
 *
 * A host's copy suite asserts EXHAUSTIVENESS against this list: a key added to
 * the contract but never mapped by a host is a silently-blank string in the room,
 * which no render test catches (`undefined` renders as nothing).
 */
export const ROOM_COPY_KEYS = [
  "liveBadge",
  "brandHome",
  "exit",
  "themeToggle",
  "onAir",
  "chatTab",
  "infoTab",
  "chatHeading",
  "chatCollapse",
  "chatExpand",
  "chatUnavailable",
  "unavailableTitle",
  "unavailableBody",
  "playerTitle",
  "playerRefresh",
  "playerFailedTitle",
  "playerFailedBody",
  "playerEmbeddingDisabled",
  "playerUnavailable",
  "playerRetrying",
  "playerSuspectedBody",
  "playerRestart",
  "programNow",
  "moderatorPin",
  "chatLoading",
  "chatEmpty",
  "chatParticipant",
  "chatYou",
  "chatNewMessages",
  "chatSendError",
  "chatReconnecting",
  "chatDisconnected",
  "composerPlaceholder",
  "composerSend",
  "displayNamePrompt.title",
  "displayNamePrompt.description",
  "displayNamePrompt.label",
  "displayNamePrompt.placeholder",
  "displayNamePrompt.submit",
  "displayNamePrompt.error",
  "errors.displayNameRequired",
  "errors.displayNameTooLong",
  "errors.required",
  "errors.fallback",
] as const;

/** The four ICU-parameterised members of {@link RoomCopy} (D22). */
export const ROOM_COPY_CALLBACK_KEYS = [
  "presenceCount",
  "liveDuration",
  "avatarLabel",
  "chatUnread",
] as const;

/** Read a dotted {@link ROOM_COPY_KEYS} path out of a copy object. */
export function readRoomCopyKey(
  copy: RoomCopyStrings,
  key: (typeof ROOM_COPY_KEYS)[number],
): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) => (node as Record<string, unknown> | undefined)?.[segment],
      copy,
    );
}
