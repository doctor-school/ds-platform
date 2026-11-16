"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { FeedSourceForm } from "@/components/feed-source-form";
import {
  feedSourceAddressRefusal,
  feedSourceErrorKey,
} from "@/lib/feed-source-errors";
import { feedSourcesUrl } from "@/providers/data-provider";

/**
 * «Добавить источник» (048 EARS-21). The platform among the connected networks
 * (only «Telegram» in slice 2) and the channel address; on success the
 * operator returns to «Источники», where the new source is listed switched on
 * and «Не проверен» — the check that binds the channel and sets the status is
 * the Telegram connector's (#3994). A refused address is marked at the field
 * with the typed value kept; nothing is stored.
 */
export default function CreateFeedSourcePage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [addressRefusal, setAddressRefusal] = useState<string | null>(null);

  return (
    <Authenticated key="feed-sources-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/materials/sources"
            label={t("feedSources.backToList")}
          />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("feedSources.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <div className="border-2 border-hairline bg-card p-6">
          <FeedSourceForm
            mode="create"
            submitLabel={t("feedSources.createSubmit")}
            submitting={mutation.isPending}
            addressRefusal={addressRefusal}
            onSubmit={(values) => {
              setErrorKey(null);
              setAddressRefusal(null);
              mutate(
                {
                  url: feedSourcesUrl.collection(),
                  method: "post",
                  values,
                },
                {
                  onSuccess: () => router.push("/materials/sources"),
                  onError: (error) => {
                    const refusal = feedSourceAddressRefusal(error);
                    setAddressRefusal(refusal);
                    setErrorKey(
                      refusal
                        ? null
                        : feedSourceErrorKey(
                            error,
                            "feedSources.errors.createFailed",
                          ),
                    );
                  },
                },
              );
            }}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
