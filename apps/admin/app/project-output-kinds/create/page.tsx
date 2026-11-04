"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ProjectOutputKindForm } from "@/components/project-output-kind-form";
import { refusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { projectOutputKindsUrl } from "@/providers/data-provider";

/**
 * «Добавить вид» (030 EARS-3). The write rides the provider's `custom` path,
 * which mints one Idempotency-Key per call and sends the CSRF proof. On success
 * the operator returns to the book, where the new kind is listed — and offered
 * on every results editor at once. A duplicate active title is marked on the
 * title field only.
 */
export default function CreateProjectOutputKindPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);

  return (
    <Authenticated key="project-output-kinds-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/project-output-kinds"
            label={t("projectOutputKinds.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("projectOutputKinds.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <ProjectOutputKindForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          refused={refused}
          onSubmit={(values) => {
            setErrorKey(null);
            setRefused([]);
            mutate(
              {
                url: projectOutputKindsUrl.collection(),
                method: "post",
                values,
              },
              {
                onSuccess: () => router.push("/project-output-kinds"),
                onError: (error) => {
                  const fields = refusedFields(error);
                  setRefused(fields);
                  setErrorKey(
                    fields.includes("title")
                      ? null
                      : taxonomyErrorKey(
                          error,
                          "projectOutputKinds.errors.createFailed",
                        ),
                  );
                },
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
