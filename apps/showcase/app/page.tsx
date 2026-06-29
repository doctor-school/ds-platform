import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";

/**
 * Showcase landing — the bare table of contents for the living catalogue
 * (design-system-showcase spec §3). The three sections are filled by their own
 * WBS Issues: tokens (#346), primitives (#347), blocks (#348). Until those land
 * the landing only enumerates them — it does NOT link to or stub the section
 * routes (no placeholder standing in for a tracked deliverable, AGENTS.md §6).
 *
 * Everything here is composed from the real `@ds/design-system` exports — the
 * showcase adds nothing of its own (spec §2.4); the chrome itself demonstrates
 * the package it catalogues.
 */
const SECTIONS = [
  {
    title: "Tokens",
    description:
      "Every token class — color, typography, spacing, radius, border, shadow, motion, z-index, opacity, breakpoints — rendered as specimens from the generated manifest.",
    issue: "#346",
  },
  {
    title: "Primitives",
    description:
      "Each exported primitive (button, card, input, input-otp, link, label, tabs, form, fields/*) across every state, variant and size — with an explicit states column.",
    issue: "#347",
  },
  {
    title: "Blocks",
    description:
      "Each exported block (auth-card, auth-layout, otp-focus-screen) rendered with representative content in its key states, branded.",
    issue: "#348",
  },
] as const;

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
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle className="text-xl">{s.title}</CardTitle>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Catalogued by {s.issue}.
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
