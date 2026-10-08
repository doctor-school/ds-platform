import type { ReactNode } from "react";
import { ContactChip, Label, cn } from "@ds/design-system";

/**
 * The admin side-panel card's presentation (owner Stage-B on #2724, carried to
 * the 044 participant card by #2731): ONE module both read cards mount — the
 * 046 submission card (`submission-card-panel.tsx`) and the 044 participant
 * card (`participant-card-panel.tsx`) — so the two never drift apart.
 *
 * Three type levels: section headings, field labels (small, muted) and values
 * (body). Secondary data — histories, a letter's outcome, timestamps — sits on
 * the small muted level or in the collapsed `CardDisclosure`.
 */
export const SECTION_HEADING = "text-base font-extrabold text-foreground";
export const SECONDARY = "text-xs text-muted-foreground";

/** The muted row under the panel title: badges and the record's time. */
export function CardMeta({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/**
 * One titled section of the card. `divided` draws the rule that separates it
 * from the section above (the first section after the summary has none).
 */
export function CardSection({
  titleId,
  title,
  divided = false,
  testId,
  children,
}: {
  titleId: string;
  title: ReactNode;
  divided?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4",
        divided && "border-t-2 border-border pt-4",
      )}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <h3 id={titleId} className={SECTION_HEADING}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Secondary data, collapsed until asked for. The native disclosure owns the
 * keyboard operation and the expanded state; the design system's
 * `DisclosureSummary` is the 44px icon chip, not a text row.
 */
export function CardDisclosure({
  summary,
  testId,
  children,
}: {
  summary: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <details className="border-t-2 border-border pt-4" data-testid={testId}>
      <summary>
        <span className="text-sm font-bold text-foreground">{summary}</span>
      </summary>
      {children}
    </details>
  );
}

/**
 * One read-only fact: a small muted label over the value in body text. A
 * `prose` value (free text the record carries) keeps its paragraph breaks at a
 * readable measure. `testId` is the value's full `data-testid`.
 */
export function Fact({
  label,
  testId,
  prose = false,
  className,
  children,
}: {
  label: string;
  testId: string;
  prose?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <dt className={SECONDARY}>{label}</dt>
      <dd
        className={cn(
          "text-sm leading-relaxed text-foreground wrap-anywhere",
          prose && "max-w-prose whitespace-pre-wrap",
        )}
        data-testid={testId}
      >
        {children}
      </dd>
    </div>
  );
}

/** A phone as the design system's contact chip, dialable as typed. */
export function PhoneChip({ phone }: { phone: string }) {
  return (
    <ContactChip href={`tel:${phone.replace(/[^\d+]/g, "")}`} label={phone} />
  );
}

/** An email address as the design system's contact chip. */
export function EmailChip({ email }: { email: string }) {
  return <ContactChip href={`mailto:${email}`} label={email} />;
}

/** One labelled form control of a card's write block, with its optional hint. */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
