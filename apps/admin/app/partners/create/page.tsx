"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { PartnerAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { PartnerForm } from "@/components/partner-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreatePartnerVars } from "@/providers/data-provider";

/**
 * Create a partner (012 EARS-4). The operator authors a `draft`; on success the
 * page routes to the partner's detail, where every later edit carries the row's
 * `If-Match`. A refusal is rendered with the actionable RU sentence its stable
 * `errorCode` maps to — never a bare status.
 *
 * An empty optional box is OMITTED rather than sent as `null`: on a create there
 * is nothing to clear, and `null` would claim the operator made a decision about
 * a field they simply have not filled in yet.
 */
export default function CreatePartnerPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="partners-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/partners" label={t("partners.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("partners.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <PartnerForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreatePartnerVars = {
              title: values.title,
              ...(values.websiteUrl ? { websiteUrl: values.websiteUrl } : {}),
              logo: values.logo,
            };
            create(
              { resource: "partners", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as PartnerAdminDetail;
                  router.push(`/partners/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "partners.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
