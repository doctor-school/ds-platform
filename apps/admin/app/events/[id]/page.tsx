"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ds/design-system";
import type { EventAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { EventForm } from "@/components/event-form";
import { StreamConfigForm } from "@/components/stream-config-form";
import { LifecycleActions } from "@/components/lifecycle-actions";
import { StateBadge } from "@/components/state-badge";
import { formatMskDateTime } from "@/lib/msk";
import type { UpdateEventVars } from "@/providers/data-provider";

/**
 * Event edit page (design §8) — the single detail surface carrying the aggregate
 * edit (EARS-2, incl. program-PDF replace), the stream config (EARS-3), and the
 * lifecycle action bar (EARS-4/5/6/7). It reads the full `EventAdminDetail` — the
 * single source of truth (EARS-9): the state badge, the МСК air time (EARS-10),
 * the offered transitions, and the current stream config all resolve from one
 * `EventLifecycleState`/aggregate. Mutations re-fetch the detail so the offered
 * transitions + badge stay exactly what the server just wrote.
 */
export default function EventEditPage() {
  const t = useTranslations();
  const params = useParams();
  const id = String(params.id);
  const { data, isLoading, refetch } = useOne<EventAdminDetail>({
    resource: "events",
    id,
  });
  const { mutate: update, isLoading: updating } = useUpdate();
  const [editError, setEditError] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);

  const detail = data?.data;

  return (
    <Authenticated key="events-edit" redirectOnFail="/login">
      <AppShell>
        {isLoading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <BackToList />
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-extrabold text-foreground">
                  {detail.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {formatMskDateTime(detail.startsAt)} {t("events.mskSuffix")}
                </p>
              </div>
              <StateBadge state={detail.state} />
            </div>

            {/* Lifecycle actions — only the currently-valid transitions (EARS-7). */}
            <Card>
              <CardHeader>
                <CardTitle>{t("events.sections.lifecycle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <LifecycleActions
                  detail={detail}
                  onTransition={() => refetch()}
                />
              </CardContent>
            </Card>

            {/* Stream config (EARS-3). */}
            <Card>
              <CardHeader>
                <CardTitle>{t("events.sections.stream")}</CardTitle>
              </CardHeader>
              <CardContent>
                <StreamConfigForm
                  detail={detail}
                  onConfigured={() => refetch()}
                />
              </CardContent>
            </Card>

            {/* Aggregate edit + program-PDF replace (EARS-2). */}
            <Card>
              <CardHeader>
                <CardTitle>{t("events.editTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {editError ? (
                  <Alert variant="danger" className="mb-4" data-testid="edit-error">
                    {editError}
                  </Alert>
                ) : null}
                {editOk ? (
                  <Alert variant="success" className="mb-4" data-testid="edit-ok">
                    {t("events.toast.updated")}
                  </Alert>
                ) : null}
                <EventForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={updating}
                  onSubmit={(values) => {
                    setEditError(null);
                    setEditOk(false);
                    const vars: UpdateEventVars = {
                      title: values.title,
                      school: values.school,
                      startsAtMsk: values.startsAtMsk,
                      durationMin: values.durationMin,
                      description: values.description,
                      speakers: values.speakers,
                      specialties: values.specialties,
                      partnerRef: values.partnerRef,
                      programPdf: values.programPdf,
                    };
                    update(
                      { resource: "events", id, values: vars },
                      {
                        onSuccess: () => {
                          setEditOk(true);
                          refetch();
                        },
                        onError: () =>
                          setEditError(t("events.errors.updateFailed")),
                      },
                    );
                  }}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </AppShell>
    </Authenticated>
  );
}
