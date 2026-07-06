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
 * `<AuthCard>` (#235, re-skinned to the neo-brutalist language in #517) — the owned
 * screen-scaffold the auth surfaces (login / register / reset / verify) compose into.
 * It renders the neo-brutalist `Card` primitive (square, 2px structural border, 6px
 * offset `elevation` cast) and, per the canvas `auth-card` unit, promotes the `icon`
 * into a square TINT-filled badge tile stacked ABOVE a heavy, up-scaled title with the
 * description below — no longer a small glyph inline beside the title.
 *
 * The badge tile paints from the AA-safe `tint` / `tint-foreground` token pairing (blue
 * tint surface + ink-blue glyph), never a hardcoded colour; an app-supplied icon that
 * carries its own `text-*` class keeps that colour (the tile only provides the default).
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
      <CardHeader>
        {icon ? (
          // Neo-brutalist badge tile (#517, canvas `auth-card`): a square tint surface
          // holding the app-supplied glyph, above the title. `text-tint-foreground` is
          // the default glyph colour (AA-safe on `tint`); an icon with its own `text-*`
          // class overrides it. `[&_svg]:size-6` normalises the glyph to the canvas 26px.
          <span className="mb-3 inline-flex size-12 items-center justify-center bg-tint text-tint-foreground [&_svg]:size-6">
            {icon}
          </span>
        ) : null}
        <CardTitle className="text-2xl font-extrabold tracking-tight">
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn(contentClassName)}>{children}</CardContent>
      {footer ? (
        <CardFooter className="flex-col items-start gap-1 text-sm">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
