import { tagExpressionFor } from "./host-tags.js";

// Fixture twin of packages/e2e/lib/default-auth-limits.ts.
export function authLimitTagsFor(
  host: "academy" | "doctor",
  env: { E2E_AUTH_LIMIT_TIER?: string },
): string {
  const base = `(${tagExpressionFor(host)})`;
  return env.E2E_AUTH_LIMIT_TIER === undefined
    ? `${base} and not @default-auth-limits`
    : `${base} and @default-auth-limits`;
}
