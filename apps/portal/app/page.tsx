import DiscoveryListing from "@/components/discovery-listing";

/**
 * 008 EARS-7/8/9 — `/` is the canonical public discovery front-door AND the
 * post-login landing: it renders the feature-004 upcoming-broadcasts listing
 * (the shared `DiscoveryListing` component) identically for a guest and a
 * logged-in doctor, never branching on auth (only the persistent app-shell
 * header's account affordance does). This retires the former #769 redirect to
 * `/webinars` and the 003-era «Каркас приложения» scaffold — `/` now serves the
 * listing in place, one level up, rather than forwarding to it.
 *
 * `dynamic` cannot live on the shared component, so it is re-declared here (a
 * lifecycle transition can add/remove a card — a static prerender would go stale).
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <DiscoveryListing />;
}
