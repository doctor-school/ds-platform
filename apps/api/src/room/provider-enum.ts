import { StreamProviderSchema, type StreamConfig } from "@ds/schemas";

/**
 * 006 EARS-2 — resolve the embed player's source for the `RoomConfig` grant from
 * the event's 007-authored stream config (design §3).
 *
 * The provider is read from the **closed enum** {@link StreamProviderSchema}
 * (`rutube | youtube`) — the room switches the player on this value and NEVER
 * inspects/sniffs the `embedRef` (a provider-scoped stream id, possibly
 * URL-shaped) to guess which player to build (the legacy URL-sniffing mistake,
 * requirements Constraints / design §3).
 *
 * The result is **fail-closed**:
 *   • an absent stream config (007 not yet authored, or incomplete) → `null`;
 *   • a config whose `provider` is outside the closed enum (a drifted/unknown
 *     value) → `null`.
 * `null` is the truthful "stream unavailable" room state the portal renders — the
 * gate still admitted the caller (the grant is issued), there is simply no player
 * to instantiate. A `null` here is never a guessed embed (EARS-2).
 */
export function resolveRoomStream(
  config: StreamConfig | null | undefined,
): StreamConfig | null {
  if (!config) return null;
  // Provider is read from the CLOSED enum, never inferred from the embedRef.
  const provider = StreamProviderSchema.safeParse(config.provider);
  if (!provider.success) return null;
  return { provider: provider.data, embedRef: config.embedRef };
}
