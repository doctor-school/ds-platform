import "./globals.css";
import type { Metadata } from "next";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Doctor.School — Администрирование",
  description: "Doctor.School admin — event administration (feature 007)",
};

/**
 * Inter is the brand UI base font (`font.family.base`). We self-host Inter via
 * `next/font` and bind the loaded face into the `--font-sans` token's family so
 * the rendered UI is the real Inter webfont while the token stays the SoT for
 * which family is the base (mirrors the portal root layout, #234).
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Root layout (thin SSR shell over the Refine CSR app, ADR-0004 §4). Resolves the
 * single-locale (RU) i18n catalog server-side (`i18n/request.ts`) and hands it to
 * the client tree via `<NextIntlClientProvider>`, then mounts the Refine
 * `<Providers>` so every page reads its copy from the catalog with
 * `useTranslations` (007 EARS-10).
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
          // Bind the self-hosted next/font Inter face into the token's OWN family
          // stack (not a value fork — mirrors the portal, #234).
          // eslint-disable-next-line local/no-token-redefinition -- bind self-hosted next/font Inter into the token's own family stack; not a value fork
          "--font-sans":
            "var(--font-inter), ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
        } as CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Refine's router provider reads useSearchParams; the admin app is a
              CSR shell (ADR-0004 §4), so a Suspense boundary lets the static
              prerender bail to the client cleanly instead of erroring. */}
          <Suspense fallback={null}>
            <Providers>{children}</Providers>
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
