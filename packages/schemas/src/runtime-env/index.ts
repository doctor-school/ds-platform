import contract from "./runtime-env-contract.json" with { type: "json" };

/**
 * #1468 — the runtime-env contract: the variables production's shared env file
 * must carry before a release may change anything. The JSON beside this module is
 * the single source; the release gate (`tools/deploy/prod.mjs`) reads the same
 * file by path from the shipped SHA's tree, and the api's production boot check
 * reads it through this module.
 */
export type RuntimeEnvContainer =
  "api" | "admin" | "portal" | "doctor" | "login";

export interface RuntimeEnvVariable {
  readonly name: string;
  /** The containers that refuse to work without it. */
  readonly containers: readonly RuntimeEnvContainer[];
  /** The Issue / spec that made it required. */
  readonly ref: string;
  /** Required only when the release's service set ships this image. */
  readonly when?: { readonly image: string };
}

export interface RuntimeEnvContract {
  readonly envFile: string;
  readonly variables: readonly RuntimeEnvVariable[];
}

export const RUNTIME_ENV_CONTRACT: RuntimeEnvContract =
  contract as RuntimeEnvContract;

/**
 * A value that does not count as set: absent, blank, or a template placeholder
 * (`<…>` — the only placeholder convention of `infra/deploy/api.env.example`).
 */
export function isUnsetRuntimeEnvValue(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === "" || /<[^>]*>/.test(trimmed);
}

/**
 * The names the api itself refuses to boot without: the contract's `api`
 * entries that hold in every release (a `when` entry depends on the release's
 * service set, which a running api cannot see; the release gate checks it).
 */
export function apiBootRequiredRuntimeEnv(
  c: RuntimeEnvContract = RUNTIME_ENV_CONTRACT,
): string[] {
  return c.variables
    .filter((v) => v.when === undefined && v.containers.includes("api"))
    .map((v) => v.name);
}
