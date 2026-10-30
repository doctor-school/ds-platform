import { storefrontSignOut } from "@ds/auth-flow/server";

/**
 * 003 EARS-10 (amended) — the storefront sign-out: the API ends the shared
 * session and every linked storefront session on both storefronts, and this
 * storefront gets the signed guest marker (EARS-63 (a)).
 */
export function POST(request: Request): Promise<Response> {
  return storefrontSignOut(request);
}
