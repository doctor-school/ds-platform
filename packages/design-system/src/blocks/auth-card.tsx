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
 * `<AuthCard>` (#235) — the owned screen-scaffold the auth surfaces (login /
 * register / reset / verify) compose into. It is the re-skinned, token-only
 * distillation of the shadcn "auth card" chrome (a centered card with an
 * icon+title header, a description, a content slot, and an optional footer of
 * secondary links) — kept minimal-owned rather than importing a heavy block, per
 * the §3.1 acceptance bar.
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
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle>{title}</CardTitle>
        </div>
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
