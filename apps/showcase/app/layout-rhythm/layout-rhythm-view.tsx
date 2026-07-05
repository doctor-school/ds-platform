import type { CSSProperties, ReactNode } from "react";
import NextLink from "next/link";

import { Container } from "@ds/design-system/container";
import { Link } from "@ds/design-system/link";

import { ViewportBadge } from "./viewport-badge";

/**
 * Layout & spatial-rhythm composition (#514, canvas §09). The rendered proof that
 * the container/breakpoint contract and the semantic spacing ROLES compose a
 * coherent rhythm at BOTH breakpoints — resize the window across 901px on the
 * live stand to watch the shell go edge-to-edge (fixed 16px gutter, stack → 0)
 * below and container + fluid gutter + 28px stack above.
 *
 * Everything is composed from the real `@ds/design-system` layout primitive
 * (`Container`) and the token-backed utilities — the showcase re-implements
 * nothing (spec §2.4). The spacing between regions is driven by the role → scale
 * mapping (inset/stack/section/control/inline/band); the legend consumes each
 * `--space-*` role var directly so the reader sees the token, not a guess.
 */

/** The canvas §09 role → value contract, for the legend. */
const ROLE_GROUPS: {
  role: string;
  purpose: string;
  steps: { name: string; label: string }[];
}[] = [
  {
    role: "inset",
    purpose: "Padding INSIDE a surface",
    steps: [
      { name: "inset-sm", label: "16" },
      { name: "inset-md", label: "20" },
      { name: "inset-lg", label: "24" },
      { name: "inset-xl", label: "30" },
    ],
  },
  {
    role: "stack",
    purpose: "Between stacked list cards (0 mobile / 28 desktop)",
    steps: [{ name: "stack", label: "28 → 0" }],
  },
  {
    role: "section",
    purpose: "Block-to-block rhythm",
    steps: [
      { name: "section-sm", label: "44" },
      { name: "section-lg", label: "48" },
    ],
  },
  {
    role: "control",
    purpose: "Between chips / buttons / fields",
    steps: [
      { name: "control-sm", label: "8" },
      { name: "control-md", label: "10" },
      { name: "control-lg", label: "12" },
    ],
  },
  {
    role: "inline",
    purpose: "Icon ↔ text",
    steps: [
      { name: "inline-sm", label: "6" },
      { name: "inline-md", label: "8" },
    ],
  },
  {
    role: "band",
    purpose: "Day-band bleed (edge-to-edge)",
    steps: [{ name: "band", label: "0" }],
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-2xs font-extrabold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

/** A dot standing in for an icon — proves the icon↔text INLINE gap, hit-target size. */
function Dot() {
  return <span aria-hidden className="size-4 shrink-0 bg-primary" />;
}

/** A filter chip: a ≥44×44 hit target, icon↔text INLINE gap, 3px focus ring. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Dot />
      {children}
    </button>
  );
}

/** One legend row — the sample bar's width IS the role var (token consumed live). */
function RoleBar({ name, label }: { name: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <code className="w-32 shrink-0 text-caption text-muted-foreground">
        --space-{name}
      </code>
      <span
        className="h-3 bg-primary"
        style={{ inlineSize: `var(--space-${name})` } as CSSProperties}
      />
      <span className="text-caption text-faint tabular-nums">{label}px</span>
    </div>
  );
}

export function LayoutRhythmView() {
  return (
    // The Container primitive IS the page shell: margin-auto, content max-width
    // (1104), fixed 16px mobile gutter → fluid 16→48 desktop gutter. `asChild`
    // makes the shell the semantic <main>. Vertical region rhythm = section-lg
    // (48 → gap-12); the whole page breathes on the section role.
    <Container asChild variant="content">
      <main className="flex min-h-screen flex-col gap-12 py-12">
        <header className="flex flex-col gap-4">
          <Link asChild variant="standalone" className="text-sm">
            <NextLink href="/">← Showcase home</NextLink>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Layout &amp; spatial rhythm
          </h1>
          <p className="max-w-3xl text-base text-muted-foreground">
            The container / breakpoint contract and the semantic spacing roles of
            canvas §09, composed into one surface. Resize across{" "}
            <span className="font-medium text-foreground">901px</span> to watch
            the shell flip regime — the page composes space by ROLE, never by eye.
          </p>
          <ViewportBadge />
        </header>

        {/* ── Roles legend — each bar's width is the role token, read live. ── */}
        <section className="flex flex-col gap-6 border border-border bg-card p-6">
          <div className="flex flex-col gap-2">
            <Eyebrow>Semantic spacing roles</Eyebrow>
            <p className="text-sm text-muted-foreground">
              Every bar below is sized by its <code>--space-*</code> role
              variable — the same token a surface composes with.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            {ROLE_GROUPS.map((g) => (
              <div key={g.role} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-foreground">
                    {g.role}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {g.purpose}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {g.steps.map((s) => (
                    <RoleBar key={s.name} name={s.name} label={s.label} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Controls & inline: control-gap toolbar of icon↔text chips. ── */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>Controls · control 10 · inline 8</Eyebrow>
            <h2 className="text-xl font-semibold text-foreground">Filters</h2>
          </div>
          {/* control-md (10 → gap-2.5) between chips; each chip is a ≥44×44 hit
              target with an icon↔text inline-md (8 → gap-2) gap. */}
          <div className="flex flex-wrap gap-2.5">
            <Chip>Today</Chip>
            <Chip>This week</Chip>
            <Chip>Webinars</Chip>
            <Chip>Assigned</Chip>
          </div>
        </section>

        {/* ── Stacked list: inset cards, stack gap 0 mobile → 28 desktop. ── */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>Stack · 0 mobile → 28 desktop</Eyebrow>
            <h2 className="text-xl font-semibold text-foreground">Schedule</h2>
          </div>
          {/* The stack role: cards butt edge-to-edge on mobile (gap-0), open to a
              28px rhythm on desktop (desktop:gap-7). */}
          <ul className="flex flex-col gap-0 desktop:gap-7">
            {[
              { t: "Cardiology grand rounds", m: "09:00 · Auditorium A" },
              { t: "Pharmacovigilance briefing", m: "11:30 · Online" },
              { t: "Case review — oncology", m: "14:00 · Room 3" },
            ].map((row) => (
              <li
                key={row.t}
                // inset-md (20 → p-5) padding inside each card.
                className="flex items-center justify-between border border-border bg-card p-5"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-card-foreground">{row.t}</p>
                  {/* inline meta: icon↔text inline-sm (6 → gap-1.5). */}
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span aria-hidden className="size-3 bg-faint" />
                    {row.m}
                  </p>
                </div>
                <span className="text-caption font-medium text-primary">
                  Open
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Day-band: bleeds to the mobile gutter edge (band role = 0). ── */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>Day-band · bleed 0</Eyebrow>
            <h2 className="text-xl font-semibold text-foreground">
              Full-bleed band
            </h2>
          </div>
          {/* The band cancels the shell's mobile gutter with a negative inline
              margin read from the same token, then re-insets its own content —
              so the surface runs edge-to-edge while the text stays aligned. */}
          <div
            className="bg-primary-surface py-6 text-primary-foreground"
            style={
              {
                marginInline: "calc(-1 * var(--layout-gutter-mobile))",
                paddingInline: "var(--layout-gutter-mobile)",
              } as CSSProperties
            }
          >
            <p className="text-2xs font-extrabold uppercase tracking-wider opacity-80">
              Saturday
            </p>
            <p className="mt-1 text-lg font-semibold">
              5 July · 3 sessions scheduled
            </p>
          </div>
        </section>
      </main>
    </Container>
  );
}
