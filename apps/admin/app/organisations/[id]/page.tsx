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
import type { OrganisationAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { OrganisationForm } from "@/components/organisation-form";
import { ProjectPartnersPanel } from "@/components/project-partners-panel";
import { PublishAction } from "@/components/publish-action";
import { refusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import {
  organisationsUrl,
  type UpdateOrganisationVars,
} from "@/providers/data-provider";

/**
 * Organisation detail / edit (032 EARS-1, EARS-2; 012 EARS-4 before it) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17) — the same shell the expert and direction details
 * mount. «Публикация» (012 EARS-5, #1287) ships with the publish command; the
 * retire/restore controls join it with their own routes (#1295/#1296), and an
 * empty placeholder tab is still deliberately NOT rendered.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is
 * refetched afterwards, so the next edit asserts the version the server actually
 * holds rather than the one this page was first rendered from.
 *
 * An emptied website box is sent as an explicit `null` (not omitted): here the
 * operator IS making a decision — «у этой организации нет сайта» — and PATCH
 * omission means «unchanged», which would silently keep the old address. The
 * same holds for an emptied description, and the role set is always sent whole
 * (present replaces the set, EARS-2).
 *
 * The «Публикация» tab is the 012 publish command unchanged; the 032 lifecycle
 * (unpublish with impact preview, return to draft, the role gate) is #3493.
 */
export default function OrganisationDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<OrganisationAdminDetail>({
    resource: "organisations",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("organisations.statuses.draft"),
    published: t("organisations.statuses.published"),
    retired: t("organisations.statuses.retired"),
  };

  return (
    <Authenticated key="organisations-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/organisations"
            label={t("organisations.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("organisations.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            {/* The heading and the status badge stack below `sm` so a long
                title and the badge never compete for the same line at a phone
                width (#1674, adopting the #1399/#1387 detail-header pattern). */}
            <div
              className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              data-testid="organisation-detail-header"
            >
              <h1
                className="min-w-0 break-words text-xl font-extrabold text-foreground"
                data-testid="organisation-heading"
              >
                {detail.title}
              </h1>
              <Badge variant="label" data-testid="organisation-status">
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
                {t("organisations.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("organisations.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="projects" data-testid="tab-projects">
                  {t("organisations.tabs.projects")}
                </TabsTrigger>
                <TabsTrigger value="publish" data-testid="tab-publish">
                  {t("organisations.tabs.publish")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <OrganisationForm
                  key={detail.version}
                  detail={detail}
                  refused={refused}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    setRefused([]);
                    const vars: UpdateOrganisationVars = {
                      title: values.title,
                      websiteUrl: values.websiteUrl || null,
                      description: values.description || null,
                      roleIds: values.roleIds,
                      publicNameVisible: values.publicNameVisible,
                      publicLogoVisible: values.publicLogoVisible,
                      ...(values.removeLogo && !values.logo
                        ? { mediaAction: "clear" as const }
                        : {}),
                      logo: values.logo,
                      version: detail.version,
                    };
                    update(
                      {
                        resource: "organisations",
                        id: detail.id,
                        values: vars,
                      },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) => {
                          setRefused(refusedFields(error));
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "organisations.errors.updateFailed",
                            ),
                          );
                        },
                      },
                    );
                  }}
                />
              </TabsContent>

              {/* «Проекты» (012 EARS-22) — reverse authoring through the same
                  ProjectPartnersPanel and canonical relationship command. */}
              <TabsContent value="projects">
                <ProjectPartnersPanel mode="partner" entityId={detail.id} />
              </TabsContent>

              {/* «Публикация» (012 EARS-5) — an organisation carries no completeness
                  branch and no relation invariant (§5.2: logo and website are
                  nullable), so the only refusals here are the shared protocol
                  ones. */}
              <TabsContent value="publish">
                <PublishAction
                  namespace="organisations"
                  id={detail.id}
                  status={detail.status}
                  version={detail.version}
                  publishUrl={organisationsUrl.publish}
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
