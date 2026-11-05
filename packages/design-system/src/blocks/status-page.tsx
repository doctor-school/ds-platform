import type { ReactNode } from "react";

import { cn } from "../lib/utils";

/**
 * `<StatusPage>` (#2478) — the platform's ONE error page, lifted out of the
 * sign-in refusal page (003 EARS-72, canvas
 * `design-source/sign-in-refusal.dc.html`, #3379): one centred column —
 * heading, one line, the actions — inside the host's own shell.
 *
 * Every error or absence case on a storefront is a STATE of this page with its
 * own copy (the refusal, the not-found state, …), never a new page or canvas
 * (owner decision 2026-11-05, #2478). The state's composition — copy, variant
 * pick, actions and their behaviour — stays with its owner package
 * (`@ds/auth-flow` for the refusal, `@ds/storefront-shell` for not-found).
 *
 * Presentation only: every string and action is supplied by the caller. No
 * client hooks → server-safe, no `"use client"`. It renders no `<main>`: the
 * host frame owns the page's one landmark.
 */
export interface StatusPageProps {
  /** The state's heading — the page's `h1`. */
  readonly title: ReactNode;
  /** The one line under the heading. */
  readonly text: ReactNode;
  /** The state's actions: the primary first, the way out after it. */
  readonly actions: ReactNode;
  /**
   * `row` (default) — the actions sit side by side on wide screens and stack
   * on narrow ones; `stack` — always one column (a way out that is a line of
   * text, not a single link).
   */
  readonly actionsLayout?: "row" | "stack";
}

export function StatusPage({ title, text, actions, actionsLayout = "row" }: StatusPageProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16 lg:py-24">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-balance text-3xl font-extrabold leading-title">{title}</h1>
          <p className="text-pretty text-lg leading-normal text-muted-foreground">{text}</p>
        </div>
        <div
          className={cn(
            "flex w-full flex-col items-center gap-4",
            actionsLayout === "row" &&
              "lg:w-auto lg:flex-row lg:flex-wrap lg:justify-center lg:gap-6",
          )}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}
