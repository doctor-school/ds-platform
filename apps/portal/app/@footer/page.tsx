import { AcademyHomeFooter } from "../academy-home-view";

/**
 * #2664 — the root route's footer slot: the Academy home's own footer, mounted
 * AFTER the root layout's `<main>` so it stays the page's top-level
 * `contentinfo` landmark (the layout's frame owns the one `<main>`).
 */
export default function HomeFooter() {
  return <AcademyHomeFooter />;
}
