import { storefrontEntry } from "@ds/auth-flow/server";

import { DOCTOR_STOREFRONT_OIDC } from "../../../lib/auth-flow.host-config";

/** 003 EARS-24 / 39 / 61 — the registration code step's entry: a `303` into the registration door of a new interactive transaction. */
export function GET(request: Request): Promise<Response> {
  return storefrontEntry(request, DOCTOR_STOREFRONT_OIDC, "verify");
}
