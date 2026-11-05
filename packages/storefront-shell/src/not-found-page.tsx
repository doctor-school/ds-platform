import { Button } from "@ds/design-system/button";
import { StatusPage } from "@ds/design-system/status-page";

import { NOT_FOUND_COPY } from "./copy/not-found";

/**
 * #2478 — the not-found page's metadata, read member by member by each
 * storefront's root `not-found.tsx` (and by the Academy's catch-all route,
 * whose thrown `notFound()` keeps the route's own metadata): its tab title, and
 * never indexed.
 */
export const NOT_FOUND_PAGE_METADATA = {
  title: NOT_FOUND_COPY.pageTitle,
  robots: { index: false, follow: false },
} as const;

/** A random source in `[0, 1)` — injectable so a test can pin the variant. */
export type NotFoundRandom = () => number;

/** #2478 — one variant per render, at random, among the owner's six. */
export function pickNotFoundVariant(random: NotFoundRandom = Math.random): number {
  const count = NOT_FOUND_COPY.variants.length;
  return Math.min(count - 1, Math.floor(random() * count));
}

/**
 * #2478 — the not-found state of the platform's one error page
 * (`StatusPage`, canvas `design-source/sign-in-refusal.dc.html`): the
 * variant's heading and line, one way out — the host home `/`. Each storefront
 * mounts it from its root `not-found.tsx` inside its own storefront shell, so
 * every unknown address (and every `notFound()` without a segment state of its
 * own) lands here with HTTP 404.
 */
export function NotFoundPage({ variant }: { variant: number }) {
  const { variants } = NOT_FOUND_COPY;
  const { title, text } = variants[variant] ?? variants[0];
  return (
    <StatusPage
      title={title}
      text={text}
      actions={
        <Button asChild size="lg" className="w-full lg:w-auto lg:min-w-72">
          <a href="/">{NOT_FOUND_COPY.home}</a>
        </Button>
      }
    />
  );
}

/** #2478 — the server-side mount: picks the variant for this render. */
export function StorefrontNotFound({ random }: { random?: NotFoundRandom }) {
  return <NotFoundPage variant={pickNotFoundVariant(random)} />;
}
