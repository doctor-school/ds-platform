"use client";

import { useEffect, useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { EventAdminDetail } from "@ds/schemas";
import {
  REFUSAL_DISMISS_MS,
  actionsFor,
  lifecycleCommandRequest,
  lifecycleErrorOutcome,
  lifecycleSignature,
} from "@/lib/lifecycle";

/**
 * The lifecycle-action bar (EARS-5/6/7, design §2/§8). The offered buttons are
 * derived ONLY from the server-supplied `detail.validTransitions` (via
 * {@link actionsFor}) — the admin UI offers ONLY the transitions valid from the
 * current state, and it never invents one. A terminal `archived` event yields no
 * buttons. Each fires its named command (`POST /v1/admin/events/:id/{publish|open|
 * close|archive|mark-ended}`); the server is the authority (EARS-7) — an
 * out-of-order call it refuses (409) surfaces as `transitionRefused`, the state
 * untouched. Stock DS buttons (EARS-11), RU copy (EARS-10).
 *
 * Every command is CONDITIONAL on the version the operator's screen was rendered
 * from (#1593): {@link lifecycleCommandRequest} carries it as `meta.version`, the
 * data provider turns that into `If-Match`, and a command built from a stale read
 * is refused 412 instead of overwriting another operator's action. That refusal
 * is NOT an illegal transition and must not be worded as one — {@link
 * lifecycleErrorOutcome} routes it to the shared `events.errors.stale` sentence
 * and asks the screen to re-read the event, so the operator's retry is one more
 * click on a fresh validator rather than a manual browser reload (a resent spent
 * validator would answer 412 again, indefinitely).
 *
 * `refetch` is therefore fired on BOTH outcomes: an applied transition and a
 * stale-read refusal both leave the screen holding an out-of-date version.
 *
 * A refusal alert is scoped to the lifecycle facts it was raised against
 * ({@link lifecycleSignature}), not to the component's lifetime. When the re-read
 * it triggered lands on a different signature — the 409 case replaces badge and
 * actions, the 412 case spends and replaces the version — the explanation has
 * outlived its subject, so it self-dismisses {@link REFUSAL_DISMISS_MS} later:
 * long enough to read, short enough that it never sits beside already-corrected
 * state (the owner's Stage-B screenshot, 2026-09-01). The next command clears it
 * immediately, as before. No new visual element: the design system ships no
 * toast/notification primitive, so this is the SAME `Alert` on a timer.
 *
 * `detail.state` is passed alongside the transitions because since 014 EARS-18
 * two commands share the `ended` target — `close` from `live` and `mark-ended`
 * from `published` — so the ORIGIN is what names the command (`lib/lifecycle`).
 */
export function LifecycleActions({
  detail,
  refetch,
}: {
  detail: EventAdminDetail;
  refetch: () => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  // The refusal carries the signature it was raised AGAINST, so the dismissal
  // rule is a comparison rather than a guess about which refetch was "the" one.
  const [refusal, setRefusal] = useState<{
    message: string;
    signature: string;
  } | null>(null);
  const actions = actionsFor(detail.state, detail.validTransitions);
  const signature = lifecycleSignature(detail);

  useEffect(() => {
    if (!refusal || refusal.signature === signature) return;
    const timer = setTimeout(() => setRefusal(null), REFUSAL_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [refusal, signature]);

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="no-transitions">
        {t("events.action.none")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {refusal ? (
        <Alert variant="danger" data-testid="transition-error">
          {refusal.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3" data-testid="lifecycle-actions">
        {actions.map((action) => (
          <Button
            key={action.command}
            type="button"
            disabled={mutation.isPending}
            data-testid={action.testId}
            onClick={() => {
              setRefusal(null);
              // Captured BEFORE the command: the alert is about the screen the
              // operator clicked on, and the refetch that follows a refusal is
              // exactly what makes that screen obsolete.
              const raisedAgainst = signature;
              mutate(
                lifecycleCommandRequest(detail, action.command),
                {
                  onSuccess: () => refetch(),
                  onError: (failure) => {
                    const outcome = lifecycleErrorOutcome(failure);
                    setRefusal({
                      message: t(outcome.messageKey),
                      signature: raisedAgainst,
                    });
                    if (outcome.refetch) refetch();
                  },
                },
              );
            }}
          >
            {t(action.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
