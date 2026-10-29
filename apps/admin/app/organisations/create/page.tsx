"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { OrganisationAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { OrganisationForm } from "@/components/organisation-form";
import { refusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateOrganisationVars } from "@/providers/data-provider";

/**
 * Create an organisation (032 EARS-1, EARS-2; 012 EARS-4 before it). The
 * operator authors a `draft`; on success the page routes to its detail, where
 * every later edit carries the row's `If-Match`. A refusal renders the RU
 * sentence its stable `errorCode` maps to, and marks the fields it addresses.
 *
 * An empty optional box is OMITTED rather than sent as `null`: on a create there
 * is nothing to clear.
 */
export default function CreateOrganisationPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);

  return (
    <Authenticated key="organisations-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/organisations"
            label={t("organisations.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("organisations.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <OrganisationForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          refused={refused}
          onSubmit={(values) => {
            setErrorKey(null);
            setRefused([]);
            const vars: CreateOrganisationVars = {
              title: values.title,
              ...(values.websiteUrl ? { websiteUrl: values.websiteUrl } : {}),
              ...(values.description
                ? { description: values.description }
                : {}),
              roleIds: values.roleIds,
              publicNameVisible: values.publicNameVisible,
              publicLogoVisible: values.publicLogoVisible,
              logo: values.logo,
            };
            create(
              { resource: "organisations", values: vars },
              {
                onSuccess: (data) => {
                  const created =
                    data.data as unknown as OrganisationAdminDetail;
                  router.push(`/organisations/${created.id}`);
                },
                onError: (error) => {
                  setRefused(refusedFields(error));
                  setErrorKey(
                    taxonomyErrorKey(
                      error,
                      "organisations.errors.createFailed",
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
