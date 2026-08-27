"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type {
  CreateDirectionSpecialtyRequest,
  DirectionSpecialtyAdminDetail,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { DirectionSpecialtyForm } from "@/components/direction-specialty-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { directionSpecialtiesUrl } from "@/providers/data-provider";
import { useDirectionRelationOptions } from "@/lib/direction-relation-options";

/**
 * Author one direction↔specialty link (#1483; ADR-0016 §5). The write rides the
 * provider's `custom` path rather than a Refine `create`, because that is where the
 * Idempotency-Key this route requires is generated — one fresh key per CALL, so a
 * double submit replays the first answer instead of authoring a second link.
 *
 * On success the page routes to the link's detail, which is the only screen that
 * can retire it. A refusal renders the actionable RU sentence its stable
 * `errorCode` maps to — «такая связь уже заведена» for the duplicate-pair conflict,
 * never a bare status.
 */
export default function CreateDirectionSpecialtyPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { directions, specialties } = useDirectionRelationOptions();

  return (
    <Authenticated key="direction-specialties-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/direction-specialties"
            label={t("directionSpecialties.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("directionSpecialties.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <DirectionSpecialtyForm
          directions={directions}
          specialties={specialties}
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const payload: CreateDirectionSpecialtyRequest = {
              directionId: values.directionId,
              specialtyMinzdravId: values.specialtyMinzdravId,
            };
            mutate(
              {
                url: directionSpecialtiesUrl.collection(),
                method: "post",
                values: payload,
              },
              {
                onSuccess: (data) => {
                  const created =
                    data.data as unknown as DirectionSpecialtyAdminDetail;
                  router.push(`/direction-specialties/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(
                      error,
                      "directionSpecialties.errors.createFailed",
                    ),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
