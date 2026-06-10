import { getRequestConfig } from "next-intl/server";

/**
 * Single-locale (RU) next-intl request config (#177). The portal is Russian-only
 * for now with NO user-facing language switcher, so we deliberately do NOT use
 * next-intl's `[locale]` segment routing or locale middleware (that would churn
 * every route for a feature we don't ship yet — ADR-0004 §3). Instead the locale
 * is FIXED to `ru` here and the message catalog is loaded server-side, then handed
 * to the client tree through `<NextIntlClientProvider>` in the root layout.
 *
 * Adding a second locale later is purely additive: drop a `messages/<locale>.json`,
 * resolve `locale` from a cookie/header here, and surface a switcher — no auth
 * component is re-touched, because every string already comes from the catalog.
 */
export const LOCALE = "ru" as const;

export default getRequestConfig(async () => {
  return {
    locale: LOCALE,
    messages: (await import(`../messages/${LOCALE}.json`)).default,
  };
});
