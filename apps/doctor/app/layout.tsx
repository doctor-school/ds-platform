import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Inter } from "next/font/google";

export const metadata: Metadata = {
  title: "Doctor.School",
  description: "Doctor.School — витрина врача",
};

/**
 * Inter is the brand UI base font (`font.family.base`). The design-system token
 * `--font-sans` already declares an Inter-leading stack; here we self-host Inter
 * via `next/font` and bind the loaded face to `--font-sans` on `<html>`, so the
 * rendered UI is the actual Inter webfont (not a fallback) while the token stays
 * the single source of truth for which family is the base. Same binding the
 * portal root layout uses.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Root layout of the doctor storefront (`doctor.school`, ADR-0015 §2).
 *
 * RU-only, and deliberately thinner than the portal's: no `next-intl` provider
 * (there is no client copy to translate yet — a literal `lang="ru"` is honest
 * for a single-locale shell), no `@chrome` parallel route (there are no
 * application routes to wrap), no theme toggle (no interactive surface yet).
 * Each of those is a portal facility this app adopts WHEN it gains the surface
 * that needs it, not before — an unused provider would be scaffolding.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ru"
      className={inter.variable}
      style={
        {
          // Resolve the `--font-sans` token to the self-hosted Inter face first,
          // keeping the token's emoji/system fallbacks after it. Narrow,
          // intentional exception to no-token-redefinition (#234): this does NOT
          // fork the token's *value* — it binds the `next/font` loaded Inter face
          // into the SAME family the token already names.
          // eslint-disable-next-line local/no-token-redefinition -- bind self-hosted next/font Inter into the token's own family stack; not a value fork
          "--font-sans":
            "var(--font-inter), ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
        } as CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
