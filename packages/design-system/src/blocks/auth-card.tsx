import * as React from "react";

import { cn } from "../lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../primitives/card";

/**
 * The auth family's eyebrow recipe (#2027, canvas `design-source/auth.dc.html`
 * 66/106/187): 11px weight 800, uppercase, on the `micro` tracking, in the faint
 * tone. «Способ входа», «Канал кода» and «Условия доступа» are the same kind of
 * line on three screens, so they share ONE recipe rather than three hand-tuned
 * class strings that drift apart. Package-internal on purpose — it is a family
 * detail, not a public API surface.
 */
export const AUTH_EYEBROW =
  "text-eyebrow font-extrabold uppercase tracking-micro text-faint";

/**
 * `<AuthCard>` (#235, re-skinned to the neo-brutalist language in #517) — the owned
 * screen-scaffold the auth surfaces (login / register / reset / verify) compose into.
 * It renders the neo-brutalist `Card` primitive (square, 2px structural border, 6px
 * offset `elevation` cast) and, per the canvas `auth-card` unit, promotes the `icon`
 * into a square TINT-filled badge tile stacked ABOVE a heavy, up-scaled title with the
 * description below — no longer a small glyph inline beside the title.
 *
 * The badge tile paints from the `tint` surface with the `info` accent glyph the canvas
 * draws (`auth.dc.html:62`), never a hardcoded colour; an app-supplied icon that carries
 * its own `text-*` class keeps that colour (the tile only provides the default). At the
 * `layout` breakpoint the family steps its own inner padding to the canvas 36px — the
 * global `Card` primitive keeps its 24px and is not touched.
 *
 * It is a presentation scaffold ONLY: the form, BFF calls, EARS-16 error mapping,
 * routing and i18n are app glue and stay in the app/composition layer. All copy
 * (`title`, `description`) and the `icon` are passed in (no i18n inside the
 * package). RSC: no client hooks here, so NO `"use client"` — it is server-safe;
 * the interactive children the app passes carry their own `"use client"`.
 */
export function AuthCard({
  title,
  description,
  errorBanner,
  icon,
  footer,
  className,
  contentClassName,
  children,
  ...rest
}: {
  /** Card title (app-supplied, localized). */
  title: React.ReactNode;
  /** Card description / sub-copy (app-supplied, localized). */
  description?: React.ReactNode;
  /**
   * Operation-level failure, rendered ABOVE the icon and the title (canvas
   * `auth.dc.html:56-61`): a refused command or an expired challenge is about
   * the whole screen, so it stands where the eye enters the card instead of
   * beside the submit. Field-level messages stay at their field.
   */
  errorBanner?: React.ReactNode;
  /** Optional leading icon rendered next to the title (e.g. a lucide glyph). */
  icon?: React.ReactNode;
  /** Optional footer slot — secondary links (e.g. "create account"). */
  footer?: React.ReactNode;
  /** Extra classes for the outer `<Card>`. */
  className?: string;
  /** Extra classes for the content region. */
  contentClassName?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Card>, "title">) {
  return (
    <Card className={className} {...rest}>
      {/* `space-y-2.5`: the canvas 10px between the title and its sub-copy
          (canvas 64 `margin:10px 0 24px`) — the family's rhythm, composed here
          so the global `CardHeader` keeps its 6px default for every other card. */}
      <CardHeader className="space-y-2.5 layout:px-9 layout:pt-9">
        {errorBanner}
        {icon ? (
          // Neo-brutalist badge tile (#517, canvas `auth.dc.html:62`): a square 52px
          // tint surface holding the app-supplied glyph, above the title, with 20px of
          // air under it. `text-info` is the canvas accent (#2D84F2) and the default
          // glyph colour; an icon with its own `text-*` class overrides it.
          // `[&_svg]:size-6.5` normalises the glyph to the canvas 26px.
          <span className="mb-5 inline-flex size-13 items-center justify-center bg-tint text-info [&_svg]:size-6.5">
            {icon}
          </span>
        ) : null}
        <CardTitle className="text-title-xl font-extrabold tracking-tight leading-title">
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="leading-prose">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {/* The card's bottom inset belongs to its LAST region: with a footer the
          content keeps the primitive's 24px, which is the canvas gap above the
          footer line (canvas 212 `margin-top:24px`), and the footer closes on
          the 36px inset — the two never stack into a 36px gap. */}
      <CardContent
        className={cn(
          "layout:px-9",
          footer ? undefined : "layout:pb-9",
          contentClassName,
        )}
      >
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className="flex-col items-start gap-1 text-caption layout:px-9 layout:pb-9">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
