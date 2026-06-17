import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: "Doctor.School",
  description: "Doctor.School user portal",
};

/**
 * Inter is the brand UI base font (`font.family.base`, brand → token map §2). The
 * design-system token `--font-sans` already declares an Inter-leading stack; here
 * we self-host Inter via `next/font` and bind the loaded face to `--font-sans` on
 * `<html>`, so the rendered UI is the actual Inter webfont (not a fallback) while
 * the token stays the single source of truth for which family is the base.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Root layout. Wires the single-locale (RU) i18n provider (#177): the locale and
 * the message catalog are resolved server-side from `i18n/request.ts` (fixed `ru`,
 * no routing/middleware) and handed to the client tree via
 * `<NextIntlClientProvider>`, so every `"use client"` auth form reads its copy
 * from the catalog with `useTranslations`. `<html lang>` is driven by the same
 * resolved locale rather than a literal, so a future locale needs no edit here.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={inter.variable}
      style={
        {
          // Resolve the `--font-sans` token to the self-hosted Inter face first,
          // keeping the token's emoji/system fallbacks after it.
          // Narrow, intentional exception to no-token-redefinition (#234): this
          // does NOT fork the token's *value* to a hardcoded one — it binds the
          // `next/font` loaded Inter face (`--font-inter`) into the SAME family
          // the token already names (brand→token map §2), so the rendered UI is
          // the real webfont while the token stays the SoT for which family is base.
          // eslint-disable-next-line local/no-token-redefinition -- bind self-hosted next/font Inter into the token's own family stack; not a value fork
          "--font-sans":
            "var(--font-inter), ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
        } as CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
