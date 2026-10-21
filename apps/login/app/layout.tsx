import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Inter } from "next/font/google";

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
 * no other pages). Unlike the storefronts it carries NO inline pre-paint theme
 * script: the strict nonce CSP (`proxy.ts`, EARS-70) admits only scripts Next
 * stamps with the request nonce, and the doors ship no theme control.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
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
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main>{children}</main>
      </body>
    </html>
  );
}
