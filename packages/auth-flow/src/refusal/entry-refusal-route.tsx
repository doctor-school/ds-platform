import Image from "next/image";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ENTRY_REFUSAL_COPY } from "../copy/entry-refusal";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ENTRY_REFUSAL_HEADER,
  readEntryRefusal,
  type EntryRefusal as EntryRefusalValue,
} from "../server/entry-refusal";
import { EntryRefusal } from "./entry-refusal";

/**
 * 003 EARS-72 — the refusal page's metadata, read member by member by each
 * storefront's mount: its tab title, and never indexed (the page answers only a
 * refused entry).
 */
export const ENTRY_REFUSAL_PAGE_METADATA = {
  title: ENTRY_REFUSAL_COPY.pageTitle,
  robots: { index: false, follow: false },
} as const;

/** A random source in `[0, 1)` — injectable so a test can pin the variant. */
export type RefusalRandom = () => number;

/** 003 EARS-72 — one variant per render, at random, among the reason's own. */
export function pickRefusalVariant(
  reason: EntryRefusalValue["reason"],
  random: RefusalRandom = Math.random,
): number {
  const count = ENTRY_REFUSAL_COPY.variants[reason].length;
  return Math.min(count - 1, Math.floor(random() * count));
}

/**
 * 003 EARS-72 — the storefront refusal page (`/auth/refused`, the path the
 * storefront gate rewrites a refused door to). Each storefront mounts it in a
 * thin page route inside its own storefront shell. No refusal hand-over ⇒ no
 * page (a direct visit is a 404). The way out: back to the event page the
 * entry came from, else this storefront's home.
 */
export async function StorefrontEntryRefusalRoute({
  config,
  homeHref,
  random,
}: {
  config: AuthFlowHostConfig;
  /** The storefront's home page. */
  homeHref: string;
  random?: RefusalRandom;
}) {
  const refusal = readEntryRefusal((await headers()).get(ENTRY_REFUSAL_HEADER));
  if (!refusal) notFound();
  const wayOut = refusal.eventSlug
    ? {
        kind: "link" as const,
        href: config.routes.eventPathTemplate.replace(
          ":slug",
          encodeURIComponent(refusal.eventSlug),
        ),
        label: ENTRY_REFUSAL_COPY.backToEvent,
      }
    : { kind: "link" as const, href: homeHref, label: ENTRY_REFUSAL_COPY.home };
  return (
    <EntryRefusal
      reason={refusal.reason}
      retryAfterSeconds={refusal.retryAfterSeconds}
      variant={pickRefusalVariant(refusal.reason, random)}
      wayOut={wayOut}
    />
  );
}

/** The sign-in site's refusal host-config: the two storefront homes and its logo. */
export type SignInSiteRefusalConfig = {
  readonly academyHref: string;
  readonly doctorHref: string;
  readonly logo: { readonly light: string; readonly dark: string };
};

/**
 * 003 EARS-72 — the sign-in site's refusal page: no storefront is known (the
 * refused call is the one that would name it), so a thin top bar with the
 * platform logo, no navigation, and a way out naming both sites.
 */
export function SignInSiteRefusal({
  refusal,
  sites,
  random,
}: {
  refusal: EntryRefusalValue;
  sites: SignInSiteRefusalConfig;
  random?: RefusalRandom;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b-2 border-border px-4 py-4 lg:px-12">
        <Image
          src={sites.logo.light}
          alt="Doctor.School"
          width={500}
          height={164}
          priority
          unoptimized
          className="block h-6 w-auto dark:hidden"
        />
        <Image
          src={sites.logo.dark}
          alt="Doctor.School"
          width={500}
          height={164}
          unoptimized
          className="hidden h-6 w-auto dark:block"
        />
      </header>
      <EntryRefusal
        reason={refusal.reason}
        retryAfterSeconds={refusal.retryAfterSeconds}
        variant={pickRefusalVariant(refusal.reason, random)}
        wayOut={{
          kind: "sites",
          academyHref: sites.academyHref,
          doctorHref: sites.doctorHref,
        }}
      />
    </div>
  );
}
