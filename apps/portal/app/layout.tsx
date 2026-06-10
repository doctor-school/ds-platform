import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: "Doctor.School",
  description: "Doctor.School user portal",
};

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
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
