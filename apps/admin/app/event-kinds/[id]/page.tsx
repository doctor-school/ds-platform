"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Link } from "@ds/design-system";
import type { EventKindAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { EventKindForm } from "@/components/event-kind-form";
import { EventKindLifecycleActions } from "@/components/event-kind-lifecycle-actions";
import { StatusChip } from "@/components/status-chip";
import {
  narrowRefusal,
  taxonomyErrorKey,
  type NarrowRefusal,
} from "@/lib/taxonomy-errors";
import type { UpdateEventKindVars } from "@/providers/data-provider";

/**
 * Event-kind detail / edit (012 EARS-25/28, #2509) — the Directions detail
 * one-to-one («Как «Направления»»): status chip and lifecycle bar above the
 * edit form, every save carrying the row's `version` as `If-Match`, the detail
 * refetched after each save.
 *
 * The owner rule on narrowing (#2509, «если таксономия не матчится, то и не
 * должно быть возможности выбора несовместимых типов»): removing a format
 * while events of this kind carry it is refused by the API, and this page
 * renders that refusal as the count of blocking events, the first five of them
 * each a link to its editor, and how many more remain, so the operator moves
 * those events first. No mismatch state exists anywhere.
 */
export default function EventKindDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<EventKindAdminDetail>({
    resource: "event-kinds",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<NarrowRefusal | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("eventKinds.statuses.draft"),
    published: t("eventKinds.statuses.published"),
    retired: t("eventKinds.statuses.retired"),
  };

  return (
    <Authenticated key="event-kinds-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/event-kinds" label={t("eventKinds.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("eventKinds.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="event-kind-heading"
              >
                {detail.title}
              </h1>
              <StatusChip
                status={detail.status}
                label={statusLabels[detail.status]}
                testId="event-kind-status"
              />
            </div>

            <EventKindLifecycleActions
              id={detail.id}
              status={detail.status}
              version={detail.version}
              onTransition={() => {
                setErrorKey(null);
                setRefusal(null);
                setSaved(false);
                void query.refetch();
              }}
            />

            {errorKey ? (
              <Alert
                variant="danger"
                className="mb-4"
                data-testid="update-error"
              >
                <p>
                  {refusal
                    ? t("eventKinds.errors.narrowRefused", {
                        count: refusal.total,
                      })
                    : t(errorKey)}
                </p>
                {refusal && refusal.events.length > 0 ? (
                  <div className="mt-2" data-testid="narrow-refused-events">
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {refusal.events.map((event) => (
                        <li key={event.id}>
                          <Link asChild>
                            <NextLink
                              href={`/events/${event.id}`}
                              data-testid={`narrow-refused-event-${event.id}`}
                            >
                              {event.title}
                            </NextLink>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {refusal.more > 0 ? (
                      <p className="mt-1" data-testid="narrow-refused-more">
                        {t("eventKinds.errors.narrowRefusedMore", {
                          count: refusal.more,
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Alert>
            ) : saved ? (
              <Alert
                variant="success"
                className="mb-4"
                data-testid="update-saved"
              >
                {t("eventKinds.savedNotice")}
              </Alert>
            ) : null}

            <EventKindForm
              detail={detail}
              submitLabel={t("common.save")}
              submitting={mutation.isPending}
              onSubmit={(values) => {
                setErrorKey(null);
                setRefusal(null);
                setSaved(false);
                const vars: UpdateEventKindVars = {
                  title: values.title,
                  allowedFormats: values.allowedFormats,
                  version: detail.version,
                };
                update(
                  { resource: "event-kinds", id: detail.id, values: vars },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      void query.refetch();
                    },
                    onError: (error) => {
                      const refused = narrowRefusal(error);
                      const key = taxonomyErrorKey(
                        error,
                        "eventKinds.errors.updateFailed",
                      );
                      setRefusal(refused);
                      // The narrowing sentence needs its count; a conflict
                      // without one falls back to the generic sentence.
                      setErrorKey(
                        key === "eventKinds.errors.narrowRefused" && !refused
                          ? "eventKinds.errors.updateFailed"
                          : key,
                      );
                    },
                  },
                );
              }}
            />
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
