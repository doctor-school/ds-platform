"use client";

import { useParams } from "next/navigation";
import { Authenticated, useCustom, useOne } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { CongressIntakeSettings, EventAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { CongressIntakeSettingsForm } from "@/components/congress-intake-settings-form";
import { formatMskDateTime } from "@/lib/msk";
import {
  congressIntakeSettingsUrl,
  type TaxonomyHttpError,
} from "@/providers/data-provider";

/**
 * 046 EARS-2 (#2432) — the congress intake settings screen of one event,
 * `/events/:id/congress-intake`, linked from the event detail next to the 044
 * roster: the event's congress surfaces sit beside the event, each on its own
 * route. Only the platform administrator reaches it — the server refuses
 * everyone else (403), and the admin chrome offers a registrar only its roster
 * (`lib/admin-access.ts`), so the route is never drawn for one.
 */
export default function CongressIntakeSettingsPage() {
  const t = useTranslations("congressIntake");
  const params = useParams();
  const eventId = String(params.id);
  const { result: event } = useOne<EventAdminDetail>({
    resource: "events",
    id: eventId,
  });
  const { query } = useCustom<CongressIntakeSettings>({
    url: congressIntakeSettingsUrl(eventId),
    method: "get",
    queryOptions: { retry: false },
  });
  const settings = query.data?.data;
  const failure = query.error as TaxonomyHttpError | null | undefined;

  return (
    <Authenticated key="events-congress-intake" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList href={`/events/${eventId}`} label={t("backToEvent")} />
          <div>
            <h1 className="text-xl font-extrabold text-foreground">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {event
                ? t("description", {
                    title: event.title,
                    date: formatMskDateTime(event.startsAt),
                  })
                : t("loadingDescription")}
            </p>
          </div>
          {failure ? (
            <Alert variant="danger" data-testid="congress-intake-load-failed">
              {failure.statusCode === 404
                ? t("errors.notFound")
                : t("errors.loadFailed")}
            </Alert>
          ) : settings ? (
            <CongressIntakeSettingsForm settings={settings} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("loadingSettings")}
            </p>
          )}
        </div>
      </AppShell>
    </Authenticated>
  );
}
