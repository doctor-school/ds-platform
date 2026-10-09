/**
 * `@ds/e2e/admin-events` — the admin-side e2e writers shared by the admin flow
 * specs and the storefront e2e suites (#2751): the `platform_admin` account
 * bootstrap on the stand's IdP, the browser sign-in with its TOTP second factor,
 * and the event writers that drive the real 007 admin screens. Dev-stand-gated:
 * the bootstrap reads `IDP_ISSUER` / `IDP_SERVICE_TOKEN` / `IDP_PROJECT_ID`, the
 * sign-in targets `E2E_ADMIN_URL`.
 */
export * from "./admin-session";
export * from "./event-classification";
export * from "./events";
export * from "./sign-in";
export * from "./totp";
