"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system";
import type { DirectionAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { DirectionForm } from "@/components/direction-form";
import { DirectionLifecycleActions } from "@/components/direction-lifecycle-actions";
import { EventDirectionsPanel } from "@/components/event-directions-panel";
import { StatusChip } from "@/components/status-chip";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { UpdateDirectionVars } from "@/providers/data-provider";

/**
 * Direction detail / edit (012 EARS-3; 017 EARS-18). The main taxonomy form and
 * the direction's event relationships are separate sections of one detail page,
 * composed with the same approved tabs used by the sibling taxonomy resources.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is
 * refetched afterwards, so the next edit asserts the version the SERVER holds
 * rather than the one this page was first rendered from.
 *
 * There is no slug in the body: the address is derived on create and frozen on
 * first publish (017-design §9.3), so a retitle never moves the URL a doctor
 * bookmarked and this page has no identity decision left to send.
 */
export default function DirectionDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<DirectionAdminDetail>({
    resource: "directions",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("directions.statuses.draft"),
    published: t("directions.statuses.published"),
    retired: t("directions.statuses.retired"),
  };

  return (
    <Authenticated key="directions-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/directions" label={t("directions.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("directions.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="direction-heading"
              >
                {detail.title}
              </h1>
              <StatusChip
                status={detail.status}
                label={statusLabels[detail.status]}
                testId="direction-status"
              />
            </div>

            {/* The lifecycle bar sits ABOVE the edit form, next to the status
                chip it moves: publishing or withdrawing a direction is a
                decision about the whole record, not a field of it. */}
            <DirectionLifecycleActions
              id={detail.id}
              status={detail.status}
              version={detail.version}
              onTransition={() => {
                setErrorKey(null);
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
                {t(errorKey)}
              </Alert>
            ) : saved ? (
              <Alert
                variant="success"
                className="mb-4"
                data-testid="update-saved"
              >
                {t("directions.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("directions.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="events" data-testid="tab-events">
                  {t("directions.tabs.events")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <DirectionForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const vars: UpdateDirectionVars = {
                      title: values.title,
                      version: detail.version,
                    };
                    update(
                      { resource: "directions", id: detail.id, values: vars },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "directions.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </TabsContent>
              <TabsContent value="events">
                <EventDirectionsPanel mode="direction" entityId={detail.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
