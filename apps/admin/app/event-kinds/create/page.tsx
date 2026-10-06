"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { EventKindAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { EventKindForm } from "@/components/event-kind-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateEventKindVars } from "@/providers/data-provider";

/**
 * Create an event kind (012 EARS-25, #2509) — the Directions create page
 * one-to-one. The operator authors a `draft` with a title and its allowed
 * formats; the slug is derived by the API. On success the page routes to the
 * kind's detail, where the lifecycle bar publishes it.
 */
export default function CreateEventKindPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="event-kinds-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/event-kinds" label={t("eventKinds.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("eventKinds.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <EventKindForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreateEventKindVars = {
              title: values.title,
              allowedFormats: values.allowedFormats,
            };
            create(
              { resource: "event-kinds", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as EventKindAdminDetail;
                  router.push(`/event-kinds/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "eventKinds.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
