import type { Metadata } from "next";
import { RhythmView } from "./rhythm-view";

/**
 * Layout & spatial rhythm section (#514, source §09). Full-viewport-width by
 * design — the composition IS the subject (the container cap, the mobile
 * edge-to-edge collapse, the day-band bleed), so it does not sit inside the
 * `SectionShell`'s own capped column; its chrome (back link + theme toggle) lives
 * in the client view. Everything is composed from the real `@ds/design-system`
 * exports + the §09 token-backed spacing-role utilities (spec §2.4).
 */
export const metadata: Metadata = {
  title: "Layout & rhythm · Design System Showcase",
};

export default function RhythmPage() {
  return <RhythmView />;
}
