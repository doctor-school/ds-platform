"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { TaxonomyStatus } from "@ds/schemas";
import { LifecycleImpactDialog } from "@/components/lifecycle-impact-dialog";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { eventKindsUrl } from "@/providers/data-provider";

/**
 * The lifecycle bar of an event-kind record (012 EARS-25/28, #2509) — the
 * Directions bar one-to-one («Как «Направления»»). Only the transitions valid
 * from the current state are offered. Publish is a plain command (it withdraws
 * nothing); retire and restore go through the signed lifecycle-impact preview,
 * which lists the publicly visible events carrying the kind. A retired kind
 * leaves the selectors and the public kind list; its events keep the reference.
 * No delete wording: a kind is «снят с публикации», never «удалён».
 */
export function EventKindLifecycleActions({
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
    <div className="mb-6 flex flex-col gap-3" data-testid="event-kind-lifecycle">
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
            data-testid="event-kind-publish"
            onClick={() => {
              setErrorKey(null);
              setNoticeKey(null);
              publish(
                {
                  url: eventKindsUrl.publish(id),
                  method: "post",
                  // An empty object, not `undefined`: the provider only sends a
                  // `content-type` when a body exists, and a command POST with a
                  // JSON content-type and NO body is refused by Fastify before
                  // the handler runs.
                  values: {},
                  meta: { version },
                },
                {
                  onSuccess: () => settle("eventKinds.toast.published"),
                  onError: (error) => {
                    setNoticeKey(null);
                    setErrorKey(
                      taxonomyErrorKey(error, "eventKinds.errors.publishFailed"),
                    );
                  },
                },
              );
            }}
          >
            {t("eventKinds.actions.publish")}
          </Button>
        ) : null}

        {status === "retired" ? (
          <LifecycleImpactDialog
            transition="restore"
            namespace="eventKinds"
            impactUrl={eventKindsUrl.impact(id, "restore")}
            confirmUrl={eventKindsUrl.transition(id, "restore")}
            version={version}
            triggerLabel={t("eventKinds.action.restore")}
            testId="event-kind-restore"
            onConfirmed={settle}
            onError={(error, fallbackKey) => {
              setNoticeKey(null);
              setErrorKey(taxonomyErrorKey(error, fallbackKey));
            }}
          />
        ) : (
          <LifecycleImpactDialog
            transition="retire"
            namespace="eventKinds"
            impactUrl={eventKindsUrl.impact(id, "retire")}
            confirmUrl={eventKindsUrl.transition(id, "retire")}
            version={version}
            triggerLabel={t("eventKinds.action.retire")}
            testId="event-kind-retire"
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
