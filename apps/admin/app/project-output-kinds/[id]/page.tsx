"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Authenticated, useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Link as DsLink } from "@ds/design-system";
import type {
  ProjectOutputKindAdminDetail,
  ProjectOutputKindAdminList,
  ProjectOutputKindStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ProjectOutputKindForm } from "@/components/project-output-kind-form";
import {
  outputKindHolders,
  refusedFields,
  taxonomyErrorKey,
} from "@/lib/taxonomy-errors";
import { projectOutputKindsUrl } from "@/providers/data-provider";

/**
 * One output kind (030 EARS-3): rename, retire, restore. The book has no
 * `GET :id` — its list is the whole book — so the page reads the kind off that
 * list; every write carries the row's version as `If-Match`, and the book is
 * refetched afterwards so the next write asserts the version the server holds.
 *
 * Retire and restore are plain commands: a retire withdraws nothing public, it
 * only stops offering the kind to new results. While a draft or published
 * project holds the kind the API refuses with `409 OUTPUT_KIND_IN_USE` and
 * names those projects — the page lists them as links, so the operator can
 * change their results and retry.
 */
export default function ProjectOutputKindDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result, query } = useCustom<ProjectOutputKindAdminList>({
    url: projectOutputKindsUrl.collection(),
    method: "get",
  });
  // Until the book arrives Refine hands back an EMPTY `{}` as `result.data`,
  // so the rows array is read defensively, as the list page does.
  const kind: ProjectOutputKindAdminDetail | undefined = (
    result.data?.data ?? []
  ).find((row) => row.id === id);
  const { mutate, mutation } = useCustomMutation();
  const { mutate: transition, mutation: transitioning } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  const [holders, setHolders] = useState<{ id: string; title: string }[]>([]);

  const statusLabels: Record<ProjectOutputKindStatus, string> = {
    active: t("projectOutputKinds.statuses.active"),
    retired: t("projectOutputKinds.statuses.retired"),
  };

  function reset() {
    setErrorKey(null);
    setRefused([]);
    setNoticeKey(null);
    setHolders([]);
  }

  return (
    <Authenticated key="project-output-kinds-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/project-output-kinds"
            label={t("projectOutputKinds.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !kind ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("projectOutputKinds.errors.notFound")}
          </Alert>
        ) : (
          <>
            <div
              className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              data-testid="output-kind-detail-header"
            >
              <h1
                className="min-w-0 break-words text-xl font-extrabold text-foreground"
                data-testid="output-kind-heading"
              >
                {kind.title}
              </h1>
              <Badge variant="label" data-testid="output-kind-status">
                {statusLabels[kind.status]}
              </Badge>
            </div>
            <p
              className="mb-4 text-sm text-muted-foreground"
              data-testid="output-kind-results"
            >
              {t("projectOutputKinds.results", { count: kind.resultCount })}
            </p>

            {errorKey ? (
              <Alert
                variant="danger"
                className="mb-4"
                data-testid="output-kind-error"
              >
                <p>{t(errorKey)}</p>
                {holders.length > 0 ? (
                  <ul
                    className="mt-2 flex list-disc flex-col gap-1 pl-5"
                    data-testid="output-kind-holders"
                  >
                    {holders.map((holder) => (
                      <li key={holder.id}>
                        <DsLink asChild variant="inline">
                          <Link href={`/projects/${holder.id}`}>
                            {holder.title}
                          </Link>
                        </DsLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Alert>
            ) : noticeKey ? (
              <Alert
                variant="success"
                className="mb-4"
                data-testid="output-kind-notice"
              >
                {t(noticeKey)}
              </Alert>
            ) : null}

            <ProjectOutputKindForm
              key={kind.version}
              detail={kind}
              submitLabel={t("common.save")}
              submitting={mutation.isPending}
              refused={refused}
              onSubmit={(values) => {
                reset();
                mutate(
                  {
                    url: projectOutputKindsUrl.row(kind.id),
                    method: "patch",
                    values,
                    meta: { version: kind.version },
                  },
                  {
                    onSuccess: () => {
                      setNoticeKey("projectOutputKinds.savedNotice");
                      void query.refetch();
                    },
                    onError: (error) => {
                      const fields = refusedFields(error);
                      setRefused(fields);
                      setErrorKey(
                        fields.includes("title")
                          ? null
                          : taxonomyErrorKey(
                              error,
                              "projectOutputKinds.errors.updateFailed",
                            ),
                      );
                    },
                  },
                );
              }}
            />

            <section
              className="mt-6 flex flex-col gap-3 border-2 border-hairline bg-card p-6"
              data-testid="output-kind-lifecycle"
            >
              <p className="text-sm text-muted-foreground">
                {kind.status === "active"
                  ? t("projectOutputKinds.lifecycle.retireHint")
                  : t("projectOutputKinds.lifecycle.retiredNote")}
              </p>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={transitioning.isPending}
                  loading={transitioning.isPending}
                  data-testid={
                    kind.status === "active"
                      ? "output-kind-retire"
                      : "output-kind-restore"
                  }
                  onClick={() => {
                    const verb =
                      kind.status === "active" ? "retire" : "restore";
                    reset();
                    transition(
                      {
                        url: projectOutputKindsUrl.transition(kind.id, verb),
                        method: "post",
                        // An empty object: a command POST with a JSON
                        // content-type and NO body is refused by Fastify.
                        values: {},
                        meta: { version: kind.version },
                      },
                      {
                        onSuccess: () => {
                          setNoticeKey(
                            verb === "retire"
                              ? "projectOutputKinds.lifecycle.retired"
                              : "projectOutputKinds.lifecycle.restored",
                          );
                          void query.refetch();
                        },
                        onError: (error) => {
                          setHolders(outputKindHolders(error));
                          setErrorKey(
                            taxonomyErrorKey(
                              error,
                              verb === "retire"
                                ? "projectOutputKinds.errors.retireFailed"
                                : "projectOutputKinds.errors.restoreFailed",
                            ),
                          );
                        },
                      },
                    );
                  }}
                >
                  {kind.status === "active"
                    ? t("projectOutputKinds.lifecycle.retire")
                    : t("projectOutputKinds.lifecycle.restore")}
                </Button>
              </div>
            </section>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}
