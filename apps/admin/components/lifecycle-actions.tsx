"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { EventAdminDetail } from "@ds/schemas";
import {
  actionsFor,
  lifecycleCommandRequest,
  lifecycleErrorOutcome,
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
  const [error, setError] = useState<string | null>(null);
  const actions = actionsFor(detail.state, detail.validTransitions);

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="no-transitions">
        {t("events.action.none")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="danger" data-testid="transition-error">
          {error}
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
              setError(null);
              mutate(
                lifecycleCommandRequest(detail, action.command),
                {
                  onSuccess: () => refetch(),
                  onError: (failure) => {
                    const outcome = lifecycleErrorOutcome(failure);
                    setError(t(outcome.messageKey));
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
