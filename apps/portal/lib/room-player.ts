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
  | {
      readonly kind: StreamProvider;
      readonly src: string;
      readonly directUrl: string;
    }
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

/**
 * Provider DIRECT-watch URLs — the provider's own public watch page for the same
 * stream (#1125). The embed `src` above can render a silent black iframe the app
 * cannot detect cross-origin: the provider refuses the `/embed/` frame while the
 * watch page still plays — YouTube geo-blocking in RU, or an «Allow embedding»
 * broadcast setting left off. So every resolvable embed ALSO carries the direct
 * watch URL, surfaced as an always-present truthful escape hatch beneath the
 * player. Fixed per provider, keyed by the enum, never sniffed from `embedRef`.
 */
const DIRECT_URL: Record<StreamProvider, (embedRef: string) => string> = {
  rutube: (id) => `https://rutube.ru/video/${encodeURIComponent(id)}/`,
  youtube: (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
};

export function resolveEmbed(
  stream: StreamConfig | null | undefined,
): ResolvedEmbed {
  // Absent / unknown stream → the truthful "stream unavailable" room state
  // (the server already fails closed on an unknown provider, EARS-2). The portal
  // fails closed too rather than guessing an embed.
  if (!stream) return { kind: "unavailable" };
  const build = EMBED_SRC[stream.provider];
  const buildDirect = DIRECT_URL[stream.provider];
  if (!build || !buildDirect) return { kind: "unavailable" };
  return {
    kind: stream.provider,
    src: build(stream.embedRef),
    directUrl: buildDirect(stream.embedRef),
  };
}
