"use client";

import { Button } from "@ds/design-system/button";
import { EmptyState } from "@ds/design-system/blocks";

import { FEED_COPY } from "../copy/feed-copy";
import { useBlockRetry } from "./block-retry";

/**
 * A block's own failure (019 EARS-9 + «Amendment — 2026-10-05»): the cause in
 * Russian and «Повторить», while the other blocks stay usable. The retry
 * re-runs only this block's read (#2832): the block's own `onRetry` (the live
 * block's re-read of its path), else the {@link BlockRetry} it sits in — never
 * a route refresh, which would re-run every read of the page.
 */
export function BlockError({
  title,
  description,
  testId,
  onRetry,
}: {
  title: string;
  description: string;
  testId: string;
  onRetry?: () => void;
}) {
  const boundary = useBlockRetry();
  const retry = onRetry ?? boundary?.retry;
  if (retry === undefined) {
    throw new Error(
      `BlockError «${testId}» has no retry: pass onRetry or render it inside a BlockRetry`,
    );
  }
  // A retry in flight keeps the control readable: the native `disabled` state
  // (and the Button's `loading`, which sets it) dims an outline control to
  // `opacity-40` with `muted-2` ink on a `hairline` border — near-invisible on
  // the error card. The press is marked busy and ignored instead, so a second
  // press never runs a second read.
  const pending = onRetry === undefined && boundary?.pending === true;
  return (
    <div data-testid={testId}>
      <EmptyState
        variant="error"
        title={title}
        description={description}
        action={
          <Button
            variant="outline"
            aria-busy={pending || undefined}
            aria-disabled={pending || undefined}
            onClick={pending ? undefined : retry}
          >
            {FEED_COPY.retry}
          </Button>
        }
      />
    </div>
  );
}
