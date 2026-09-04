/**
 * `@ds/room/ui` — the room's parts, for a host that composes them itself.
 *
 * A host that wants the WHOLE room mounts {@link RoomShell} from the package root
 * instead; this subpath exists for the surfaces that need one part on its own (the
 * JIT display-name prompt, which a host renders INSTEAD of the room — 006 EARS-14 —
 * and the presence provider, which the account/header surfaces read).
 */
export {
  DisplayNamePrompt,
  translateDisplayNameIssue,
  type DisplayNamePromptProps,
  type RoomZodIssueLike,
} from "./display-name-prompt";
export { PresenceHeartbeat } from "./presence-heartbeat";
export { RoomChat, type RoomChatCopy } from "./room-chat";
export { RoomHeaderBar, type RoomHeaderBarProps } from "./room-header-bar";
export {
  LiveDuration,
  PresenceCount,
  RoomPresenceProvider,
  usePresenceCount,
  usePresenceCountSetter,
} from "./room-presence";
export { PlayerFrame, RoomView, type RoomViewCopy } from "./room-view";
