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
import type { ProjectAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ProjectForm } from "@/components/project-form";
import { EventProjectsPanel } from "@/components/event-projects-panel";
import { ProjectExpertsPanel } from "@/components/project-experts-panel";
import { ProjectPartnersPanel } from "@/components/project-partners-panel";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { UpdateProjectVars } from "@/providers/data-provider";

/**
 * Project detail / edit (012 EARS-1) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17). Only «Основное» ships in this slice: «Связи»
 * (#1288/#1291/#1292) and «Публикация» (#1287/#1295/#1296) are added by their own
 * slices, and an empty placeholder tab is deliberately NOT rendered — it would
 * advertise a surface that does nothing.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is refetched
 * afterwards, so the next edit asserts the version the server actually holds
 * rather than the one this page was first rendered from.
 */
export default function ProjectDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<ProjectAdminDetail>({
    resource: "projects",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("projects.statuses.draft"),
    published: t("projects.statuses.published"),
    retired: t("projects.statuses.retired"),
  };

  return (
    <Authenticated key="projects-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/projects" label={t("projects.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("projects.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="project-heading"
              >
                {detail.title}
              </h1>
              <Badge variant="label" data-testid="project-status">
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
                {t("projects.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("projects.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="events" data-testid="tab-events">
                  {t("projects.tabs.events")}
                </TabsTrigger>
                <TabsTrigger value="experts" data-testid="tab-experts">
                  {t("projects.tabs.experts")}
                </TabsTrigger>
                <TabsTrigger value="partners" data-testid="tab-partners">
                  {t("projects.tabs.partners")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <ProjectForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const vars: UpdateProjectVars = {
                      kind: values.kind,
                      title: values.title,
                      description: values.description,
                      ...(values.removeCover && !values.cover
                        ? { mediaAction: "clear" as const }
                        : {}),
                      cover: values.cover,
                      version: detail.version,
                    };
                    update(
                      { resource: "projects", id: detail.id, values: vars },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "projects.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </TabsContent>

              {/* «События» (012 EARS-6, 012-design §5.1) — the READ direction of
                  the same relationship. Authoring stays on the event detail, so
                  one fact has exactly one authoring home; here the operator sees
                  which эфиры this project holds and can still move a link
                  through its §3.1 gate without leaving the project. */}
              <TabsContent value="events">
                <EventProjectsPanel mode="project" entityId={detail.id} />
              </TabsContent>

              {/* «Эксперты» (012 EARS-9, 012-design §5.1) — the AUTHORING side of
                  the project↔expert relation, and the only home of the curator
                  seat. The project's own `version` goes down with it because
                  `replace-curator` preconditions on the PROJECT, not on a row. */}
              <TabsContent value="experts">
                <ProjectExpertsPanel
                  mode="project"
                  entityId={detail.id}
                  projectVersion={detail.version}
                />
              </TabsContent>

              {/* «Партнёры» (012 EARS-10, 012-design §5.1) — the AUTHORING side of
                  the project↔partner relation, including which partner is the
                  primary one the public project page shows. */}
              <TabsContent value="partners">
                <ProjectPartnersPanel mode="project" entityId={detail.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
