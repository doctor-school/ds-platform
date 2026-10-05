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
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type {
  TaxonomyHttpError,
  UpdateEventKindVars,
} from "@/providers/data-provider";

/** The per-event entries of a refused narrowing (`allowedFormats.events.<id>`). */
const NARROW_EVENT_PATH = "allowedFormats.events.";

interface NarrowConflictEvent {
  id: string;
  title: string;
}

/**
 * The events a refused narrowing names (012 EARS-25): the API addresses one
 * field error per conflicting event under `allowedFormats.events.<id>`, its
 * message the event title — so the page names and links each one without
 * parsing the English summary sentence.
 */
function narrowConflictEvents(error: unknown): NarrowConflictEvent[] {
  const fieldErrors = (error as TaxonomyHttpError | undefined)?.fieldErrors;
  return (fieldErrors ?? [])
    .filter((entry) => entry.path.startsWith(NARROW_EVENT_PATH))
    .map((entry) => ({
      id: entry.path.slice(NARROW_EVENT_PATH.length),
      title: entry.message,
    }));
}

/**
 * Event-kind detail / edit (012 EARS-25/28, #2509) — the Directions detail
 * one-to-one («Как «Направления»»): status chip and lifecycle bar above the
 * edit form, every save carrying the row's `version` as `If-Match`, the detail
 * refetched after each save.
 *
 * The owner rule on narrowing (#2509, «если таксономия не матчится, то и не
 * должно быть возможности выбора несовместимых типов»): removing a format
 * while events of this kind carry it is refused by the API, and this page
 * renders that refusal with the named events, each a link to its editor, so
 * the operator moves those events first. No mismatch state exists anywhere.
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
  const [conflicts, setConflicts] = useState<NarrowConflictEvent[]>([]);
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
                setConflicts([]);
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
                <p>{t(errorKey)}</p>
                {conflicts.length > 0 ? (
                  <div className="mt-2" data-testid="narrow-refused-events">
                    <p>{t("eventKinds.errors.narrowRefusedEvents")}</p>
                    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                      {conflicts.map((event) => (
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
                setConflicts([]);
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
                      setConflicts(narrowConflictEvents(error));
                      setErrorKey(
                        taxonomyErrorKey(error, "eventKinds.errors.updateFailed"),
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
