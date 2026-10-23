import { storefrontCallback } from "@ds/auth-flow/server";

import { ACADEMY_STOREFRONT_OIDC } from "../../../lib/auth-flow.host-config";

/**
 * 003 EARS-62 — the storefront callback (the client's one `redirect_uri`):
 * `GET` redeems through the internal API and answers `303 <path>#`; a `POST`
 * (`response_mode=form_post`) is refused with that `303`, its body unread.
 */
export function GET(request: Request): Promise<Response> {
  return storefrontCallback(request, ACADEMY_STOREFRONT_OIDC);
}

export function POST(request: Request): Promise<Response> {
  return storefrontCallback(request, ACADEMY_STOREFRONT_OIDC);
}
