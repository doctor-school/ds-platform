"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";

import { ENTRY_REFUSAL_COPY } from "../copy/entry-refusal";
import type { EntryRefusalReason } from "../server/entry-refusal";

/** 003 EARS-72 — the way out a host offers under the retry. */
export type EntryRefusalWayOut =
  /** A storefront: one link — back to the event the person came from, else home. */
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  /** The sign-in site (no storefront known): one line naming both sites. */
  | {
      readonly kind: "sites";
      readonly academyHref: string;
      readonly doctorHref: string;
    };

export type EntryRefusalProps = {
  readonly reason: EntryRefusalReason;
  /** The API's wait (`rate-limited` only); `null` ⇒ the retry is open at once. */
  readonly retryAfterSeconds: number | null;
  /** The copy variant the render picked (index into the reason's variants). */
  readonly variant: number;
  readonly wayOut: EntryRefusalWayOut;
  /** The retry navigation; defaults to re-opening the same door URL. */
  readonly retry?: () => void;
};

function reopenDoor(): void {
  window.location.assign(window.location.href);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * 003 EARS-72 — the refusal page's content (canvas
 * `design-source/sign-in-refusal.dc.html`): one centred column — heading,
 * text, the primary retry and the way out. A rate-limited refusal with a
 * wait counts down on the disabled retry and opens it at zero; otherwise the
 * retry is open at once. The retry re-opens the door URL (its loading state
 * shows while it navigates).
 */
export function EntryRefusal({
  reason,
  retryAfterSeconds,
  variant,
  wayOut,
  retry = reopenDoor,
}: EntryRefusalProps) {
  const variants = ENTRY_REFUSAL_COPY.variants[reason];
  const { title, text } = variants[variant] ?? variants[0]!;
  const wait = reason === "rate-limited" ? (retryAfterSeconds ?? 0) : 0;
  const [left, setLeft] = useState(wait);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const deadline = Date.now() + wait * 1000;
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [wait]);

  const waiting = left > 0;
  const onRetry = () => {
    if (waiting || retrying) return;
    setRetrying(true);
    retry();
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16 lg:py-24">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-balance text-3xl font-extrabold leading-title">
            {title}
          </h1>
          <p className="text-pretty text-lg leading-normal text-muted-foreground">{text}</p>
        </div>
        <div
          className={
            wayOut.kind === "link"
              ? "flex w-full flex-col items-center gap-4 lg:w-auto lg:flex-row lg:flex-wrap lg:justify-center lg:gap-6"
              : "flex w-full flex-col items-center gap-4"
          }
        >
          <Button
            size="lg"
            className="w-full tabular-nums lg:w-auto lg:min-w-72"
            disabled={waiting}
            loading={retrying}
            onClick={onRetry}
          >
            {waiting
              ? ENTRY_REFUSAL_COPY.retryIn.replace("{time}", clock(left))
              : ENTRY_REFUSAL_COPY.retry}
          </Button>
          {wayOut.kind === "link" ? (
            <Link href={wayOut.href}>{wayOut.label}</Link>
          ) : (
            <SitesLine academyHref={wayOut.academyHref} doctorHref={wayOut.doctorHref} />
          )}
        </div>
      </div>
    </div>
  );
}

function SitesLine({
  academyHref,
  doctorHref,
}: {
  academyHref: string;
  doctorHref: string;
}): ReactNode {
  const c = ENTRY_REFUSAL_COPY;
  return (
    <p className="text-base leading-normal text-foreground">
      {c.sitesLead}{" "}
      <Link variant="inline" href={academyHref}>
        {c.academySite}
      </Link>{" "}
      {c.sitesJoin}{" "}
      <Link variant="inline" href={doctorHref}>
        {c.doctorSite}
      </Link>
    </p>
  );
}
