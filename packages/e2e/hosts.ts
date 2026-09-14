/**
 * The e2e HOST REGISTRY — one entry per storefront the regression contract drives
 * (staging/regression-contour tech spec §6.1 «a host-specific step reads a
 * `HostConfig` field of the step package», §6.6 env names).
 *
 * A step is written ONCE and shared by both hosts; where the two storefronts
 * genuinely differ (base URL, login route, whether the host carries an `h1` on a
 * given surface) the step reads the field from here rather than branching on a
 * host name at the call site.
 *
 * ── Why the navigation model is a PATH, not an import ────────────────────────
 * `local/package-import-boundary` (one-code-two-storefronts plan §3 rule 3)
 * forbids any `packages/**` module from reaching into `apps/**` — directly, via a
 * host `@/` alias, or by a relative climb. `@ds/e2e` is a package, so it CANNOT
 * `import { portalNavigationModel } from "apps/portal/lib/navigation-model"`.
 * The registry therefore records the module PATH (repo-relative, POSIX) and
 * `loadNavigationModel()` resolves it against the repo root and loads it with a
 * dynamic import at run time. The boundary stays intact and the walk still reads
 * the host's own single list.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NavigationModel } from "./navigation-model.js";

/** The two storefronts. `academy` is `apps/portal`; `doctor` is `apps/doctor`. */
export type HostId = "academy" | "doctor";

export interface HostConfig {
  readonly id: HostId;
  /** The env var holding this host's base URL on the slot under test (§6.6). */
  readonly baseUrlEnv: "E2E_PORTAL_URL" | "E2E_DOCTOR_URL";
  /**
   * Repo-relative POSIX path of the host's navigation-model module — see the
   * boundary note above. Loaded via {@link loadNavigationModel}.
   */
  readonly navigationModelModule: string;
  /** The name of the export that module publishes. */
  readonly navigationModelExport: string;
  /** The host's own login surface — where a guest item redirects to. */
  readonly loginPath: string;
  /** The `h1` the host's login surface renders (the §6.2 redirect assertion). */
  readonly loginHeading: string;
}

export const HOSTS: Readonly<Record<HostId, HostConfig>> = Object.freeze({
  academy: Object.freeze({
    id: "academy",
    baseUrlEnv: "E2E_PORTAL_URL",
    navigationModelModule: "apps/portal/lib/navigation-model.ts",
    navigationModelExport: "portalNavigationModel",
    loginPath: "/login",
    loginHeading: "Вход",
  }),
  doctor: Object.freeze({
    id: "doctor",
    baseUrlEnv: "E2E_DOCTOR_URL",
    navigationModelModule: "apps/doctor/lib/navigation-model.ts",
    navigationModelExport: "doctorNavigationModel",
    loginPath: "/login",
    loginHeading: "Вход",
  }),
});

/** Every host id, for the config's project list and for a walk that drives both. */
export const HOST_IDS = Object.freeze(Object.keys(HOSTS) as HostId[]);

/** A host id that is not registered, or a base URL that is not configured. */
export class HostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostConfigError";
  }
}

/** Resolve a Playwright project name to its host config. */
export function hostById(id: string): HostConfig {
  const host = HOSTS[id as HostId];
  if (!host) {
    throw new HostConfigError(
      `unknown e2e host "${id}". Registered: ${HOST_IDS.join(", ")}.`,
    );
  }
  return host;
}

/**
 * The host's base URL on the slot under test. Unset → a NAMED failure: an e2e run
 * silently defaulting to localhost would report a green pass against nothing.
 */
export function baseUrlFor(host: HostConfig): string {
  const url = process.env[host.baseUrlEnv];
  if (!url) {
    throw new HostConfigError(
      `${host.baseUrlEnv} is unset, so the "${host.id}" host has no slot to drive.`,
    );
  }
  return url.replace(/\/+$/, "");
}

/** The repo root, resolved from this package's own location. */
function repoRoot(): string {
  const require = createRequire(import.meta.url);
  return resolve(dirname(require.resolve("./package.json")), "..", "..");
}

/**
 * Load a host's navigation model across the package→app boundary (see the note
 * at the top of this file). The dynamic import runs under the Playwright
 * TypeScript loader, which is what makes a `.ts` module path loadable here.
 */
export async function loadNavigationModel(
  host: HostConfig,
): Promise<NavigationModel> {
  const file = resolve(repoRoot(), host.navigationModelModule);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const model = mod[host.navigationModelExport];
  if (!Array.isArray(model)) {
    throw new HostConfigError(
      `${host.navigationModelModule} does not export "${host.navigationModelExport}" as a navigation model.`,
    );
  }
  return model as NavigationModel;
}
