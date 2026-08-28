"use client";

import { useParams } from "next/navigation";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type {
  DirectionSpecialtyAdminDetail,
  RelationshipStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { RelationLifecycleActions } from "@/components/relation-lifecycle-actions";
import { StatusChip } from "@/components/status-chip";
import { directionSpecialtiesUrl } from "@/providers/data-provider";

/**
 * The direction↔specialty link detail (#1483; ADR-0016 §5).
 *
 * It renders FACTS and one lifecycle action, and no edit form — deliberately. The
 * link carries no attribute of its own, so the API exposes no PATCH: re-pointing a
 * link is retiring this one and authoring another, which keeps each pair's audit
 * lineage single. A form offering an edit the server has no route for would be a
 * promise the platform cannot keep.
 */
export default function DirectionSpecialtyDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result, query } = useCustom<DirectionSpecialtyAdminDetail>({
    url: directionSpecialtiesUrl.row(id),
    method: "get",
  });
  const detail = result.data;

  const statusLabels: Record<RelationshipStatus, string> = {
    active: t("directionSpecialties.statuses.active"),
    retired: t("directionSpecialties.statuses.retired"),
  };

  return (
    <Authenticated key="direction-specialties-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/direction-specialties"
            label={t("directionSpecialties.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("directionSpecialties.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="direction-specialty-heading"
              >
                {t("directionSpecialties.detailTitle")}
              </h1>
              <StatusChip
                status={detail.status}
                label={statusLabels[detail.status]}
                testId="direction-specialty-status"
              />
            </div>

            <dl className="mb-8 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  {t("directionSpecialties.detail.direction")}
                </dt>
                <dd
                  className="text-base font-semibold text-foreground"
                  data-testid="direction-specialty-direction"
                >
                  {detail.directionTitle}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {t("directionSpecialties.detail.specialty")}
                </dt>
                <dd
                  className="text-base font-semibold text-foreground"
                  data-testid="direction-specialty-specialty"
                >
                  {detail.specialtyName} ({detail.specialtyCode})
                </dd>
              </div>
            </dl>

            <RelationLifecycleActions
              namespace="directionSpecialties"
              status={detail.status}
              version={detail.version}
              urlFor={(transition) =>
                directionSpecialtiesUrl.transition(detail.id, transition)
              }
              onTransition={() => void query.refetch()}
            />
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
