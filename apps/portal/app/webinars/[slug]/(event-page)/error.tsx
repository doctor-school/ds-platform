"use client";

import { EventPageError } from "@ds/event-page/error";

/**
 * 020 EARS-19 (wave-3 gate row 28, D8) — the event page's failed read is the
 * package's canvas error card; «Повторить» re-renders this segment.
 */
export default function EventPageErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <EventPageError reset={reset} />;
}
