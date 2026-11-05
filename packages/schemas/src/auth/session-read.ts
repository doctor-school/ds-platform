/**
 * The session read both sides of the storefront auth state make: the server's
 * `fetchSessionClaims` (`@ds/auth-flow/server`, against the api base) and the
 * shell's 003 EARS-73 return re-check (`@ds/storefront-shell`, same-origin
 * through the storefront's `/v1/*` proxy). One constant, so the two reads
 * cannot drift apart.
 */
export const AUTH_SESSION_PATH = "/v1/auth/session";
