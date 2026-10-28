import type { Response } from "@playwright/test";

/**
 * 003 EARS-63, ADR-0015 §4 step 4 — a signed-out top-level document
 * navigation on a storefront is first answered by the server-side silent
 * check: `303` to the IdP's authorize (`prompt=none`), the sign-in host,
 * the storefront's `/auth/callback`, then the page itself. A page step that
 * pins «no document redirect» means no redirect AWAY from the page — the
 * silent check's round trip back to the very same address is not one.
 *
 * Returns the hops of `response`'s redirect chain that are NOT part of that
 * round trip: an empty list when the document was served directly, or only
 * through the silent check back to the address it was asked for.
 */
export function redirectsBesidesSilentCheck(
  response: Response | null,
): string[] {
  if (!response) return ["(no response)"];
  const chain: string[] = [];
  for (
    let request: ReturnType<Response["request"]> | null = response.request();
    request;
    request = request.redirectedFrom()
  ) {
    chain.unshift(request.url());
  }
  if (chain.length === 1) return [];
  const first = new URL(chain[0]!);
  const last = new URL(chain.at(-1)!);
  const strays: string[] = [];
  if (
    last.origin !== first.origin ||
    last.pathname !== first.pathname ||
    last.search !== first.search
  ) {
    strays.push(last.href);
  }
  for (const hop of chain.slice(1, -1)) {
    const url = new URL(hop);
    // Off-origin hops are the IdP and the sign-in host; the one same-origin
    // hop is the storefront's own callback.
    if (url.origin === first.origin && url.pathname !== "/auth/callback") {
      strays.push(url.href);
    }
  }
  return strays;
}
