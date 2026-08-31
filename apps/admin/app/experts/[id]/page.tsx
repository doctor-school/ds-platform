"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system";
import type { ExpertAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ExpertForm } from "@/components/expert-form";
import { EventExpertsPanel } from "@/components/event-experts-panel";
import { ProjectExpertsPanel } from "@/components/project-experts-panel";
import { PublishAction } from "@/components/publish-action";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { expertsUrl, type UpdateExpertVars } from "@/providers/data-provider";

/**
 * Expert detail / edit (012 EARS-2) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17). «Публикация» (012 EARS-5, #1287) now has
 * something to show — the publish command — so the tab ships; the withdraw and
 * restore halves join it with their own routes (#1295/#1296). An empty
 * placeholder tab is still deliberately NOT rendered.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is
 * refetched afterwards, so the next edit asserts the version the server actually
 * holds rather than the one this page was first rendered from.
 *
 * An emptied optional box is sent as an explicit `null` (not omitted): here the
 * operator IS making a decision — «this expert has no affiliation» — and PATCH
 * omission means «unchanged», which would silently keep the old value.
 */
export default function ExpertDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<ExpertAdminDetail>({
    resource: "experts",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("experts.statuses.draft"),
    published: t("experts.statuses.published"),
    retired: t("experts.statuses.retired"),
  };

  return (
    <Authenticated key="experts-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/experts" label={t("experts.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("experts.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="expert-heading"
              >
                {detail.name ?? t("experts.removedName")}
              </h1>
              <Badge variant="label" data-testid="expert-status">
                {statusLabels[detail.status]}
              </Badge>
            </div>

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
                {t("experts.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("experts.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="projects" data-testid="tab-projects">
                  {t("experts.tabs.projects")}
                </TabsTrigger>
                <TabsTrigger value="events" data-testid="tab-events">
                  {t("experts.tabs.events")}
                </TabsTrigger>
                <TabsTrigger value="publish" data-testid="tab-publish">
                  {t("experts.tabs.publish")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <ExpertForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const vars: UpdateExpertVars = {
                      familyName: values.familyName,
                      givenName: values.givenName,
                      patronymic: values.patronymic || null,
                      userId: values.userId || null,
                      professionalRole: values.professionalRole || null,
                      credentials: values.credentials || null,
                      affiliation: values.affiliation || null,
                      bio: values.bio || null,
                      ...(values.removePhoto && !values.photo
                        ? { mediaAction: "clear" as const }
                        : {}),
                      photo: values.photo,
                      version: detail.version,
                    };
                    update(
                      { resource: "experts", id: detail.id, values: vars },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "experts.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </TabsContent>

              {/* «Проекты» (012 EARS-9, 012-design §5.1) — the same canonical
                  relationship panel authors and reads the expert's project roles
                  from this endpoint too. */}
              <TabsContent value="projects">
                <ProjectExpertsPanel mode="expert" entityId={detail.id} />
              </TabsContent>

              <TabsContent value="events">
                <EventExpertsPanel mode="expert" entityId={detail.id} />
              </TabsContent>

              {/* «Публикация» (012 EARS-5) — publishing an expert makes every
                  active event link visible at once, so the server refuses a
                  slot a legacy speaker row still holds; that refusal has its own
                  sentence, because the fix is a NUMBER on the event. */}
              <TabsContent value="publish">
                <PublishAction
                  namespace="experts"
                  id={detail.id}
                  status={detail.status}
                  version={detail.version}
                  publishUrl={expertsUrl.publish}
                  onPublished={() => void query.refetch()}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
