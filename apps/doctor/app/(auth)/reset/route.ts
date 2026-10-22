import { storefrontEntry } from "@ds/auth-flow/server";

import { DOCTOR_STOREFRONT_OIDC } from "../../../lib/auth-flow.host-config";

/** 003 EARS-12 / 61 / 71 — the reset entry: a `303` into a new interactive transaction whose intent opens the reset door. */
export function GET(request: Request): Promise<Response> {
  return storefrontEntry(request, DOCTOR_STOREFRONT_OIDC, "reset");
}
