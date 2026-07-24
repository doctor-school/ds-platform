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
 * VK's `embedRef` is `oid_id` with an OPTIONAL `_hash` suffix (`@ds/schemas`
 * `EMBED_REF_SHAPES.vk` validated the shape at authoring time, #1134). VK's
 * current «Встроить» dialog for a public video omits the hash (the player renders
 * from oid+id alone); private/unlisted embeds carry it. Split on `_`: 2 parts =
 * bare oid_id (no hash), 3 parts = with hash (the hash carries no underscore, so
 * the third segment is the whole hash). `oid` keeps its leading `-` for a
 * community. Returns `null` if the value is not well-formed (defensive; the
 * server-side shape guard means it is).
 */
function parseVkTriple(
  embedRef: string,
): { oid: string; id: string; hash?: string } | null {
  const parts = embedRef.split("_");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { oid: parts[0], id: parts[1] };
  }
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return { oid: parts[0], id: parts[1], hash: parts[2] };
  }
  return null;
}

/**
 * Provider embed-URL templates. Keyed by the enum value, never derived by
 * inspecting `embedRef`:
 * - `rutube` / `youtube` — the provider's fixed published embed path + the id.
 * - `vk` — re-composes VK's `video_ext.php?oid&id` embed endpoint from the ref,
 *   appending `&hash` only when the ref carried one (canonical host `vk.com`; the
 *   hash is optional per VK's current «Встроить» dialog; live streams use the same
 *   shape, #1134).
 * - `cdnvideo` — the embedRef IS the whole provisioned Aloha-player URL
 *   (host-allowlisted at the 007 SSOT boundary), embedded verbatim (#1134).
 */
const EMBED_SRC: Record<StreamProvider, (embedRef: string) => string> = {
  rutube: (id) => `https://rutube.ru/play/embed/${encodeURIComponent(id)}`,
  youtube: (id) => `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
  vk: (embedRef) => {
    const t = parseVkTriple(embedRef);
    if (!t) return "";
    const base = `https://vk.com/video_ext.php?oid=${t.oid}&id=${t.id}`;
    return t.hash ? `${base}&hash=${t.hash}` : base;
  },
  cdnvideo: (url) => url,
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
