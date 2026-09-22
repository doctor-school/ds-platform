import type { ReactNode } from "react";

import { WebinarCard } from "@ds/design-system/webinar-card";

import type {
  AuthFlowHostConfig,
  AuthFlowReturnContextCopy,
} from "../host-config";
import { resolveAuthFlowCopy } from "../copy";
import type { ReturnContextEvent } from "../server/return-context";

/**
 * 021 EARS-2 (#1538) / wave-1 gate row 46 — the return context: what the visitor
 * came for, shown beside the door's form (#2027 PR 1.5; was the doctor host
 * `components/return-context-card.tsx`).
 *
 * ONE CANONICAL CARD. The event renders through `@ds/design-system`'s
 * `WebinarCard` — the same unit the feed and the event page render; nothing is
 * re-implemented here (EARS-2, ADR-0013 A1).
 *
 * NO WAY BACK OUT OF THE FORM. The card is `navigable={false}`, so its subtree
 * carries no link and no button — the owner's condition on the Stage-A pick
 * F-021-2 Б («на карточке не должно быть кнопки, которая уводит назад»), a
 * deliberate deviation from the canvas's «Участвовать ↗».
 *
 * TWO RENDERS, ONE AT A TIME. `<ReturnContextPanel>` fills the split's left half
 * on the wide layout (in place of the brand panel's value prop);
 * `<ReturnContextPlate>` is the mobile plate above the form. Each is hidden at
 * the other's breakpoint with `display:none`, which also removes it from the
 * accessibility tree — the event is announced ONCE per viewport.
 *
 * DATA, NOT A HOST BRANCH. Whether a host publishes the card is
 * `config.returnTo.card`; every word comes from `copy.returnContext`.
 * `returnContextSlots` is the one gate: no flag or no resolvable event
 * ⇒ no slot at all, never an empty frame (EARS-3).
 */

/**
 * Which door the panel stands beside. The card, eyebrow and frame are identical;
 * the ASSURANCE LINE is not — registration waits on an email confirmation,
 * sign-in returns the visitor on the spot (#1955). Required, no default: a new
 * caller decides which door it is.
 */
export type ReturnContextVariant = "register" | "login";

function ReturnEventCard({ event }: { event: ReturnContextEvent }) {
  return (
    <WebinarCard
      navigable={false}
      data-testid="return-context-card"
      // МСК is the event's own clock, never the reader's (EARS-12).
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

function PanelBody({
  copy,
  event,
  variant,
}: {
  copy: AuthFlowReturnContextCopy;
  event: ReturnContextEvent;
  variant: ReturnContextVariant;
}) {
  return (
    <div
      data-testid="return-context-panel"
      className="hidden flex-1 flex-col justify-center gap-5 py-8 layout:flex"
    >
      <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
        {copy.eyebrow}
      </p>
      {/* The card is LIGHT in both themes on the blue panel (canvas pins
          `dark={false}`); `light` is the design system's token scope. `max-w-xl`
          is the nearest token-backed width to the canvas's 560px cap. */}
      <div className="light max-w-xl">
        <ReturnEventCard event={event} />
      </div>
      <p className="max-w-md text-sm leading-relaxed text-primary-surface-muted">
        {copy[variant]}
      </p>
    </div>
  );
}

function PlateBody({
  copy,
  event,
}: {
  copy: AuthFlowReturnContextCopy;
  event: ReturnContextEvent;
}) {
  return (
    <div
      data-testid="return-context-plate"
      className="-mx-6 bg-muted px-6 pt-4 pb-1 layout:hidden"
    >
      <p className="mb-1.5 text-eyebrow font-extrabold uppercase tracking-micro text-muted-foreground">
        {copy.eyebrow}
      </p>
      <ReturnEventCard event={event} />
    </div>
  );
}

type CardConfig = Pick<AuthFlowHostConfig, "copy" | "returnTo">;

/** The wide-layout composition: the card in the split's left half, with the door's assurance line. */
export function ReturnContextPanel({
  config,
  event,
  variant,
}: {
  config: CardConfig;
  event: ReturnContextEvent;
  variant: ReturnContextVariant;
}) {
  const copy = resolveAuthFlowCopy(config).returnContext;
  return copy ? (
    <PanelBody copy={copy} event={event} variant={variant} />
  ) : null;
}

/** The mobile composition: the card as the plate above the form, full-bleed across the column. */
export function ReturnContextPlate({
  config,
  event,
}: {
  config: CardConfig;
  event: ReturnContextEvent;
}) {
  const copy = resolveAuthFlowCopy(config).returnContext;
  return copy ? <PlateBody copy={copy} event={event} /> : null;
}

/**
 * Row 46 — the one gate. Both slots are present iff the host publishes the card,
 * states its words and the server resolved an event; otherwise both are
 * `undefined` so the frame renders its value prop and the form stands alone.
 */
export function returnContextSlots({
  config,
  event,
  variant,
}: {
  config: CardConfig;
  event: ReturnContextEvent | null;
  variant: ReturnContextVariant;
}): { panel: ReactNode | undefined; plate: ReactNode | undefined } {
  const copy = resolveAuthFlowCopy(config).returnContext;
  if (!config.returnTo?.card || !event) {
    return { panel: undefined, plate: undefined };
  }
  return {
    panel: <PanelBody copy={copy} event={event} variant={variant} />,
    plate: <PlateBody copy={copy} event={event} />,
  };
}
