import Image from "next/image";
import NextLink from "next/link";
import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ShellAuth } from "@/lib/shell-auth";

/**
 * 017 EARS-1 — the storefront header, defined ONCE (canvas `d-home · шапка`).
 *
 * Presentational and pure on purpose: the sign-in branch arrives as the already
 * resolved `auth` prop (`lib/shell-auth.ts` reads it on the server), so the
 * "exactly one cluster" invariant is a property of a total union rather than of
 * a render-time race — and it is directly assertable in a unit test for BOTH
 * branches, which the backend-free Playwright tier cannot reach.
 *
 * Composition, left to right, per the canvas: logo → reserved search slot →
 * theme control → action cluster. A single composition serves both breakpoints:
 * the canvas needed a mobile drawer to hold the search field and the links, and
 * with the search slot shipping EMPTY (LD-6) the remaining controls fit the
 * mobile header directly. A second, hidden mobile copy of the cluster would also
 * put two clusters in the DOM — the exact thing EARS-1 forbids.
 *
 * Styling is tokens-only; the navy header surface is `bg-header` /
 * `text-header-foreground` (the theme-invariant brand roles), and both CTAs are
 * the DS `on-primary` button variant — the white chip designed for that surface.
 */
export function StorefrontHeader({ auth }: { auth: ShellAuth }) {
  return (
    <header
      data-testid="storefront-header"
      className="flex flex-wrap items-center gap-4 bg-header px-4 py-3.5 text-header-foreground layout:px-12"
    >
      {/*
        The brand mark is the WHITE VECTOR WORDMARK, not set text: the canvas
        `d-home · шапка` places `assets/ds-logo-white.svg` directly on the navy
        band, and it is the same in-repo asset the sibling storefront paints on
        the same surface (`public/brand/logo-white.svg`). The file is copied into
        this app rather than imported across the app boundary (ADR-0015 §2 —
        static assets copy, code never crosses).
      */}
      <Link asChild className="flex flex-none">
        <NextLink href="/" data-testid="storefront-logo">
          <Image
            src="/brand/logo-white.svg"
            alt="Doctor.School — на главную"
            width={500}
            height={164}
            priority
            unoptimized
            className="block h-6.5 w-auto"
          />
        </NextLink>
      </Link>

      {/*
        LD-6 — the header search is RESERVED, not built: the input lands with the
        feature that owns the results surface (#1492). The slot holds the layout
        space so the header composition does not shift when it arrives, and it
        ships with no control inside it — a non-working search field would be a
        placeholder affordance, which is worse than an honest absence.
      */}
      <div
        data-testid="shell-search-slot"
        aria-hidden="true"
        className="hidden min-w-0 flex-1 basis-40 layout:block"
      />

      <nav
        aria-label="Действия"
        className="ml-auto flex flex-none items-center gap-3"
      >
        <ThemeToggle />
        {auth.status === "guest" ? (
          <div
            data-testid="shell-action-cluster"
            data-cluster="guest"
            className="flex items-center gap-3"
          >
            <Link asChild tone="on-primary" className="whitespace-nowrap">
              <NextLink href="/login">Войти</NextLink>
            </Link>
            <Button asChild variant="on-primary" className="whitespace-nowrap">
              <NextLink href="/register">Регистрация</NextLink>
            </Button>
          </div>
        ) : (
          <div
            data-testid="shell-action-cluster"
            data-cluster="doctor"
            className="flex items-center gap-3"
          >
            {/*
              The canvas signed-in cluster is «плашка очков» + «Личный кабинет».
              The points plate is NOT rendered here and is NOT stubbed: 017
              design §7 defines no points read, and no shipped contract anywhere
              in `packages/schemas` carries a points value, so the only ways to
              draw the plate today would be to invent a contract or to paint a
              placeholder number at a doctor — both forbidden (AGENTS.md §6
              no-stub / no-workaround). The plate lands with its read contract;
              the slot is left absent rather than faked so nothing about it is
              silently wrong on screen.
            */}
            <Button asChild variant="on-primary" className="whitespace-nowrap">
              <NextLink href="/account">Личный кабинет</NextLink>
            </Button>
          </div>
        )}
      </nav>
    </header>
  );
}
