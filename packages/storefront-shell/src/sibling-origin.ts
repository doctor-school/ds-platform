import type { StorefrontHostId } from "./config";

/**
 * 017 EARS-12 / LD-4 — the origin of the SIBLING storefront, the one host a
 * storefront's footer crossing leaves for (#3147).
 *
 * The two storefronts are separate deployables on separate hosts (ADR-0015 §2),
 * and which hosts those are is per-ENVIRONMENT configuration, not a host value:
 * production `academy.doctor.school` ↔ `doctor.school`, a stage slot its own
 * `academy-<slot>.…` ↔ `doctor-<slot>.…` pair, the local stand two localhost
 * ports. A literal production origin in the host config sent a slot's crossing
 * out to production.
 *
 * Read at REQUEST time on the server (each host's layout resolves it and hands
 * it to its host config), never as `NEXT_PUBLIC_*`: slot images are built once
 * per commit and shared by every slot on that commit, so a build-time host would
 * carry one slot's origin into another. The admin's `ACADEMY_PUBLIC_ORIGIN`
 * reader (#2619) is the precedent, and the doctor storefront reads that SAME
 * variable — one name per origin in every environment.
 *
 * There is deliberately NO production fallback: a missing or malformed value
 * refuses by name, so a misconfigured environment fails visibly instead of
 * silently linking to production.
 */
export const SIBLING_ORIGIN_ENV = {
  doctor: "ACADEMY_PUBLIC_ORIGIN",
  academy: "DOCTOR_PUBLIC_ORIGIN",
} as const satisfies Record<StorefrontHostId, string>;

const PRODUCTION_EXAMPLE: Record<StorefrontHostId, string> = {
  doctor: "https://academy.doctor.school",
  academy: "https://doctor.school",
};

export function readSiblingOrigin(
  env: Readonly<Record<string, string | undefined>>,
  host: StorefrontHostId,
): string {
  const name = SIBLING_ORIGIN_ENV[host];
  const example = PRODUCTION_EXAMPLE[host];
  const raw = (env[name] ?? "").trim();
  if (!raw) {
    throw new Error(
      `${name} is not set — the ${host} storefront needs its sibling storefront's public origin (e.g. ${example})`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name}=${JSON.stringify(raw)} is not an absolute URL`);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${name}=${JSON.stringify(raw)} must be a bare http(s) origin such as ${example}`,
    );
  }
  return url.origin;
}
