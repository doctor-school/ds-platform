import type { StreamConfig, StreamProvider } from "@ds/schemas";

/**
 * 006 EARS-2 / EARS-9 — resolve the embed player's source from the `RoomConfig`
 * stream section, switching on the **explicit provider enum** (`rutube |
 * youtube`) the server issued. The portal NEVER parses/sniffs the embed reference
 * to guess a provider (the legacy mistake, requirements Constraints) — it keys on
 * `stream.provider` and builds the provider's own embed URL from `embedRef` (a
 * provider-scoped stream id).
 *
 * The room composes an **embed frame only** (EARS-9): the resolved `src` is fed to
 * a plain `<iframe>` — no transcode, re-host, proxy, DRM, record, or player-level
 * telemetry. The per-provider base URLs below are the providers' OWN, fixed embed
 * endpoints (part of each provider's public embed contract), not a configurable
 * platform origin — the stream identity comes entirely from `embedRef`.
 */
export type ResolvedEmbed =
  | { readonly kind: StreamProvider; readonly src: string }
  | { readonly kind: "unavailable" };

/**
 * Provider embed-URL templates. Fixed per provider (rutube.ru/play/embed,
 * youtube.com/embed) — the provider's published embed path, keyed by the
 * enum value, never derived by inspecting `embedRef`.
 */
const EMBED_SRC: Record<StreamProvider, (embedRef: string) => string> = {
  rutube: (id) => `https://rutube.ru/play/embed/${encodeURIComponent(id)}`,
  youtube: (id) => `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
};

export function resolveEmbed(
  stream: StreamConfig | null | undefined,
): ResolvedEmbed {
  // Absent / unknown stream → the truthful "stream unavailable" room state
  // (the server already fails closed on an unknown provider, EARS-2). The portal
  // fails closed too rather than guessing an embed.
  if (!stream) return { kind: "unavailable" };
  const build = EMBED_SRC[stream.provider];
  if (!build) return { kind: "unavailable" };
  return { kind: stream.provider, src: build(stream.embedRef) };
}
