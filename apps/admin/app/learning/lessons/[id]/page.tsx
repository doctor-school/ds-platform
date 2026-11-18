"use client";

import { useParams } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { STREAM_PROVIDERS, type StreamProvider } from "@ds/schemas";
import { LessonCompositionScreen } from "@ds/learning/admin";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { learningAdminTransport } from "@/lib/learning-admin-transport";

/**
 * One lesson's composition (024 EARS-28, #4011): steps of the catalog's types,
 * order, removal and publication — the shared `@ds/learning/admin` screen over
 * this host's transport. Provider names reuse the event broadcast labels.
 */
export default function LearningLessonPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const providerLabels = Object.fromEntries(
    STREAM_PROVIDERS.map((provider) => [
      provider,
      t(`events.providers.${provider}`),
    ]),
  ) as Record<StreamProvider, string>;
  return (
    <Authenticated key={`learning-lesson-${id}`} redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList href="/learning" label={t("learning.backToList")} />
          <LessonCompositionScreen
            lessonId={id}
            transport={learningAdminTransport}
            providerLabels={providerLabels}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
