import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import { Link } from "@ds/design-system/link";
import { cn } from "@ds/design-system/lib/utils";

/**
 * Candidate/adopted seam (design-system-showcase spec §4, WBS #349) — the
 * Stage-A surface contract of `build-ui-from-design-system` (AGENTS.md §6).
 *
 * This module owns ONLY the surface contract: the schema describing a Stage-A
 * option-set and the chrome that renders 2–3 candidate variants of an element
 * class **side by side with the adopted entry**, visibly labelled, on the live
 * showcase URL. The owner picks here; the chosen option is then encoded as a
 * standard (the design constitution — deliverable A, inline under #340) and the
 * candidate entries are promoted to adopted / removed.
 *
 * The contract is deliberately schema-stable: anything deliverable A's
 * `research-ui-element` subagent produces is a {@link CandidateAdoptedGroup},
 * rendered by {@link CandidateAdoptedBoard} with **no change to this surface**.
 * The subagent owns research + the rendered options; this file owns only how
 * they are laid out and labelled. Each option's `render` returns the REAL,
 * branded `@ds/design-system` composition (never a re-implementation, spec §2.4)
 * exactly as a feature would compose it — Stage A reviews the true rendered look.
 */

/** A research citation backing an option (NN/g · Baymard · Polaris · Primer · …). */
export type SeamSource = {
  /** Display label, e.g. "NN/g — Progress Indicators". */
  label: string;
  /** Optional canonical URL for the source. */
  href?: string;
};

/** One option in a Stage-A set — either the adopted standard or a candidate. */
export type SeamOption = {
  /** Stable id within the group (kebab-case), e.g. "spinner-inline". */
  id: string;
  /** Short human label shown on the option header, e.g. "Inline spinner". */
  label: string;
  /** One-line description of what this option is / how it behaves. */
  summary: string;
  /** Research provenance backing the option — shown beneath the sample. */
  sources?: readonly SeamSource[];
  /**
   * The rendered, branded sample. Returns the real `@ds/design-system`
   * composition (token-only) exactly as a product surface would compose it, so
   * the owner reviews the true look — not a mock of it.
   */
  render: () => ReactNode;
};

/**
 * A Stage-A option-set for one element class: 2–3 researched candidates beside
 * the current adopted entry (absent when the class has no adopted standard yet —
 * the "brand-new element class" path). The 2-or-3 candidate count is enforced at
 * the type level so a malformed set is a compile error, keeping the seam honest
 * without a runtime guard.
 */
export type CandidateAdoptedGroup = {
  /** The element class under research, e.g. "submit-pending affordance". */
  elementClass: string;
  /** One-line framing of the decision the owner is making. */
  question: string;
  /** Cross-option research framing shown above the options (optional). */
  notes?: string;
  /** The current adopted standard — absent for a not-yet-adopted class. */
  adopted?: SeamOption;
  /** The researched candidates — exactly 2 or 3, per the Stage-A convention. */
  candidates:
    | readonly [SeamOption, SeamOption]
    | readonly [SeamOption, SeamOption, SeamOption];
};

/** Token-only role pill — the visible ADOPTED / CANDIDATE label. */
function RolePill({
  role,
  ordinal,
}: {
  role: "adopted" | "candidate";
  ordinal?: number;
}) {
  const adopted = role === "adopted";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        adopted
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground",
      )}
    >
      {adopted ? "Adopted" : `Candidate${ordinal ? ` ${ordinal}` : ""}`}
    </span>
  );
}

/** Sources line beneath a sample — the research provenance for the option. */
function SourceList({ sources }: { sources?: readonly SeamSource[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Research:</span>{" "}
      {sources.map((s, i) => (
        <span key={s.label}>
          {i > 0 ? "; " : ""}
          {s.href ? (
            <Link href={s.href} variant="inline" className="text-xs">
              {s.label}
            </Link>
          ) : (
            s.label
          )}
        </span>
      ))}
    </p>
  );
}

/** One option column — the labelled card hosting a single rendered sample. */
function OptionCard({
  option,
  role,
  ordinal,
}: {
  option: SeamOption;
  role: "adopted" | "candidate";
  ordinal?: number;
}) {
  const adopted = role === "adopted";
  return (
    <Card
      // Each option is a labelled group (role pill + sample + provenance); the
      // adopted entry is the anchor the candidates are judged against. `role`
      // makes the `aria-label` meaningful to assistive tech (a bare label on a
      // generic container is ignored).
      role="group"
      className={cn("flex flex-col gap-4", adopted && "border-ring")}
      aria-label={`${adopted ? "Adopted" : `Candidate ${ordinal ?? ""}`.trim()}: ${option.label}`}
    >
      <CardHeader>
        <RolePill role={role} ordinal={ordinal} />
        <CardTitle className="text-base">{option.label}</CardTitle>
        <CardDescription>{option.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The real rendered sample, framed so its own edges read against the card. */}
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6">
          {option.render()}
        </div>
        <SourceList sources={option.sources} />
      </CardContent>
    </Card>
  );
}

/**
 * Renders one {@link CandidateAdoptedGroup}: the adopted entry (when present)
 * first, then the 2–3 candidates beside it, every entry visibly role-labelled.
 * Pure presentation over the typed contract — the single seam deliverable A
 * targets.
 */
export function CandidateAdoptedBoard({ group }: { group: CandidateAdoptedGroup }) {
  const { elementClass, question, notes, adopted, candidates } = group;
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-8">
      <div className="flex flex-col gap-1.5">
        <code className="font-mono text-xs text-muted-foreground">
          {elementClass}
        </code>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {question}
        </h2>
        {notes ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{notes}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
        {adopted ? (
          <OptionCard option={adopted} role="adopted" />
        ) : null}
        {candidates.map((candidate, i) => (
          <OptionCard
            key={candidate.id}
            option={candidate}
            role="candidate"
            ordinal={i + 1}
          />
        ))}
      </div>
    </section>
  );
}
