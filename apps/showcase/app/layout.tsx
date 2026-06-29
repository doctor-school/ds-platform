import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Inter } from "next/font/google";

export const metadata: Metadata = {
  title: "DS Platform — Design System Showcase",
  description:
    "Living showcase of @ds/design-system: every token, primitive and block rendered from the real package.",
};

/**
 * Inter is the brand UI base font (`font.family.base`, brand → token map). The
 * design-system token `--font-sans` already declares an Inter-leading stack; here
 * we self-host Inter via `next/font` and bind the loaded face to `--font-sans` on
 * `<html>` exactly as the product apps do, so the showcase renders the actual
 * branded typography (not a fallback) — the catalogue must look like what features
 * render, while the token stays the single source of truth for which family is base.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Root layout for the showcase. Deliberately minimal — no i18n provider, no BFF
 * (the showcase is a pure viewer of `@ds/design-system`, spec §2.1). The only
 * shared concern with the product apps is the token CSS wiring (via globals.css)
 * and the self-hosted Inter face bound into the token's own family stack, so the
 * rendered catalogue is byte-for-byte the look features compose from.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={inter.variable}
      style={
        {
          // Resolve the `--font-sans` token to the self-hosted Inter face first,
          // keeping the token's emoji/system fallbacks after it. This binds the
          // `next/font` loaded Inter face (`--font-inter`) into the SAME family
          // the token already names — it does NOT fork the token's value.
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
