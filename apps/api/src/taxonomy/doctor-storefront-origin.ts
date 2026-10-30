// 030 EARS-2 (#3503) — the configured doctor-storefront origin a result's
// storefront link must sit on. It is the same `DOCTOR_PUBLIC_ORIGIN` the Academy
// footer crossing link uses (017 EARS-12), supplied to the API by the shared
// `api.env` contract; read at request time, and only when a link is checked.
// Unset is a refusal by name, never a silent pass or a hard-coded production host.

export function doctorStorefrontOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env.DOCTOR_PUBLIC_ORIGIN?.trim();
  if (!value) throw new Error("DOCTOR_PUBLIC_ORIGIN is required");
  return value;
}

/**
 * Whether `storefrontUrl` sits on `doctorOrigin`. Both must parse; the
 * comparison is on the normalized `URL.origin`, so `https://host:443` and
 * `https://host` agree and a look-alike host (`host.evil.example`) does not.
 */
export function isOnStorefrontOrigin(
  storefrontUrl: string,
  doctorOrigin: string,
): boolean {
  try {
    return new URL(storefrontUrl).origin === new URL(doctorOrigin).origin;
  } catch {
    return false;
  }
}
