import type { ReactNode } from "react";
import NextLink from "next/link";
import { Link } from "@ds/design-system/link";

/**
 * Shared chrome for a showcase section page (Tokens / Primitives / …). Pure
 * presentation composed from the real `@ds/design-system` exports — the showcase
 * adds nothing of its own (spec §2.4). The back-affordance is the real `Link`
 * primitive (`asChild` over `next/link`), so the chrome itself dogfoods the
 * package it catalogues.
 */
export function SectionShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link asChild variant="standalone" className="text-sm">
          <NextLink href="/">← Showcase home</NextLink>
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="max-w-3xl text-base text-muted-foreground">{intro}</p>
      </header>
      {children}
    </main>
  );
}
