import { WebinarCard } from "@ds/design-system/webinar-card";

import type { ReturnContextEvent } from "@/lib/return-context";

/**
 * 021 EARS-2 (#1538) — the return context: what the doctor came for, shown
 * beside the registration form.
 *
 * ONE CANONICAL CARD. The event is rendered through `@ds/design-system`'s
 * `WebinarCard` — feature 004's unit as widened for the doctor storefront by
 * 019 (#1517), the same unit the 019 feed and the 020 event page render. This
 * file composes it; it re-implements nothing, and there is no second card built
 * for this surface (EARS-2, ADR-0013 A1).
 *
 * NO WAY BACK OUT OF THE FORM. The card is rendered `navigable={false}`, so its
 * subtree carries no link and no button at all. That is the owner's explicit
 * condition on the Stage-A pick F-021-2 Б — «Вариант Б, но на карточке не
 * должно быть кнопки, которая уводит назад — это странный UX» — and a stated
 * invariant of the requirements. It is a DELIBERATE deviation from the canvas,
 * which draws «Участвовать ↗» on this card: the doctor is one step from the
 * thing they want, and a control that walks them back out of the form loses
 * them the registration they came to complete. The suppression lives in the
 * primitive rather than in a doctor-local wrapper precisely so that «this
 * reading of the card has no affordance» is a property of the shared unit, not
 * a fact an app can forget to reproduce.
 *
 * TWO RENDERS, ONE AT A TIME. The canvas composes variant Б differently at the
 * two breakpoints, and so does this file:
 *
 *   • `<ReturnContextPanel>` fills the SPLIT'S LEFT HALF on the wide layout —
 *     it takes the place of the brand panel's value-prop zone, exactly as the
 *     canvas does (`showBrandPanel = !gateCardOnPanel`), keeping the panel's
 *     three-zone rhythm: mark, this block, the panel's closing line.
 *   • `<ReturnContextPlate>` is the mobile composition — the card as the
 *     background plate ABOVE the form, full-bleed across the form column.
 *
 * Each is hidden at the other's breakpoint with `display:none`, which also
 * removes it from the accessibility tree — so the event is announced ONCE per
 * viewport, never twice (the same one-per-viewport discipline `<AuthLayout>`
 * already applies to the wordmark).
 *
 * With no resolvable return context neither renders and no slot is passed at
 * all: absent from the tree, never an empty frame (EARS-3).
 */

/** Verbatim from the canvas — the eyebrow above the card in both compositions. */
const EYEBROW = "Вы вернётесь к этому событию";

function ReturnEventCard({ event }: { event: ReturnContextEvent }) {
  return (
    <WebinarCard
      navigable={false}
      data-testid="return-context-card"
      // МСК is the event's own clock, never the reader's (EARS-12); the label
      // is stated explicitly beside the time rather than implied.
      tzLabel="МСК"
      time={event.time}
      dateLabel={event.dateLabel}
      school={event.school}
      title={event.title}
      specialties={event.specialties}
      speakers={event.speakers}
    />
  );
}

/**
 * The wide-layout composition: the card in the split's left half, on the brand
 * panel. Copy is white-on-blue through the PAIRED `primary-surface-*` tokens
 * the panel is filled with — never `primary-foreground`, which repoints in the
 * dark theme and would paint dark-on-dark (the #517 review blocker).
 */
export function ReturnContextPanel({ event }: { event: ReturnContextEvent }) {
  return (
    <div
      data-testid="return-context-panel"
      className="hidden flex-1 flex-col justify-center gap-5 py-8 layout:flex"
    >
      <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
        {EYEBROW}
      </p>
      <div className="max-w-2xl">
        <ReturnEventCard event={event} />
      </div>
      {/* The canvas's assurance line — it states plainly what happens next,
          which is EARS-2's «state plainly what the doctor will return to»
          without offering a control that acts on it now. */}
      <p className="max-w-md text-base font-medium leading-relaxed text-primary-surface-muted">
        После подтверждения почты вы вернётесь сюда же — место за вами.
      </p>
    </div>
  );
}

/**
 * The mobile composition: the same card as the canvas's background plate above
 * the form, full-bleed across the form column's padding (`-mx-6` against the
 * column's `px-6`). Hidden at `layout:`, where the panel render takes over.
 */
export function ReturnContextPlate({ event }: { event: ReturnContextEvent }) {
  return (
    <div
      data-testid="return-context-plate"
      className="-mx-6 bg-muted px-6 pt-4 pb-1 layout:hidden"
    >
      <p className="mb-1.5 text-eyebrow font-extrabold uppercase tracking-micro text-muted-foreground">
        {EYEBROW}
      </p>
      <ReturnEventCard event={event} />
    </div>
  );
}
