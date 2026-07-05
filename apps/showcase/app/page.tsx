import NextLink from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import { Link } from "@ds/design-system/link";

/**
 * Showcase landing — the table of contents for the living catalogue
 * (design-system-showcase spec §3). Each section links to its live route; a
 * section still owned by an open WBS Issue is enumerated but left unlinked (no
 * placeholder route standing in for a tracked deliverable, AGENTS.md §6) until
 * its route lands. The catalogue sections (Tokens / Primitives / Blocks) and the
 * Stage-A candidate/adopted seam are now live.
 *
 * Everything here is composed from the real `@ds/design-system` exports — the
 * showcase adds nothing of its own (spec §2.4); the chrome itself demonstrates
 * the package it catalogues.
 */
type Section = {
  title: string;
  description: string;
  issue: string;
  /** Live route — absent while the section is still owned by an open WBS Issue. */
  href?: string;
};

const SECTIONS: readonly Section[] = [
  {
    title: "Tokens",
    description:
      "Every token class — color, typography, spacing, radius, border, shadow, motion, z-index, opacity, breakpoints — rendered as specimens from the generated manifest.",
    issue: "#346",
    href: "/tokens",
  },
  {
    title: "Primitives",
    description:
      "Each exported primitive (button, card, input, input-otp, link, label, tabs, form, fields/*) across every state, variant and size — with an explicit states column.",
    issue: "#347",
    href: "/primitives",
  },
  {
    title: "Blocks",
    description:
      "Each exported block (auth-card, auth-layout, otp-focus-screen) rendered with representative content in its key states, branded.",
    issue: "#348",
    href: "/blocks",
  },
  {
    title: "Candidates (Stage-A)",
    description:
      "The candidate/adopted seam — 2–3 researched candidate variants of an element class rendered beside the adopted entry, role-labelled, for the owner's Stage-A pick on the live URL.",
    issue: "#349",
    href: "/candidates",
  },
  {
    title: "Layout & spatial rhythm",
    description:
      "The container / breakpoint contract and the semantic spacing roles (inset · stack · section · control · inline · day-band) composed into one surface — resize across 901px to watch the rhythm flip regime at both breakpoints.",
    issue: "#514",
    href: "/layout-rhythm",
  },
];

function SectionCard({
  section,
}: {
  section: (typeof SECTIONS)[number];
}) {
  return (
    <Card className={section.href ? "transition-colors hover:border-ring" : ""}>
      <CardHeader>
        <CardTitle className="text-xl">{section.title}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {section.href ? "Open section" : `Catalogued by ${section.issue}.`}
        </p>
      </CardContent>
    </Card>
  );
}

export default function ShowcaseHome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Design System Showcase
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          The living, rendered viewer of{" "}
          <span className="font-medium text-foreground">@ds/design-system</span>{" "}
          — every token, primitive and block from the real package, in every
          state. One design system, one source of truth; this is its catalogue,
          not a second design system.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        {SECTIONS.map((s) =>
          s.href ? (
            <Link
              key={s.title}
              asChild
              variant="standalone"
              className="block rounded-xl"
            >
              <NextLink href={s.href}>
                <SectionCard section={s} />
              </NextLink>
            </Link>
          ) : (
            <SectionCard key={s.title} section={s} />
          ),
        )}
      </section>
    </main>
  );
}
