"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { TaxonomyStatus } from "@ds/schemas";
import { LifecycleImpactDialog } from "@/components/lifecycle-impact-dialog";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { directionsUrl } from "@/providers/data-provider";

/**
 * The lifecycle bar of a direction record (012 EARS-13/14 §3.1; 017 EARS-18).
 *
 * ONLY the transitions that are valid from the row's CURRENT state are offered —
 * the same rule the relation bar follows. A draft can be published or withdrawn
 * before it ever goes out; a published direction can only be withdrawn; a retired
 * one can only come back. Rendering all three and letting the server refuse two of
 * them would be three buttons where two of them lie.
 *
 * THE TWO HALVES ARE NOT SYMMETRIC, deliberately:
 *
 * - **Publish is a plain command.** It withdraws nothing, so there is nothing to
 *   preview: §3.1's gate exists to make an operator SEE what disappears, and a
 *   confirmation dialog listing an empty consequence would be ceremony.
 * - **Retire and restore go through the impact dialog.** Retiring a direction
 *   withdraws every specialty link and adjacency edge hanging off it, and those
 *   rows are on screens the operator is not currently looking at. The signed
 *   preview token is what makes the confirmation provably about the set displayed.
 *
 * NO DELETE WORDING ANYWHERE (§3.1 + EARS-14). A direction is «снято с
 * публикации», never «удалено»: the row, its id and its slug are retained, so an
 * audit trail and a doctor's bookmark both keep resolving.
 *
 * ACTION CARDINALITY (017 EARS-16) is untouched by this component: the actions
 * live on the RECORD, so `/directions` keeps its single row action (open the
 * record) and does not grow an «Действия» column.
 */
export function DirectionLifecycleActions({
  id,
  status,
  version,
  onTransition,
}: {
  id: string;
  status: TaxonomyStatus;
  version: number;
  /** Re-read the detail: the row's version moved, so the next write must assert the new one. */
  onTransition: () => void;
}) {
  const t = useTranslations();
  const { mutate: publish, mutation: publishing } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  function settle(toastKey: string) {
    setErrorKey(null);
    setNoticeKey(toastKey);
    onTransition();
  }

  return (
    <div className="mb-6 flex flex-col gap-3" data-testid="direction-lifecycle">
      {errorKey ? (
        <Alert variant="danger" data-testid="transition-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="transition-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" ? (
          <Button
            type="button"
            size="sm"
            disabled={publishing.isPending}
            loading={publishing.isPending}
            data-testid="direction-publish"
            onClick={() => {
              setErrorKey(null);
              setNoticeKey(null);
              publish(
                {
                  url: directionsUrl.publish(id),
                  method: "post",
                  // An empty object, not `undefined`: the provider only sends a
                  // `content-type` when a body exists, and a command POST with a
                  // JSON content-type and NO body is refused by Fastify before
                  // the handler runs.
                  values: {},
                  meta: { version },
                },
                {
                  onSuccess: () => settle("directions.toast.published"),
                  onError: (error) => {
                    setNoticeKey(null);
                    setErrorKey(
                      taxonomyErrorKey(error, "directions.errors.publishFailed"),
                    );
                  },
                },
              );
            }}
          >
            {t("directions.actions.publish")}
          </Button>
        ) : null}

        {status === "retired" ? (
          <LifecycleImpactDialog
            transition="restore"
            namespace="directions"
            impactUrl={directionsUrl.impact(id, "restore")}
            confirmUrl={directionsUrl.transition(id, "restore")}
            version={version}
            triggerLabel={t("directions.action.restore")}
            testId="direction-restore"
            onConfirmed={settle}
            onError={(error, fallbackKey) => {
              setNoticeKey(null);
              setErrorKey(taxonomyErrorKey(error, fallbackKey));
            }}
          />
        ) : (
          <LifecycleImpactDialog
            transition="retire"
            namespace="directions"
            impactUrl={directionsUrl.impact(id, "retire")}
            confirmUrl={directionsUrl.transition(id, "retire")}
            version={version}
            triggerLabel={t("directions.action.retire")}
            testId="direction-retire"
            onConfirmed={settle}
            onError={(error, fallbackKey) => {
              setNoticeKey(null);
              setErrorKey(taxonomyErrorKey(error, fallbackKey));
            }}
          />
        )}
      </div>
    </div>
  );
}
