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
import type { TopicAdminDetail, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { TopicForm } from "@/components/topic-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { UpdateTopicVars } from "@/providers/data-provider";

/**
 * Topic detail / edit (012 EARS-3) in the Stage-A composition-B tabbed layout
 * (#1282, owner pick 2026-08-17) — the same frame the project and expert details
 * use, so the four taxonomy entities read as one admin rather than four.
 * «Основное» is the only tab this slice ships: «Публикация» (#1287/#1295/#1296)
 * arrives with its own slice, and an empty placeholder tab is deliberately NOT
 * rendered.
 *
 * Every save carries the row's `version` as `If-Match`, and the detail is
 * refetched afterwards, so the next edit asserts the version the SERVER holds
 * rather than the one this page was first rendered from.
 *
 * The slug is sent only while it is still editable AND actually changed: `PATCH`
 * omission means «unchanged», and re-sending the identical slug of a row would
 * ask the server to re-validate an identity nobody touched.
 */
export default function TopicDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result: detail, query } = useOne<TopicAdminDetail>({
    resource: "topics",
    id,
  });
  const { mutate: update, mutation } = useUpdate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("topics.statuses.draft"),
    published: t("topics.statuses.published"),
    retired: t("topics.statuses.retired"),
  };

  return (
    <Authenticated key="topics-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/topics" label={t("topics.backToList")} />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("topics.errors.loadFailed")}
          </Alert>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <h1
                className="text-xl font-extrabold text-foreground"
                data-testid="topic-heading"
              >
                {detail.title}
              </h1>
              <Badge variant="label" data-testid="topic-status">
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
                {t("topics.savedNotice")}
              </Alert>
            ) : null}

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("topics.tabs.main")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="main">
                <TopicForm
                  detail={detail}
                  submitLabel={t("common.save")}
                  submitting={mutation.isPending}
                  onSubmit={(values) => {
                    setErrorKey(null);
                    setSaved(false);
                    const vars: UpdateTopicVars = {
                      title: values.title,
                      ...(detail.slugEditable &&
                      values.slug &&
                      values.slug !== detail.slug
                        ? { slug: values.slug }
                        : {}),
                      version: detail.version,
                    };
                    update(
                      { resource: "topics", id: detail.id, values: vars },
                      {
                        onSuccess: () => {
                          setSaved(true);
                          void query.refetch();
                        },
                        onError: (error) =>
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              "topics.errors.updateFailed",
                            ),
                          ),
                      },
                    );
                  }}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
