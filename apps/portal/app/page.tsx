import { permanentRedirect } from "next/navigation";

/**
 * 004 / 008 EARS-7/8/9 — `/` permanent-redirects to the canonical discovery
 * route `/webinars` (owner verdict #7 follow-up, 2026-07-17). Two routes serving
 * the same upcoming-broadcasts listing was the defect itself: nav «Эфиры» + the
 * logo now point straight at `/webinars` (`app-shell-header` `DISCOVERY_HREF`),
 * so the calendar shell with its «Неделя / Месяц» switchers is always reached at
 * ONE canonical URL. Any bookmark or deep-link to `/` lands on that same page;
 * `/` carries no query params today, so nothing is preserved across the hop.
 * This retires the former in-place `DiscoveryListing` render on `/` (a second,
 * switcher-less hero that diverged from `/webinars`).
 */
export default function HomePage() {
  permanentRedirect("/webinars");
}
