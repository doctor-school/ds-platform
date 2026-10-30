"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { OrganisationRoleForm } from "@/components/organisation-role-form";
import { refusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { organisationRolesUrl } from "@/providers/data-provider";

/**
 * «Добавить роль» (032 EARS-3). The write rides the provider's `custom` path,
 * which mints one Idempotency-Key per call and sends the CSRF proof. On success
 * the operator returns to the book, where the new role is listed — and offered
 * on every organisation form at once. A duplicate active title is marked on the
 * title field only — no second message above the form.
 */
export default function CreateOrganisationRolePage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);

  return (
    <Authenticated key="organisation-roles-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/organisation-roles"
            label={t("organisationRoles.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("organisationRoles.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <OrganisationRoleForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          refused={refused}
          onSubmit={(values) => {
            setErrorKey(null);
            setRefused([]);
            mutate(
              {
                url: organisationRolesUrl.collection(),
                method: "post",
                values,
              },
              {
                onSuccess: () => router.push("/organisation-roles"),
                onError: (error) => {
                  // A refusal addressed to the title is shown ON the field only
                  // (one message); the banner is for failures no field owns.
                  const fields = refusedFields(error);
                  setRefused(fields);
                  setErrorKey(
                    fields.includes("title")
                      ? null
                      : taxonomyErrorKey(
                          error,
                          "organisationRoles.errors.createFailed",
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
