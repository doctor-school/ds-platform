import { getRequestConfig } from "next-intl/server";

/**
 * Single-locale (RU) next-intl request config (007 EARS-10). The admin app is
 * Russian-only for now with NO user-facing language switcher, so — like the
 * portal (#177) — we deliberately do NOT use next-intl's `[locale]` segment
 * routing or locale middleware. The locale is FIXED to `ru` here and the message
 * catalog is loaded server-side, then handed to the client tree through
 * `<NextIntlClientProvider>` in the root layout so every `"use client"` Refine
 * page reads its copy from the catalog with `useTranslations` (no hardcoded
 * string survives the `no-hardcoded-display-string` gate).
 */
export const LOCALE = "ru" as const;

export default getRequestConfig(async () => {
  return {
    locale: LOCALE,
    messages: (await import(`../messages/${LOCALE}.json`)).default,
  };
});
