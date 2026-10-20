import { LoginHandoffOwnershipResponseSchema } from "@ds/schemas";

import {
  forwardedHeaders,
  forwardedSessionFrom,
  serverApiBase,
} from "./session";

/**
 * 003 EARS-44 (#2951) — «is this hand-off reference this session's own
 * account's», asked by the `/login` SERVER mount before it sends any HTML to a
 * signed-in visitor who opened a hand-off link. `true` lets the mount redirect
 * straight to the carried target, so the visitor never sees the login page.
 *
 * The api answers it read-only (`POST /v1/auth/login/otp/handoff/own`): the
 * reference is only peeked, never redeemed, and no code is sent. The incoming
 * request's session surface rides the hop — cookie, fingerprint headers and
 * client chain — because the session is fingerprint-bound (the same surface
 * every SSR read forwards, see `landing.ts`).
 *
 * `true` ONLY on a well-formed `{ own: true }`. Every other outcome — `own:
 * false`, no session cookie, a 401, a throttle, an upstream failure, an
 * unexpected body — is `false`, and the mount renders exactly as it does
 * without this read (the client door then settles the link). It never throws:
 * one flaky read must not take the sign-in door down.
 *
 * `fetchImpl` is injected by tests; production callers pass nothing.
 */
export async function resolveOwnHandoff(
  ref: string,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const session = forwardedSessionFrom(headers);
  if (!session.cookie) return false;
  try {
    const res = await fetchImpl(
      `${serverApiBase()}/v1/auth/login/otp/handoff/own`,
      {
        method: "POST",
        headers: {
          ...forwardedHeaders(session),
          "content-type": "application/json",
        },
        body: JSON.stringify({ ref }),
        cache: "no-store",
      },
    );
    if (!res.ok) return false;
    const answer = LoginHandoffOwnershipResponseSchema.safeParse(
      await res.json(),
    );
    return answer.success && answer.data.own;
  } catch {
    return false;
  }
}
