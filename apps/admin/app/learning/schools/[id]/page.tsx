"use client";

import { useParams } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { SchoolEditorScreen } from "@ds/learning/admin";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { learningAdminTransport } from "@/lib/learning-admin-transport";

/**
 * One school (023 EARS-26, EARS-27, #4018): its EARS-1 data, publish /
 * unpublish, the doctors waiting for it (a count) and its courses in school
 * order — the shared `@ds/learning/admin` school editor over this host's
 * transport.
 */
export default function LearningSchoolPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return (
    <Authenticated key={`learning-school-${id}`} redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList
            href="/learning/schools"
            label={t("learning.schools.backToList")}
          />
          <SchoolEditorScreen
            schoolId={id}
            transport={learningAdminTransport}
            courseHref={(courseId) => `/learning/courses/${courseId}`}
            rulesHref={(kind, scopeId) => `/learning/rules/${kind}/${scopeId}`}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
