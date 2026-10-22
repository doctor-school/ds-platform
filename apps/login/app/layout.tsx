import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { headers } from "next/headers";
import { Inter } from "next/font/google";

import {
  SIGN_IN_HOST_ENTRY_HEADER,
  readSignInHostHandOver,
} from "@ds/auth-flow/server";
import { ThemeWatcher } from "@ds/storefront-shell/theme-watcher";

import { SIGN_IN_HOST_THEMES } from "../lib/sign-in-host.host-config";

export const metadata: Metadata = {
  title: "Doctor.School",
  description: "Doctor.School — вход",
  // The host answers only a person's own navigation to a Zitadel auth request;
  // none of its pages is a search result.
  robots: { index: false, follow: false },
};

/** The brand UI base font, bound to `--font-sans` exactly as both storefronts do. */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Root layout of the sign-in host (`login.doctor.school`, ADR-0015 §4).
 *
 * RU-only like the doctor storefront. It owns `<html>`/`<body>` and the page's
 * one `<main>` landmark (the storefronts' `(auth)` group shell; this host has
 * no other pages).
 *
 * Theme (#3170): the variant the proxy's entry hand-over names boots its OWN
 * storefront's theme — the pre-paint script and, for the Academy, the system
 * watcher, both from `SIGN_IN_HOST_THEMES`. The inline script carries the
 * request nonce the proxy put in the forwarded `content-security-policy`
 * header (the same one Next stamps its own scripts with), so the strict CSP
 * stays `'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`. With no
 * storefront known (an unread entry's banner) nothing boots and the page is
 * light.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const request = await headers();
  const handOver = readSignInHostHandOver(
    request.get(SIGN_IN_HOST_ENTRY_HEADER),
  );
  const theme = handOver
    ? SIGN_IN_HOST_THEMES[handOver.render.storefront]
    : null;
  const nonce = /'nonce-([^']+)'/.exec(
    request.get("content-security-policy") ?? "",
  )?.[1];
  return (
    <html
      lang="ru"
      className={inter.variable}
      style={
        {
          // eslint-disable-next-line local/no-token-redefinition -- bind self-hosted next/font Inter into the token's own family stack; not a value fork
          "--font-sans":
            "var(--font-inter), ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
        } as CSSProperties
      }
      suppressHydrationWarning
    >
      {theme && nonce ? (
        <head>
          <script
            nonce={nonce}
            // The variant storefront's own pre-paint theme (see the doc block).
            dangerouslySetInnerHTML={{ __html: theme.initScript }}
          />
        </head>
      ) : null}
      <body className="min-h-screen bg-background text-foreground antialiased">
        {theme?.followsSystem ? <ThemeWatcher /> : null}
        <main>{children}</main>
      </body>
    </html>
  );
}
