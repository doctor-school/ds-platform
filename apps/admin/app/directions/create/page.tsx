"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { DirectionAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { DirectionForm } from "@/components/direction-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateDirectionVars } from "@/providers/data-provider";

/**
 * Create a curated direction (012 EARS-3). The operator authors a `draft`; on
 * success the page routes to the direction's detail, where every later edit carries
 * the row's `If-Match`. A refusal renders the actionable RU sentence its stable
 * `errorCode` maps to — never a bare status.
 *
 * The body is the title and nothing else: «адрес страницы» is derived by the
 * API from that title (017-design §9.3), and `CreateDirectionRequestSchema` is
 * `.strict()`, so the canonical slugification and its uniqueness suffixing have
 * exactly one implementation and this page cannot opt out of it.
 */
export default function CreateDirectionPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="directions-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/directions" label={t("directions.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("directions.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <DirectionForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreateDirectionVars = { title: values.title };
            create(
              { resource: "directions", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as DirectionAdminDetail;
                  router.push(`/directions/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "directions.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
