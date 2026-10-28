import { forwardedSessionFrom } from "@ds/schemas";

/**
 * 003 EARS-61 / 62 / 63 — the storefront servers' reach into the API's
 * internal OIDC routes (`/v1/internal/oidc/*`, the compose network only, the
 * `INTERNAL_API_TOKEN` bearer): shared by the entry, the callback and the
 * silent check (ADR-0015 §4 steps 1, 3 and 4).
 */
/** ADR-0015 §4 step 1 — the host-only transaction cookie. */
export const OIDC_TX_COOKIE = "__Host-ds_oidc_tx";

export interface InternalApi {
  readonly base: string;
  readonly token: string;
}

export function internalApi(
  env: Readonly<Record<string, string | undefined>>,
): InternalApi | null {
  const base = env.INTERNAL_API_URL?.trim();
  const token = env.INTERNAL_API_TOKEN?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/$/, ""), token };
}

/** The browser's fingerprint surface and client chain, as the BFF rewrites forward them. */
export function internalHeaders(
  api: InternalApi,
  request: Headers,
): HeadersInit {
  const s = forwardedSessionFrom(request);
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${api.token}`,
    ...(s.userAgent ? { "user-agent": s.userAgent } : {}),
    ...(s.acceptLanguage ? { "accept-language": s.acceptLanguage } : {}),
    ...(s.forwardedFor ? { "x-forwarded-for": s.forwardedFor } : {}),
  };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}
