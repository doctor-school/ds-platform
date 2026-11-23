"use client";

import { useParams } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RulesEditorScreen } from "@ds/learning/admin";
import { LEARNING_SCOPE_KINDS, type LearningScopeKind } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  adminQueryClient,
  adminSessionQuery,
} from "@/lib/admin-session-cache";
import { learningAdminTransport } from "@/lib/learning-admin-transport";

/**
 * The rules of one scope (024 EARS-29…31, #4012): platform, school, course,
 * module, lesson or step — the shared `@ds/learning/admin` editor over this
 * host's transport. The staff member's roles come from the one cached admin
 * session read; they only decide what is drawn (EARS-30 read-only), the
 * server still refuses a write the role does not cover.
 */
export default function LearningRulesPage() {
  const t = useTranslations();
  const params = useParams<{ scopeKind: string; scopeId: string }>();
  const kind = params?.scopeKind ?? "";
  const scopeId = params?.scopeId ?? "";
  const session = useQuery(adminSessionQuery, adminQueryClient);
  const known = (LEARNING_SCOPE_KINDS as readonly string[]).includes(kind);
  return (
    <Authenticated key={`learning-rules-${kind}-${scopeId}`} redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <BackToList href="/learning" label={t("learning.backToList")} />
          {known && session.isSuccess ? (
            <RulesEditorScreen
              scopeKind={kind as LearningScopeKind}
              scopeId={scopeId}
              transport={learningAdminTransport}
              staffRoles={session.data?.roles ?? []}
            />
          ) : null}
          {!known ? (
            <p className="text-sm text-muted-foreground">
              {t("learning.errors.unknownScope")}
            </p>
          ) : null}
        </div>
      </AppShell>
    </Authenticated>
  );
}
