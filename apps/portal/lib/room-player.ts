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
 * VK's `embedRef` is the irreducible `oid_id_hash` triple (the hash is a
 * mandatory, non-derivable access token; `@ds/schemas` `EMBED_REF_SHAPES.vk`
 * validated the shape at authoring time, #1134). Split on `_` into its three
 * parts — the hash carries no underscore, so the third segment is the whole hash;
 * `oid` keeps its leading `-` for a community. Returns `null` if the value is not
 * a well-formed triple (defensive; the server-side shape guard means it is).
 */
function parseVkTriple(
  embedRef: string,
): { oid: string; id: string; hash: string } | null {
  const parts = embedRef.split("_");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { oid: parts[0], id: parts[1], hash: parts[2] };
}

/**
 * Provider embed-URL templates. Keyed by the enum value, never derived by
 * inspecting `embedRef`:
 * - `rutube` / `youtube` — the provider's fixed published embed path + the id.
 * - `vk` — re-composes VK's `video_ext.php?oid&id&hash` embed endpoint from the
 *   triple (canonical host `vk.com`; live streams use the same shape, #1134).
 * - `cdnvideo` — the embedRef IS the whole provisioned Aloha-player URL
 *   (host-allowlisted at the 007 SSOT boundary), embedded verbatim (#1134).
 */
const EMBED_SRC: Record<StreamProvider, (embedRef: string) => string> = {
  rutube: (id) => `https://rutube.ru/play/embed/${encodeURIComponent(id)}`,
  youtube: (id) => `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
  vk: (embedRef) => {
    const t = parseVkTriple(embedRef);
    if (!t) return "";
    return `https://vk.com/video_ext.php?oid=${t.oid}&id=${t.id}&hash=${t.hash}`;
  },
  cdnvideo: (url) => url,
};

/**
 * Provider DIRECT (non-embed) watch-URL templates — the provider-scoped link to
 * the video's own page, derived from the same enum + `embedRef` contract:
 * - `rutube` — `rutube.ru/video/<id>/`; `youtube` — `youtu.be/<id>`.
 * - `vk` — `vk.com/video<oid>_<id>` (the embed-only hash is dropped; the public
 *   watch URL needs only oid/id, #1134).
 * - `cdnvideo` — no distinct watch page exists; the player URL IS the artifact,
 *   so the direct URL is the embedRef verbatim (#1134).
 */
const DIRECT_URL: Record<StreamProvider, (embedRef: string) => string | null> = {
  rutube: (id) => `https://rutube.ru/video/${encodeURIComponent(id)}/`,
  youtube: (id) => `https://youtu.be/${encodeURIComponent(id)}`,
  vk: (embedRef) => {
    const t = parseVkTriple(embedRef);
    if (!t) return null;
    return `https://vk.com/video${t.oid}_${t.id}`;
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

/**
 * The provider-scoped DIRECT watch URL for the stream, or `null` when there is no
 * stream / no known provider (never a guessed link) — the same fail-closed posture
 * as {@link resolveEmbed}. Switches on the `provider` enum, never URL-sniffed.
 */
export function resolveDirectUrl(
  stream: StreamConfig | null | undefined,
): string | null {
  if (!stream) return null;
  const build = DIRECT_URL[stream.provider];
  if (!build) return null;
  return build(stream.embedRef);
}
