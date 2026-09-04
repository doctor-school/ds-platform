/**
 * `@ds/room` — the client barrel: the room's pure model, its browser transport and
 * (from the composition slice) the room parts themselves.
 *
 * The display-name helpers are deliberately NOT re-exported here — they live on the
 * `@ds/room/display-name` subpath (D20) so a non-room surface can use them without
 * pulling the chat transport into its module graph.
 */

// Model — pure, no I/O, no React.
export { resolveEmbed, type ResolvedEmbed } from "./model/room-player";
export {
  INITIAL_PLAYER_STATE,
  PLAYER_MAX_AUTO_RETRIES,
  PLAYER_RETRY_DELAY_MS,
  PLAYER_WATCHDOG_MS,
  PROVIDER_HAS_PARENT_API,
  mapYouTubeErrorCode,
  parseProviderSignal,
  playerReducer,
  type PlayerAction,
  type PlayerFailureKind,
  type PlayerGrade,
  type PlayerSignal,
  type PlayerState,
  type PlayerStatus,
} from "./model/room-player-state";
export { applyPresenceCountPublication } from "./model/presence-channel";

// Client — "use client" hooks and the browser transport.
export {
  usePlayerFailureState,
  type PlayerFailureState,
} from "./client/use-player-failure-state";
export { fetchFreshChatToken } from "./client/room-chat-token";
export {
  createBrowserRoomApi,
  RoomApiError,
  type BrowserRoomApi,
  type BrowserRoomApiOptions,
} from "./client/room-api";

// Composition — the whole gated room as one host-agnostic unit (006 EARS-11).
export { RoomShell } from "./room-shell";
export * from "./ui";

// The host-injection contract (D14 / D19 / D22).
export {
  ROOM_COPY_CALLBACK_KEYS,
  ROOM_COPY_KEYS,
  readRoomCopyKey,
} from "./copy/room-copy";
export type {
  RoomContext,
  RoomCopy,
  RoomCopyStrings,
  RoomDisplayNamePromptCopy,
  RoomLinkComponent,
  RoomRoutes,
  RoomShellProps,
  RoomShellServerProps,
  RoomValidationCopy,
} from "./types";
