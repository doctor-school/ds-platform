"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { ExpertAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { ExpertForm } from "@/components/expert-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateExpertVars } from "@/providers/data-provider";

/**
 * Create an expert (012 EARS-2). The operator authors a `draft`; on success the
 * page routes to the expert's detail, where every later edit carries the row's
 * `If-Match`. A refusal is rendered with the actionable RU sentence its stable
 * `errorCode` maps to — never a bare status.
 *
 * An empty optional box is OMITTED rather than sent as `null`: on a create there
 * is nothing to clear, and `null` would claim the operator made a decision about
 * a field they simply have not filled in yet.
 */
export default function CreateExpertPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="experts-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/experts" label={t("experts.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("experts.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <ExpertForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreateExpertVars = {
              name: values.name,
              ...(values.professionalRole
                ? { professionalRole: values.professionalRole }
                : {}),
              ...(values.credentials
                ? { credentials: values.credentials }
                : {}),
              ...(values.affiliation
                ? { affiliation: values.affiliation }
                : {}),
              ...(values.bio ? { bio: values.bio } : {}),
              // An empty box means "generate it" — the API owns that decision, so
              // the field is omitted rather than sent as "".
              ...(values.slug ? { slug: values.slug } : {}),
              photo: values.photo,
            };
            create(
              { resource: "experts", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as ExpertAdminDetail;
                  router.push(`/experts/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "experts.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
