import { storefrontEntry } from "@ds/auth-flow/server";

import { ACADEMY_STOREFRONT_OIDC } from "../../lib/auth-flow.host-config";

/** 003 EARS-43 / 44 / 61 / 71 — the sign-in entry (`?method=code`, `&handoff=<ref>`): no form on the storefront, a `303` into a new interactive transaction. */
export function GET(request: Request): Promise<Response> {
  return storefrontEntry(request, ACADEMY_STOREFRONT_OIDC, "login");
}
