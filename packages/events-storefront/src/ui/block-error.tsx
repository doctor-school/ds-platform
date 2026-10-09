"use client";

import { useRouter } from "next/navigation";
import { Button } from "@ds/design-system/button";
import { EmptyState } from "@ds/design-system/blocks";

import { FEED_COPY } from "../copy/feed-copy";

/**
 * A block's own failure (019 EARS-9 + «Amendment — 2026-10-05»): the cause in
 * Russian and «Повторить» (or the host block's own retry label — the home
 * block's «Обновить», 017 design §6), while the other blocks stay usable.
 * Without its own `onRetry` the retry re-runs the server render, which
 * re-issues the read.
 */
export function BlockError({
  title,
  description,
  testId,
  onRetry,
  retryLabel = FEED_COPY.retry,
}: {
  title: string;
  description?: string;
  testId: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const router = useRouter();
  return (
    <div data-testid={testId}>
      <EmptyState
        variant="error"
        title={title}
        {...(description ? { description } : {})}
        action={
          <Button
            variant="outline"
            onClick={() => (onRetry ? onRetry() : router.refresh())}
          >
            {retryLabel}
          </Button>
        }
      />
    </div>
  );
}
