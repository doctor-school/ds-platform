"use client";

import { useParams } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { CourseCompositionScreen } from "@ds/learning/admin";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { learningAdminTransport } from "@/lib/learning-admin-transport";

/**
 * One course (024 EARS-28 / EARS-29 slice 1, #4011): its modules and lessons,
 * a new module or lesson, and the course's rule preset — the shared
 * `@ds/learning/admin` screen over this host's transport.
 */
export default function LearningCoursePage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return (
    <Authenticated key={`learning-course-${id}`} redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList href="/learning" label={t("learning.backToList")} />
          <CourseCompositionScreen
            courseId={id}
            transport={learningAdminTransport}
            lessonHref={(lessonId) => `/learning/lessons/${lessonId}`}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
