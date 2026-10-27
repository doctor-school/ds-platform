import { storefrontEntry } from "@ds/auth-flow/server";

import { DOCTOR_STOREFRONT_OIDC } from "../../../lib/auth-flow.host-config";

/** 003 EARS-24 / 61 / 71 — the registration entry: a `303` into a new interactive transaction with `prompt=create`. */
export function GET(request: Request): Promise<Response> {
  return storefrontEntry(request, DOCTOR_STOREFRONT_OIDC, "register");
}
