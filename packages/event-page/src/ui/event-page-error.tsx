"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EventPageStateFrame } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";

import { EVENT_PAGE_COPY as COPY } from "../copy/event-page-copy";

/**
 * 020 EARS-19 (wave-3 gate row 28, D8) — the event page's failed read: the
 * canvas `pageState: ошибка` card (`design-source/event-page.dc.html` L60–L64),
 * mounted as each host's event-page `error.tsx` and nothing else. The card sits
 * under the poster band in the canvas's -80px overlap (`EventPageStateFrame`).
 *
 * «Повторить» re-runs the segment's server reads: `router.refresh()` asks the
 * server for a fresh render and `reset()` clears this boundary inside the same
 * transition, so a read that now succeeds renders the page in place of the card.
 */
export function EventPageError({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <EventPageStateFrame>
      <div
        role="alert"
        data-testid="event-page-error"
        className="border-2 border-border bg-card px-7 py-10 text-center shadow-lg layout:px-12 layout:py-12"
      >
        <p className="text-xl font-extrabold tracking-tight text-foreground layout:text-2xl">
          {COPY.error.title}
        </p>
        <p className="mx-auto mt-2.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {COPY.error.body}
        </p>
        <Button
          className="mt-5"
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={pending ? undefined : retry}
        >
          {COPY.error.retry}
        </Button>
      </div>
    </EventPageStateFrame>
  );
}
