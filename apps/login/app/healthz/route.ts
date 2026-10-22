/**
 * The image's liveness probe (runtime-images `verify (login)`, the stand
 * healthcheck). Every page route answers top-level navigations only and asks
 * the API's entry (003 EARS-70), so no page can be a probe; this answer
 * carries no auth state, sets no cookie and never reaches the API. The proxy
 * lets exactly this path through its navigate-only gate, with the same
 * hardening headers as every other answer.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("ok", {
    status: 200,
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });
}
