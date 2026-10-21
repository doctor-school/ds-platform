import { tagExpressionFor, type StorefrontHostId } from "./host-tags.js";

export function authLimitTagsFor(
  host: StorefrontHostId,
  env: { E2E_AUTH_LIMIT_TIER?: string; E2E_PORTAL_URL?: string },
): string {
  const base = `(${tagExpressionFor(host)})`;
  if (env.E2E_AUTH_LIMIT_TIER === undefined)
    return `${base} and not @default-auth-limits`;
  if (env.E2E_AUTH_LIMIT_TIER !== "default")
    throw new Error("E2E_AUTH_LIMIT_TIER must be unset or default");

  let url: URL;
  try {
    url = new URL(env.E2E_PORTAL_URL ?? "");
  } catch {
    throw new Error(
      "default auth-limit contour requires a loopback E2E_PORTAL_URL",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(
      "default auth-limit contour requires a loopback E2E_PORTAL_URL",
    );

  return host === "academy"
    ? `${base} and @default-auth-limits`
    : "@host:doctor and not @host:doctor";
}
