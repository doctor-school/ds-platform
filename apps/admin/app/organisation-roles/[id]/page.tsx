"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge } from "@ds/design-system";
import type {
  OrganisationRoleAdminDetail,
  OrganisationRoleAdminList,
  OrganisationRoleStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { OrganisationRoleForm } from "@/components/organisation-role-form";
import { refusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { organisationRolesUrl } from "@/providers/data-provider";

/**
 * Rename a role (032 EARS-3). The book has no `GET :id` — its list is the whole
 * book — so the page reads the role off that list and renames it with
 * `PATCH :id` carrying the row's version as `If-Match`; the book is refetched
 * afterwards so the next rename asserts the version the server now holds. The
 * id and slug never change: every organisation holding the role shows the new
 * title at once.
 */
export default function OrganisationRoleDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result, query } = useCustom<OrganisationRoleAdminList>({
    url: organisationRolesUrl.collection(),
    method: "get",
  });
  // Until the book arrives Refine hands back an EMPTY `{}` as `result.data`
  // (not `undefined`), so the rows array is absent — read it defensively, as
  // the list page does, or the page throws before its loading branch renders.
  const role: OrganisationRoleAdminDetail | undefined = (
    result.data?.data ?? []
  ).find((row) => row.id === id);
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const statusLabels: Record<OrganisationRoleStatus, string> = {
    active: t("organisationRoles.statuses.active"),
    retired: t("organisationRoles.statuses.retired"),
  };

  return (
    <Authenticated key="organisation-roles-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/organisation-roles"
            label={t("organisationRoles.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !role ? (
          <Alert variant="danger" data-testid="detail-error">
            {t("organisationRoles.errors.notFound")}
          </Alert>
        ) : (
          <>
            <div
              className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              data-testid="organisation-role-detail-header"
            >
              <h1
                className="min-w-0 break-words text-xl font-extrabold text-foreground"
                data-testid="organisation-role-heading"
              >
                {role.title}
              </h1>
              <Badge variant="label" data-testid="organisation-role-status">
                {statusLabels[role.status]}
              </Badge>
            </div>
            <p
              className="mb-4 text-sm text-muted-foreground"
              data-testid="organisation-role-holders"
            >
              {t("organisationRoles.holders", {
                count: role.organisationCount,
              })}
            </p>

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
                {t("organisationRoles.savedNotice")}
              </Alert>
            ) : null}

            <OrganisationRoleForm
              key={role.version}
              detail={role}
              submitLabel={t("common.save")}
              submitting={mutation.isPending}
              refused={refused}
              onSubmit={(values) => {
                setErrorKey(null);
                setRefused([]);
                setSaved(false);
                mutate(
                  {
                    url: organisationRolesUrl.row(role.id),
                    method: "patch",
                    values,
                    meta: { version: role.version },
                  },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      void query.refetch();
                    },
                    onError: (error) => {
                      setRefused(refusedFields(error));
                      setErrorKey(
                        taxonomyErrorKey(
                          error,
                          "organisationRoles.errors.updateFailed",
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
