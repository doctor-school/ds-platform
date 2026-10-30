"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { MaterialAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  MaterialForm,
  type MaterialFieldRefusals,
} from "@/components/material-form";
import { materialRefusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateMaterialVars } from "@/providers/data-provider";

/**
 * Create a material (048 EARS-1, EARS-19). A new material is always a draft;
 * on success the page routes to its detail, where every later write carries
 * the row's `If-Match`. A refusal renders the RU sentence its `errorCode` maps
 * to and marks the fields it addresses; nothing is created.
 *
 * An empty optional value is OMITTED rather than sent as `null`: on a create
 * there is nothing to clear.
 */
export default function CreateMaterialPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refused, setRefused] = useState<MaterialFieldRefusals>({
    fields: [],
    source: "write",
  });

  return (
    <Authenticated key="materials-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/materials" label={t("materials.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("materials.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <MaterialForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          refused={refused}
          onSubmit={(values) => {
            setErrorKey(null);
            setRefused({ fields: [], source: "write" });
            const vars: CreateMaterialVars = {
              kind: values.kind,
              title: values.title,
              ...(values.authorLine ? { authorLine: values.authorLine } : {}),
              ...(values.expertId ? { expertId: values.expertId } : {}),
              ...(values.partnerOrganisationId
                ? { partnerOrganisationId: values.partnerOrganisationId }
                : {}),
              body: values.body,
            };
            create(
              { resource: "materials", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as MaterialAdminDetail;
                  router.push(`/materials/${created.id}`);
                },
                onError: (error) => {
                  setRefused({
                    fields: materialRefusedFields(error),
                    source: "write",
                  });
                  setErrorKey(
                    taxonomyErrorKey(error, "materials.errors.createFailed"),
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
