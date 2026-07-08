import { UnauthorizedError } from "centrifuge";
import { RoomConfigSchema } from "@ds/schemas";

/**
 * 006 EARS-3 — the chat connection-token REFRESH read. centrifuge-js invokes the
 * client's `getToken` callback whenever a fresh connection token is needed (on
 * token expiry — the server-issued token carries a finite `exp`, config
 * `CHAT_TOKEN_TTL_SECONDS`), so a webinar longer than one TTL keeps its chat alive:
 * the SDK transparently refreshes and the subscription survives.
 *
 * The refresh rides the SAME server-side admission gate as the original grant —
 * it simply re-fetches `GET /v1/events/:slug/room` (same-origin, the `__Host-`
 * session cookie rides via the `/v1/*` rewrite) and returns the fresh gate-scoped,
 * subscribe-only token from `RoomConfig.chat`. No dedicated refresh endpoint, no
 * parallel weaker path: a caller the gate no longer admits (session expired → 401,
 * registration gone → 403, room closed → 409, event gone → 404) gets NO token.
 *
 * Refusal semantics follow the centrifuge-js `getToken` contract:
 * - a gate refusal (401/403/404/409) throws {@link UnauthorizedError} — the SDK
 *   stops reconnecting (the caller is no longer admitted; retrying cannot help);
 * - a transient failure (5xx / network) throws a plain error — the SDK retries
 *   with backoff, so a blip never permanently kills the chat.
 */
export async function fetchFreshChatToken(slug: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/v1/events/${encodeURIComponent(slug)}/room`, {
      credentials: "include",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (cause) {
    // Network blip — transient; the SDK retries with backoff.
    throw new Error(`chat token refresh failed: ${String(cause)}`, { cause });
  }
  if ([401, 403, 404, 409].includes(res.status)) {
    // The admission gate refused — the caller is no longer admitted to this room
    // (or the room closed). Terminal for this connection: stop reconnecting.
    throw new UnauthorizedError(`room gate refused the refresh (${res.status})`);
  }
  if (!res.ok) {
    // Server-side transient (5xx) — retryable.
    throw new Error(`chat token refresh failed with status ${res.status}`);
  }
  const config = RoomConfigSchema.parse(await res.json());
  if (!config.chat) {
    // The grant no longer carries a chat credential (Centrifugo unconfigured on
    // this runtime) — terminal: there is no token to refresh to.
    throw new UnauthorizedError("room grant carries no chat credential");
  }
  return config.chat.token;
}
