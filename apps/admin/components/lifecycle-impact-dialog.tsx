"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ds/design-system";
import type { LifecycleImpact, TaxonomyLifecycleTransition } from "@ds/schemas";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";

/**
 * The 012-design §3.1 lifecycle-impact confirmation — PREVIEW, then CONFIRM.
 *
 * The whole point of the gate is that the operator answers a question they have
 * actually been shown: opening the dialog reads the transition-specific preview,
 * renders EVERY affected row (`kind · title · slug · status`), and only then
 * offers the confirm button. The signed `impactToken` the preview returned rides
 * the confirmation, so what is applied is provably the state that was displayed.
 *
 * NO DELETE WORDING ANYWHERE (§3.1 + EARS-14). The transition is «снять связь» /
 * «восстановить связь»: the row is retained, addressable and restorable, and
 * saying «удалить» would describe an operation this platform does not have.
 *
 * A STALE PREVIEW RELOADS, IT NEVER AUTO-RETRIES. When the confirmation comes
 * back 412 `LIFECYCLE_IMPACT_STALE`, the world moved between the preview and the
 * confirm — the displayed list is no longer what would happen. Re-sending with a
 * fresh token would apply a change nobody was shown, so the dialog stays open,
 * says so, and re-reads the preview for the operator to answer again.
 */
export function LifecycleImpactDialog({
  transition,
  impactUrl,
  confirmUrl,
  version,
  triggerLabel,
  triggerVariant = "outline",
  testId,
  namespace,
  onConfirmed,
  onError,
}: {
  transition: TaxonomyLifecycleTransition;
  impactUrl: string;
  confirmUrl: string;
  version: number;
  triggerLabel: string;
  triggerVariant?: "default" | "outline";
  testId: string;
  /** The RU catalogue namespace the copy and the error keys are read from. */
  namespace: string;
  onConfirmed: (toastKey: string) => void;
  onError: (error: unknown, fallbackKey: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [staleKey, setStaleKey] = useState<string | null>(null);

  // The preview is read ON OPEN and not before: it is a point-in-time answer with
  // a 15-minute envelope, so fetching it while the dialog is closed would hand
  // the operator a token that is already older than the question they are asked.
  const { query } = useCustom<LifecycleImpact>({
    url: impactUrl,
    method: "get",
    queryOptions: { enabled: open },
  });
  const { mutate, mutation } = useCustomMutation();

  // Read the PREVIEW off the query, not off `result`: Refine's `result.data`
  // falls back to a frozen `{}` when the query has no answer yet, so a
  // presence check against it is always true and `impact.affected` blows up on
  // the very first render (the dialog body is built eagerly, closed or not).
  const impact = query.data?.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStaleKey(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" data-testid={testId}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid={`${testId}-dialog`}>
        <DialogHeader>
          <DialogTitle>{t(`${namespace}.confirm.${transition}Title`)}</DialogTitle>
          <DialogDescription>
            {t(`${namespace}.confirm.${transition}Body`)}
          </DialogDescription>
        </DialogHeader>

        {staleKey ? (
          <Alert variant="danger" data-testid={`${testId}-stale`}>
            {t(staleKey)}
          </Alert>
        ) : null}

        {query.isFetching ? (
          <p className="text-sm text-muted-foreground" data-testid={`${testId}-loading`}>
            {t("common.loading")}
          </p>
        ) : !impact ? (
          <Alert variant="danger" data-testid={`${testId}-impact-error`}>
            {t(`${namespace}.errors.impactLoadFailed`)}
          </Alert>
        ) : (
          <div className="flex flex-col gap-3" data-testid={`${testId}-impact`}>
            {impact.affected.length === 0 ? (
              // A transition with no visible consequence is a real answer, not an
              // empty state to hide: the operator is told that nothing else on the
              // public surface changes, so they confirm knowing the blast radius.
              <p
                className="text-sm text-muted-foreground"
                data-testid={`${testId}-affected-empty`}
              >
                {t(`${namespace}.confirm.affectedNone`)}
              </p>
            ) : (
              <>
                <p className="text-sm text-foreground">
                  {t(`${namespace}.confirm.affectedTitle`, {
                    count: impact.affected.length,
                  })}
                </p>
                <ul className="flex flex-col gap-2" data-testid={`${testId}-affected`}>
                  {impact.affected.map((row) => (
                    <li
                      key={`${row.kind}:${row.id}`}
                      className="flex flex-wrap items-center gap-2 border-2 border-border p-2"
                      data-testid={`${testId}-affected-row`}
                    >
                      <Badge variant="label">{row.kind}</Badge>
                      <span className="text-sm font-bold text-foreground">
                        {row.title}
                      </span>
                      {/* A join row has no address of its own — saying so beats an
                          empty cell the operator has to interpret. */}
                      <span className="text-sm text-muted-foreground">
                        {row.slug ?? t("common.notSet")}
                      </span>
                      <Badge variant="label">
                        {t(`${namespace}.rowStatuses.${row.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            data-testid={`${testId}-submit`}
            loading={mutation.isPending}
            // Nothing to confirm until the preview is in hand: without the token
            // the call could only ever come back 428, which is a button that lies.
            disabled={!impact || query.isFetching}
            onClick={() => {
              if (!impact) return;
              setStaleKey(null);
              mutate(
                {
                  url: confirmUrl,
                  method: "post",
                  values: {},
                  meta: { version, impactToken: impact.impactToken },
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    onConfirmed(`${namespace}.toast.${transition}d`);
                  },
                  onError: (error) => {
                    const key = taxonomyErrorKey(
                      error,
                      `${namespace}.errors.transitionFailed`,
                    );
                    if (key === `${namespace}.errors.impactStale`) {
                      // Stay open and re-read: the operator must answer the NEW
                      // question, and an auto-retry would apply an unseen change.
                      setStaleKey(key);
                      void query.refetch();
                      return;
                    }
                    setOpen(false);
                    onError(error, `${namespace}.errors.transitionFailed`);
                  },
                },
              );
            }}
          >
            {t(`${namespace}.action.${transition}`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
