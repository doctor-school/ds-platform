import type { RoomCopyStrings } from "@ds/room";

/**
 * 006 EARS-10 — the ACADEMY host's half of the room copy contract (#1722 D19).
 *
 * `packages/room` is `next-intl`-free by construction, so every string it paints
 * is injected. This module is the academy's whole mapping, and it is a PURE
 * function of two translators so the exhaustiveness suite (`copy.test.ts`) can
 * drive it straight off `messages/ru.json` without booting next-intl.
 *
 * Two namespaces feed it:
 * - `room` — everything the room composition paints (D22: `room.accessGuidance.*`
 *   is read by the EVENT page, never by the room, so it is NOT mapped here).
 * - `errors.validation` — the four display-name validation strings (D18). The
 *   prompt's messages come from the academy's shared validation catalogue, the
 *   same source `use-localized-resolver` reads for every other portal form, so
 *   the room prompt does not fork its own error wording.
 *
 * Only the SERIALIZABLE half lives here (D14). The four ICU-parameterised values
 * take live client state as arguments, so `room-client.tsx` builds them.
 */
export type RoomMessageResolver = (key: string) => string;

/**
 * Map the academy catalogue onto {@link RoomCopyStrings}.
 *
 * @param t  resolver for the `room` namespace.
 * @param tv resolver for the `errors.validation` namespace.
 */
export function buildRoomCopyStrings(
  t: RoomMessageResolver,
  tv: RoomMessageResolver,
): RoomCopyStrings {
  return {
    liveBadge: t("liveBadge"),
    brandHome: t("brandHome"),
    exit: t("exit"),
    themeToggle: t("themeToggle"),
    onAir: t("onAir"),
    chatTab: t("chatTab"),
    infoTab: t("infoTab"),
    chatHeading: t("chatHeading"),
    chatCollapse: t("chatCollapse"),
    chatExpand: t("chatExpand"),
    chatUnavailable: t("chatUnavailable"),
    unavailableTitle: t("unavailableTitle"),
    unavailableBody: t("unavailableBody"),
    playerTitle: t("playerTitle"),
    playerRefresh: t("playerRefresh"),
    playerFailedTitle: t("playerFailedTitle"),
    playerFailedBody: t("playerFailedBody"),
    playerEmbeddingDisabled: t("playerEmbeddingDisabled"),
    playerUnavailable: t("playerUnavailable"),
    playerRetrying: t("playerRetrying"),
    playerSuspectedBody: t("playerSuspectedBody"),
    playerRestart: t("playerRestart"),
    programNow: t("programNow"),
    moderatorPin: t("moderatorPin"),
    chatLoading: t("chatLoading"),
    chatEmpty: t("chatEmpty"),
    chatParticipant: t("chatParticipant"),
    chatYou: t("chatYou"),
    chatNewMessages: t("chatNewMessages"),
    chatSendError: t("chatSendError"),
    chatReconnecting: t("chatReconnecting"),
    chatDisconnected: t("chatDisconnected"),
    composerPlaceholder: t("composerPlaceholder"),
    composerSend: t("composerSend"),
    displayNamePrompt: {
      title: t("displayNamePrompt.title"),
      description: t("displayNamePrompt.description"),
      label: t("displayNamePrompt.label"),
      placeholder: t("displayNamePrompt.placeholder"),
      submit: t("displayNamePrompt.submit"),
      error: t("displayNamePrompt.error"),
    },
    errors: {
      displayNameRequired: tv("displayNameRequired"),
      displayNameTooLong: tv("displayNameTooLong"),
      required: tv("required"),
      fallback: tv("fallback"),
    },
  };
}
