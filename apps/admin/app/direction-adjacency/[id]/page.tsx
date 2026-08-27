"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type {
  DirectionAdjacencyAdminDetail,
  RelationshipStatus,
  UpdateDirectionAdjacencyRequest,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { DirectionAdjacencyForm } from "@/components/direction-adjacency-form";
import { RelationLifecycleActions } from "@/components/relation-lifecycle-actions";
import { StatusChip } from "@/components/status-chip";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { directionAdjacencyUrl } from "@/providers/data-provider";
import {
  useDirectionAdjacencyKindLabel,
  useDirectionOptions,
} from "@/lib/direction-relation-options";

/**
 * The adjacency-edge detail (#1483; ADR-0016 §5). Unlike the specialty link this
 * screen DOES carry an edit form, because the edge carries an attribute of its own:
 * `kind` is re-labelled in place, on the same row, so the edge's history stays one
 * lineage. `weight` is not on this screen at all — it is a targeting-resolution
 * tuning parameter with a server default, not an editorial decision (017-design §9.3).
 *
 * The form is rendered only while the edge is ACTIVE. A retired edge answers a
 * PATCH with a 409 — an edit is not a way back into circulation, `restore` is — so
 * offering the boxes on a retired row would be inviting a refusal instead of
 * naming the one action that works.
 *
 * Every save carries the row's `version` as `If-Match` (via `meta.version`, which
 * the provider turns into the header) and the detail is refetched afterwards, so
 * the next edit asserts the version the SERVER holds rather than the one this page
 * first rendered from.
 */
export default function DirectionAdjacencyDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result, query } = useCustom<DirectionAdjacencyAdminDetail>({
    url: directionAdjacencyUrl.row(id),
    method: "get",
  });
  const detail = result.data;
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { directions } = useDirectionOptions();
  const kindLabel = useDirectionAdjacencyKindLabel();

  const statusLabels: Record<RelationshipStatus, string> = {
    active: t("directionAdjacency.statuses.active"),
    retired: t("directionAdjacency.statuses.retired"),
  };

  return (
    <Authenticated key="direction-adjacency-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/direction-adjacency"
            label={t("directionAdjacency.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("directionAdjacency.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="direction-adjacency-heading"
              >
                {detail.directionTitle} → {detail.adjacentDirectionTitle}
              </h1>
              <StatusChip
                status={detail.status}
                label={statusLabels[detail.status]}
                testId="direction-adjacency-status"
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
                {t("directionAdjacency.savedNotice")}
              </Alert>
            ) : null}

            {detail.status === "active" ? (
              <div className="mb-8">
                <DirectionAdjacencyForm
                  detail={detail}
                  directions={directions}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const payload: UpdateDirectionAdjacencyRequest = {
                      kind: values.kind,
                    };
                    mutate(
                      {
                        url: directionAdjacencyUrl.row(detail.id),
                        method: "patch",
                        values: payload,
                        meta: { version: detail.version },
                      },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "directionAdjacency.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </div>
            ) : (
              <dl className="mb-8 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t("directionAdjacency.columns.kind")}
                  </dt>
                  <dd
                    className="text-base font-semibold text-foreground"
                    data-testid="direction-adjacency-kind-value"
                  >
                    {kindLabel(detail.kind)}
                  </dd>
                </div>
              </dl>
            )}

            <RelationLifecycleActions
              namespace="directionAdjacency"
              status={detail.status}
              version={detail.version}
              urlFor={(transition) =>
                directionAdjacencyUrl.transition(detail.id, transition)
              }
              onTransition={() => {
                setSaved(false);
                void query.refetch();
              }}
            />
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
