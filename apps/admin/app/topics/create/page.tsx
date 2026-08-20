"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticated, useCreate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { TopicAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { TopicForm } from "@/components/topic-form";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { CreateTopicVars } from "@/providers/data-provider";

/**
 * Create a curated topic (012 EARS-3). The operator authors a `draft`; on
 * success the page routes to the topic's detail, where every later edit carries
 * the row's `If-Match`. A refusal renders the actionable RU sentence its stable
 * `errorCode` maps to — never a bare status.
 *
 * An empty slug box is OMITTED rather than sent as `""`: an empty box means
 * «сгенерируй адрес», and that decision belongs to the API, which owns the
 * canonical slugification and the uniqueness check.
 */
export default function CreateTopicPage() {
  const t = useTranslations();
  const router = useRouter();
  const { mutate: create, mutation } = useCreate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <Authenticated key="topics-create" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList href="/topics" label={t("topics.backToList")} />
        </div>
        <h1 className="mb-6 text-xl font-extrabold text-foreground">
          {t("topics.createTitle")}
        </h1>
        {errorKey ? (
          <Alert variant="danger" className="mb-4" data-testid="create-error">
            {t(errorKey)}
          </Alert>
        ) : null}
        <TopicForm
          submitLabel={t("common.save")}
          submitting={mutation.isPending}
          onSubmit={(values) => {
            setErrorKey(null);
            const vars: CreateTopicVars = {
              title: values.title,
              ...(values.slug ? { slug: values.slug } : {}),
            };
            create(
              { resource: "topics", values: vars },
              {
                onSuccess: (data) => {
                  const created = data.data as unknown as TopicAdminDetail;
                  router.push(`/topics/${created.id}`);
                },
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(error, "topics.errors.createFailed"),
                  ),
              },
            );
          }}
        />
      </AppShell>
    </Authenticated>
  );
}
