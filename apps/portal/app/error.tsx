"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system/alert";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * App-level error boundary for the portal (#1640).
 *
 * The portal had no `error.tsx` at all: any throw inside a route's server render
 * — a rejected upstream, a malformed query param the boundary did not catch —
 * reached the visitor as Next's unstyled 500 page, in English, on a PUBLIC
 * marketing surface. This is placed at the `app/` root rather than under
 * `app/webinars/` on purpose: `/` and `/webinars` render the SAME
 * `DiscoveryListing` off the same upstream, and every other public route shares
 * the failure modes, so one boundary at the root covers them all instead of a
 * per-route copy (the cross-front reuse rule, AGENTS.md §6). A route that later
 * needs its own recovery copy can still add a nearer `error.tsx`, which wins.
 *
 * Built from `@ds/design-system` primitives only — `Container` for the page
 * column, `Alert` (danger) for the message, `Button` for the retry action and
 * `Link` for the way back — so the failure page carries the same frame, states
 * and theme flip as the rest of the surface. `reset()` re-renders the segment,
 * which is the actual recovery for a transient upstream blip.
 *
 * Root-layout failures are NOT covered by this file (Next renders those through
 * `global-error.tsx`); the layout only wires fonts, theme and the i18n provider.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // The rendered copy stays generic; the diagnosable detail goes to the
    // console/telemetry, never onto a public page.
    console.error("portal route error", error);
  }, [error]);

  return (
    <Container className="py-12">
      <Alert variant="danger">
        <p>
          <b>{t("page.title")}</b>
        </p>
        <p className="mt-1">{t("page.body")}</p>
      </Alert>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="button" onClick={reset}>
          {t("page.retry")}
        </Button>
        <DsLink asChild variant="inline">
          <Link href="/">{t("page.home")}</Link>
        </DsLink>
      </div>
    </Container>
  );
}
