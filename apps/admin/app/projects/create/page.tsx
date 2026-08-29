"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { ProjectAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ProjectForm } from "@/components/project-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateProjectVars } from "@/providers/data-provider";

/**
 * Create a project (012 EARS-1). The operator authors a `draft`; on success the
 * page routes to the project's detail, where every later edit carries the row's
 * `If-Match`. A refusal is rendered with the actionable RU sentence its stable
 * `errorCode` maps to — never a bare status.
 */
export default function CreateProjectPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="projects-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/projects" label={t("projects.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("projects.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <ProjectForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreateProjectVars = {
              kind: values.kind,
              title: values.title,
              description: values.description,
              cover: values.cover,
            };
            create(
              { resource: "projects", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as ProjectAdminDetail;
                  router.push(`/projects/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "projects.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
