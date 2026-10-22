import type { SignInHostStorefront } from "@ds/schemas";
import { parseAtRestKey } from "../common/crypto/at-rest.js";
import type { ApiEnv } from "../config/env.schema.js";

/**
 * 003 EARS-60 / 66 / 67, ADR-0015 §4 req. 7 — the resolved sign-in-host settings.
 *
 * `clients` is the fixed per-environment client map: a `client_id` selects a
 * storefront host-config only through it, never through anything the request
 * carries. `loginUrls` are the storefront `/login` pages EARS-66 returns a
 * stale request to; the doctor one is the EARS-67 direct-visit target.
 */
export interface SignInHostSettings {
  readonly clients: ReadonlyMap<string, SignInHostStorefront>;
  readonly loginUrls: Readonly<Record<SignInHostStorefront, string>>;
  /** The sign-in host's own origin — the only `Origin` a form post may carry. */
  readonly hostOrigin: string;
  /** The at-rest key of the record and of the intent's hand-off reference. */
  readonly recordKey: Buffer;
}

export type SignInHostEnv = Pick<
  Partial<ApiEnv>,
  | "IDP_ACADEMY_CLIENT_ID"
  | "IDP_DOCTOR_CLIENT_ID"
  | "IDP_SIGN_IN_BASE_URI"
  | "SIGN_IN_ACADEMY_LOGIN_URL"
  | "SIGN_IN_DOCTOR_LOGIN_URL"
  | "SIGN_IN_RECORD_KEY"
>;

/**
 * `null` — the module is disabled and every sign-in-host route answers 404 —
 * unless every key is set: a partial block never runs half a sign-in host (a
 * map with one storefront, a record without its key). The env schema has
 * already refused a malformed key or URL at boot.
 */
export function resolveSignInHostSettings(
  env: SignInHostEnv,
): SignInHostSettings | null {
  const academy = env.IDP_ACADEMY_CLIENT_ID;
  const doctor = env.IDP_DOCTOR_CLIENT_ID;
  const base = env.IDP_SIGN_IN_BASE_URI;
  const academyLogin = env.SIGN_IN_ACADEMY_LOGIN_URL;
  const doctorLogin = env.SIGN_IN_DOCTOR_LOGIN_URL;
  const recordKey = parseAtRestKey(env.SIGN_IN_RECORD_KEY);
  if (
    !academy ||
    !doctor ||
    !base ||
    !academyLogin ||
    !doctorLogin ||
    !recordKey ||
    academy === doctor
  ) {
    return null;
  }
  return {
    clients: new Map<string, SignInHostStorefront>([
      [academy, "academy"],
      [doctor, "doctor"],
    ]),
    loginUrls: { academy: academyLogin, doctor: doctorLogin },
    hostOrigin: new URL(base).origin,
    recordKey,
  };
}
