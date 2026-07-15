import DiscoveryListing from "@/components/discovery-listing";

/**
 * 004 EARS-7 — the public upcoming-broadcasts listing at `/webinars`. The listing
 * body lives in the shared `DiscoveryListing` server component (#982), rendered
 * identically here and at the `/` front-door (008 EARS-8). `dynamic` cannot live
 * on the component, so it is re-declared here: a lifecycle transition can
 * add/remove a card, so a static prerender would go stale.
 */
export const dynamic = "force-dynamic";

export default function WebinarsListingPage() {
  return <DiscoveryListing />;
}
