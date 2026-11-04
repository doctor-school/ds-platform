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
import { PublishAction } from "@/components/publish-action";
import { ProjectResultsPanel } from "@/components/project-results-panel";
import {
  publishBlockers,
  refusedFields,
  taxonomyErrorKey,
} from "@/lib/taxonomy-errors";
import { projectsUrl, type UpdateProjectVars } from "@/providers/data-provider";

/** 030 EARS-6 — the tab that fixes each item a refused publish names. */
const BLOCKER_TAB: Record<string, string> = {
  title: "main",
  description: "main",
  stageNote: "main",
  results: "results",
  curator: "experts",
};

/**
 * Project detail / edit (012 EARS-1) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17). «Публикация» (012 EARS-5, #1287) now has
 * something to show — the publish command — so the tab ships; the withdraw and
 * restore halves join it with their own routes (#1295/#1296). An empty
 * placeholder tab is still never rendered: it would advertise a surface that
 * does nothing.
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
  const [refused, setRefused] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  // Controlled, so a refused publish can open the tab of each missing item.
  const [tab, setTab] = useState("main");

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
            {/* The heading and the status badge stack below `sm` so a long
                title and the badge never compete for the same line at a phone
                width (#1674, adopting the #1399/#1387 detail-header pattern). */}
            <div
              className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              data-testid="project-detail-header"
            >
              <h1
                className="min-w-0 break-words text-xl font-extrabold text-foreground"
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

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("projects.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="results" data-testid="tab-results">
                  {t("projects.tabs.results")}
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
                <TabsTrigger value="publish" data-testid="tab-publish">
                  {t("projects.tabs.publish")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <ProjectForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  refused={refused}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setRefused([]);
                    setSaved(false);
                    const vars: UpdateProjectVars = {
                      title: values.title,
                      description: values.description,
                      defaultAudience: values.defaultAudience,
                      stage: values.stage,
                      stageNote: values.stageNote,
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
                        onError: (error) => {
                          // 030 EARS-1 / EARS-6 — a refusal (a bad field, or
                          // an edit that would leave a published project
                          // incomplete) is marked at its fields.
                          setRefused([
                            ...refusedFields(error),
                            ...publishBlockers(error),
                          ]);
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "projects.errors.updateFailed",
                            ),
                          );
                        },
                      },
                    );
                  }}
                />
              </TabsContent>

              {/* «Результаты» (030 EARS-2) — the ordered set, saved whole under
                  the project's version; the project is re-read after a save. */}
              <TabsContent value="results">
                <ProjectResultsPanel
                  projectId={detail.id}
                  onSaved={() => void query.refetch()}
                />
              </TabsContent>

              {/* «События» (012 EARS-22) — reverse authoring through the same
                  EventProjectsPanel and canonical relationship command. */}
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

              {/* «Публикация» (012 EARS-5, 030 EARS-6) — publish only, and only
                  from a draft: the withdraw/restore routes are #3504's. A
                  refusal lists each missing item as a control opening the tab
                  that fixes it. */}
              <TabsContent value="publish">
                <PublishAction
                  namespace="projects"
                  id={detail.id}
                  status={detail.status}
                  version={detail.version}
                  publishUrl={projectsUrl.publish}
                  onPublished={() => void query.refetch()}
                  onOpenBlocker={(item) => setTab(BLOCKER_TAB[item] ?? "main")}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
