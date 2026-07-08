"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { EventAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { EventForm } from "@/components/event-form";
import type { CreateEventVars } from "@/providers/data-provider";

/**
 * Create-event page (EARS-1) — the operator authors a `draft` event with the full
 * field set + program PDF; on success it routes to the event's edit page (where
 * the stream config + lifecycle actions live). Stock DS form (EARS-11), RU copy
 * (EARS-10). The multipart create rides `dataProvider.create`.
 */
export default function CreateEventPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, isLoading } = useCreate();
  const [error, setError] = useState<string | null>(null);

  return (
    <Authenticated key="events-create" redirectOnFail="/login">
      <AppShell>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("events.createTitle")}
        </h1>
        {error ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {error}
          </Alert>
        ) : null}
        <EventForm
          submitLabel={t("common.save")}
          submitting={isLoading}
          onSubmit={(values) => {
            setError(null);
            const vars: CreateEventVars = {
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
            create(
              { resource: "events", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as EventAdminDetail;
                  router.push(`/events/${created.id}`);
                },
                onError: () => setError(t("events.errors.createFailed")),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
