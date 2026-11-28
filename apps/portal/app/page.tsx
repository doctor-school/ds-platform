import type { Metadata } from "next";

import { AcademyHomeView } from "./academy-home-view";

export const metadata: Metadata = {
  title: "Академия Doctor.School",
  description: "Академия Doctor.School · закулисье платформы",
};

/**
 * 029 — the Academy home at `/`. Every figure and block reads the platform at
 * the moment of the request (029 EARS-3, EARS-5, EARS-7), so the page is never
 * prerendered: `dynamic` cannot live in the view, so it is declared here.
 */
export const dynamic = "force-dynamic";

export default function AcademyHomePage() {
  return <AcademyHomeView />;
}
