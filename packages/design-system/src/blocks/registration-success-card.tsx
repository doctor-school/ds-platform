import * as React from "react";

import { Alert } from "../primitives/alert";
import { Button } from "../primitives/button";
import { AuthCard } from "./auth-card";

/**
 * `<RegistrationSuccessCard>` (021 EARS-9 + EARS-10, #1546) — the ONE canonical
 * post-confirmation success state of a registration door.
 *
 * A shared block rather than a doctor-host component (AGENTS.md §6 cross-front
 * reuse): «код принят — вот что вы получили и вот куда дальше» is a cross-front
 * composition, so it lives here once and each host projects it with its own copy
 * and its own hrefs.
 *
 * It is DATA-IN, PRESENTATION-OUT and decides NOTHING:
 *
 * • it never composes an href — both actions arrive as resolved strings the host
 *   took from the confirmation response (021-design §3, property 1: no
 *   navigation target is ever assembled on the client);
 * • it never invents an amount or a motivation line — `accrual` is the sentence
 *   the host resolved from the response's `credited` FACT, and
 *   `profileCompletion` is ABSENT from the tree when the server has nothing to
 *   name (LD-6 forbids a configuration-derived stand-in, and an empty frame is
 *   forbidden too);
 * • it never re-ranks the actions. `primary` is the landing and `secondary` is
 *   the cabinet, in that order, always — EARS-10's requirement is about RANK,
 *   and a block that let the call site swap them would ship the one shape the
 *   clause forbids.
 *
 * `reason` (LD-8) is the plain statement of what happened to a carried target
 * that could not be honoured, rendered ABOVE the actions in an `Alert` whose
 * `info` variant carries `role="status"` — the doctor reads WHY the destination
 * changed before they read the button that takes them there.
 *
 * Composed only from `AuthCard` / `Button` / `Alert`, tokens only; every
 * clickable is the `Button` primitive rendering an anchor through `asChild`, so
 * hover / focus-visible / press states are the primitive's, never hand-styled.
 */
export type RegistrationSuccessAction = {
  /** The resolved destination. Server-supplied or host-decided, never composed here. */
  href: string;
  /** The app-supplied, localized label. */
  label: React.ReactNode;
};

export type RegistrationSuccessCardProps = {
  /** The success heading (app-supplied, localized). */
  title: React.ReactNode;
  /** Optional sub-copy under the heading. */
  description?: React.ReactNode;
  /** Optional leading glyph, promoted into the `AuthCard` badge tile. */
  icon?: React.ReactNode;
  /**
   * The registration accrual as the host resolved it from the response's
   * `credited` field — the pending promise while it is `null`, the stated fact
   * once a number arrives. Required: the doctor is always told what happens to
   * their starting points, and «ничего» is not one of the two answers.
   */
  accrual: React.ReactNode;
  /**
   * EARS-9's profile-completion line, verbatim from the server. Omitted when the
   * server has nothing configured to name — the row is then absent, not empty.
   */
  profileCompletion?: React.ReactNode;
  /** LD-8 — what happened to the carried target, when something did. */
  reason?: React.ReactNode;
  /** EARS-10 — where the doctor goes. Never the account page. */
  primary: RegistrationSuccessAction;
  /** EARS-10 — «в личный кабинет», secondary and never the default. */
  secondary: RegistrationSuccessAction;
};

export function RegistrationSuccessCard({
  title,
  description,
  icon,
  accrual,
  profileCompletion,
  reason,
  primary,
  secondary,
}: RegistrationSuccessCardProps) {
  return (
    <AuthCard
      data-testid="registration-success"
      title={title}
      description={description}
      icon={icon}
    >
      <div className="flex flex-col gap-4">
        {/* The accrual row. One plain line, not the canvas's three-column points
            plate: that plate is feature 025's ledger surface, and three columns
            around a single pending promise would be a frame with no fact in it. */}
        <div
          data-testid="registration-success-accrual"
          className="border-2 border-border px-4 py-3.5 text-sm leading-normal text-foreground"
        >
          {accrual}
        </div>
        {profileCompletion ? (
          <div
            data-testid="registration-success-profile"
            className="border-2 border-hairline px-4 py-3.5 text-sm leading-normal text-muted-foreground"
          >
            {profileCompletion}
          </div>
        ) : null}
        {reason ? (
          <Alert variant="info" data-testid="registration-success-reason">
            {reason}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <a data-testid="registration-success-primary" href={primary.href}>
              {primary.label}
            </a>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a
              data-testid="registration-success-secondary"
              href={secondary.href}
            >
              {secondary.label}
            </a>
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
