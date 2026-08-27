"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type {
  CreateDirectionAdjacencyRequest,
  DirectionAdjacencyAdminDetail,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { DirectionAdjacencyForm } from "@/components/direction-adjacency-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { directionAdjacencyUrl } from "@/providers/data-provider";
import { useDirectionOptions } from "@/lib/direction-relation-options";

/**
 * Author one DIRECTED adjacency edge (#1483; ADR-0016 §5). The write rides the
 * provider's `custom` path, which owns the Idempotency-Key this route requires.
 *
 * There is no specialty book on this screen: both ends of an adjacency edge are
 * directions, and the closed Минздрав nomenclature has nothing to do with it.
 */
export default function CreateDirectionAdjacencyPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { directions } = useDirectionOptions();

  return (
    <Authenticated key="direction-adjacency-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/direction-adjacency"
            label={t("directionAdjacency.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("directionAdjacency.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <DirectionAdjacencyForm
          directions={directions}
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const payload: CreateDirectionAdjacencyRequest = {
              directionId: values.directionId,
              adjacentDirectionId: values.adjacentDirectionId,
              kind: values.kind,
              weight: values.weight,
            };
            mutate(
              {
                url: directionAdjacencyUrl.collection(),
                method: "post",
                values: payload,
              },
              {
                onSuccess: (data) => {
                  const created =
                    data.data as unknown as DirectionAdjacencyAdminDetail;
                  router.push(`/direction-adjacency/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(
                      error,
                      "directionAdjacency.errors.createFailed",
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
