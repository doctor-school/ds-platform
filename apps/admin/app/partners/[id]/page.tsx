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
import type { PartnerAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { PartnerForm } from "@/components/partner-form";
import { ProjectPartnersPanel } from "@/components/project-partners-panel";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { UpdatePartnerVars } from "@/providers/data-provider";

/**
 * Partner detail / edit (012 EARS-4) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17) — the same shell the expert and direction details
 * mount. Only «Основное» ships in this slice; «Публикация» (#1287/#1295/#1296)
 * brings the retire/restore controls with its own routes, and an empty
 * placeholder tab is deliberately NOT rendered for it.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is
 * refetched afterwards, so the next edit asserts the version the server actually
 * holds rather than the one this page was first rendered from.
 *
 * An emptied website box is sent as an explicit `null` (not omitted): here the
 * operator IS making a decision — «у этого партнёра нет сайта» — and PATCH
 * omission means «unchanged», which would silently keep the old address.
 */
export default function PartnerDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<PartnerAdminDetail>({
    resource: "partners",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("partners.statuses.draft"),
    published: t("partners.statuses.published"),
    retired: t("partners.statuses.retired"),
  };

  return (
    <Authenticated key="partners-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/partners" label={t("partners.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("partners.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="partner-heading"
              >
                {detail.title}
              </h1>
              <Badge variant="label" data-testid="partner-status">
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
                {t("partners.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("partners.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="projects" data-testid="tab-projects">
                  {t("partners.tabs.projects")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <PartnerForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const vars: UpdatePartnerVars = {
                      title: values.title,
                      websiteUrl: values.websiteUrl || null,
                      // The slug field is read-only once published, so it is only
                      // sent while it is still editable AND actually changed.
                      ...(detail.slugEditable &&
                      values.slug &&
                      values.slug !== detail.slug
                        ? { slug: values.slug }
                        : {}),
                      ...(values.removeLogo && !values.logo
                        ? { mediaAction: "clear" as const }
                        : {}),
                      logo: values.logo,
                      version: detail.version,
                    };
                    update(
                      { resource: "partners", id: detail.id, values: vars },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "partners.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </TabsContent>

              {/* «Проекты» (012 EARS-10, 012-design §5.1) — the READ direction of
                  the same relation. Authoring stays on the project detail; here
                  the operator sees which проекты this partner is listed on and
                  where it is the основной партнёр. */}
              <TabsContent value="projects">
                <ProjectPartnersPanel mode="partner" entityId={detail.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
