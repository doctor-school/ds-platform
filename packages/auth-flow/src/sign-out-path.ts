/**
 * 003 EARS-10 (amended) / EARS-63 (a) — the storefront's own sign-out route,
 * the one path both storefronts mount (`app/auth/sign-out/route.ts`) and the
 * auth client posts to: the storefront server calls the API's sign-out and
 * sets the signed guest marker on its own origin. Under `/auth/`, so the
 * silent check never runs on it (EARS-63 (d)).
 */
export const STOREFRONT_SIGN_OUT_PATH = "/auth/sign-out";
