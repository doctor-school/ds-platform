"use client";

import { useParams } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CourseCompositionScreen } from "@ds/learning/admin";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  adminQueryClient,
  adminSessionQuery,
} from "@/lib/admin-session-cache";
import { learningAdminTransport } from "@/lib/learning-admin-transport";

/**
 * One course (024 EARS-28 / EARS-29 slice 1, #4011): its modules and lessons,
 * a new module or lesson, and the course's rule preset — the shared
 * `@ds/learning/admin` screen over this host's transport. The staff member's
 * roles (the one cached admin session read) decide whether the preset choice
 * is offered (024 EARS-30); the server still refuses a write they do not cover.
 */
export default function LearningCoursePage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const session = useQuery(adminSessionQuery, adminQueryClient);
  return (
    <Authenticated key={`learning-course-${id}`} redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList href="/learning" label={t("learning.backToList")} />
          <CourseCompositionScreen
            courseId={id}
            transport={learningAdminTransport}
            staffRoles={session.data?.roles ?? null}
            lessonHref={(lessonId) => `/learning/lessons/${lessonId}`}
            rulesHref={(kind, scopeId) => `/learning/rules/${kind}/${scopeId}`}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
