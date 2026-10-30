"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge } from "@ds/design-system";
import type { MaterialAdminDetail, MaterialStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  MaterialForm,
  type MaterialFieldRefusals,
} from "@/components/material-form";
import { MaterialLifecycleActions } from "@/components/material-lifecycle-actions";
import { formatMaterialDate } from "@/lib/material-dates";
import { materialRefusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { UpdateMaterialVars } from "@/providers/data-provider";

const NO_REFUSALS: MaterialFieldRefusals = { fields: [], source: "write" };

/**
 * Material detail / edit (048 EARS-1, EARS-4…EARS-6, EARS-19). One full page:
 * the header with the status badge «Черновик» / «Опубликован» and the
 * first-publication date, the lifecycle commands, then the form.
 *
 * Every save carries the row's `version` as `If-Match` and the detail is
 * re-read afterwards (`key={detail.version}` remounts the form on the new
 * version). A stale save (`412`, `material-conflict`) shows the reload notice
 * of the 012 forms and stores nothing. An edit sends the
 * whole authored state: a cleared partner or author line is an explicit value,
 * since PATCH omission means «unchanged».
 */
export default function MaterialDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<MaterialAdminDetail>({
    resource: "materials",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refused, setRefused] = useState<MaterialFieldRefusals>(NO_REFUSALS);
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  const refetch = query.refetch;
  const reload = useCallback(() => {
    setSaved(false);
    void refetch();
  }, [refetch]);
  const onPublishRefused = useCallback((fields: string[]) => {
    setErrorKey(null);
    setSaved(false);
    setRefused(fields.length > 0 ? { fields, source: "publish" } : NO_REFUSALS);
  }, []);

  const statusLabels: Record<MaterialStatus, string> = {
    draft: t("materials.statuses.draft"),
    published: t("materials.statuses.published"),
  };

  return (
    <Authenticated key="materials-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/materials" label={t("materials.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("materials.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div
              className="mb-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              data-testid="material-detail-header"
            >
              <h1
                className="min-w-0 break-words text-xl font-extrabold text-foreground"
                data-testid="material-heading"
              >
                {detail.title}
              </h1>
              <Badge variant="label" data-testid="material-status">
                {statusLabels[detail.status]}
              </Badge>
            </div>
            <p
              className="mb-6 text-sm text-muted-foreground"
              data-testid="material-first-published"
            >
              {detail.firstPublishedAt
                ? t("materials.firstPublished", {
                    date: formatMaterialDate(detail.firstPublishedAt),
                  })
                : t("materials.neverPublished")}
            </p>

            <div className="mb-6">
              <MaterialLifecycleActions
                detail={detail}
                dirty={dirty}
                onChanged={reload}
                onPublishRefused={onPublishRefused}
              />
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
                {t("materials.savedNotice")}
              </Alert>
            ) : null}

            <MaterialForm
              key={detail.version}
              detail={detail}
              refused={refused}
              submitLabel={t("common.save")}
              submitting={mutation.isPending}
              onDirtyChange={onDirtyChange}
              onSubmit={(values) => {
                setErrorKey(null);
                setSaved(false);
                setRefused(NO_REFUSALS);
                const vars: UpdateMaterialVars = {
                  kind: values.kind,
                  title: values.title,
                  authorLine: values.authorLine,
                  expertId: values.expertId,
                  partnerOrganisationId: values.partnerOrganisationId,
                  body: values.body,
                  version: detail.version,
                };
                update(
                  { resource: "materials", id: detail.id, values: vars },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      void refetch();
                    },
                    onError: (error) => {
                      setRefused({
                        fields: materialRefusedFields(error),
                        source:
                          (error as { errorCode?: string }).errorCode ===
                          "PUBLISH_REQUIREMENTS_NOT_MET"
                            ? "publish"
                            : "write",
                      });
                      setErrorKey(
                        taxonomyErrorKey(
                          error,
                          "materials.errors.updateFailed",
                        ),
                      );
                    },
                  },
                );
              }}
            />
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
