"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Authenticated } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button, Input, Label } from "@ds/design-system";
import { FormActions, FormFieldGroup } from "@ds/design-system/blocks";
import type { LearningSchoolAdmin } from "@ds/schemas";
import { FIELD_LABEL } from "@ds/learning/admin";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { LearningRelationPicker } from "@/components/learning-relation-picker";
import { createLearningSchool } from "@/lib/learning-admin-transport";

interface Refusal {
  errorCode?: string;
  fieldErrors?: { path: string; message: string }[];
}

/**
 * «Новая школа» (023 EARS-26, #4018) — create a school through the 024 admin
 * API: its direction, leading expert, project, title and slug. A second school
 * of the same expert in the same direction is refused with a field error; a
 * taken slug is refused too. The new school is a draft and opens in its editor.
 */
export default function NewLearningSchoolPage() {
  const t = useTranslations();
  const router = useRouter();
  const [directionId, setDirectionId] = useState<string | null>(null);
  const [leadExpertId, setLeadExpertId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  function linesOf(error: unknown): string[] {
    const r = (error ?? {}) as Refusal;
    if (r.errorCode === "SLUG_CONFLICT")
      return [t("learning.schools.slugTaken")];
    const lines = (r.fieldErrors ?? []).map(({ path, message }) =>
      path === "leadExpertId" && r.errorCode === "VALIDATION_FAILED" &&
      /already leads/.test(message)
        ? t("learning.schools.expertTaken")
        : `${FIELD_LABEL[path] ?? path}: ${message}`,
    );
    return lines.length > 0 ? lines : [t("learning.schools.failed")];
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const missing = new Set<string>();
    if (!directionId) missing.add("directionId");
    if (!leadExpertId) missing.add("leadExpertId");
    if (!projectId) missing.add("projectId");
    setInvalid(missing);
    if (missing.size > 0) {
      setRefused(
        [...missing].map((p) => `${FIELD_LABEL[p] ?? p}: ${t("learning.schools.pick." + pickKey(p))}`),
      );
      return;
    }
    setBusy(true);
    setRefused(null);
    try {
      const school: LearningSchoolAdmin = await createLearningSchool({
        directionId: directionId!,
        leadExpertId: leadExpertId!,
        projectId: projectId!,
        title,
        slug,
      });
      router.push(`/learning/schools/${school.id}`);
    } catch (error) {
      const r = (error ?? {}) as Refusal;
      setInvalid(new Set((r.fieldErrors ?? []).map((e) => e.path)));
      setRefused(linesOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Authenticated key="learning-school-new" redirectOnFail="/login">
      <AppShell>
        <div className="flex max-w-3xl flex-col gap-6">
          <BackToList
            href="/learning/schools"
            label={t("learning.schools.backToList")}
          />
          <header className="flex flex-col gap-2">
            <h1 className="text-xl font-extrabold text-foreground">
              {t("learning.schools.newTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("learning.schools.newDescription")}
            </p>
          </header>
          {refused ? (
            <Alert variant="danger" data-testid="write-refusal">
              <p className="font-bold">{t("learning.schools.refused")}</p>
              <ul className="mt-1 list-disc pl-5">
                {refused.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-direction">
                {t("learning.schools.fields.direction")}
              </Label>
              <LearningRelationPicker
                id="school-direction"
                resource="directions"
                value={directionId}
                onChange={setDirectionId}
                placeholder={t("learning.schools.pick.direction")}
                invalid={invalid.has("directionId")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-expert">
                {t("learning.schools.fields.expert")}
              </Label>
              <LearningRelationPicker
                id="school-expert"
                resource="experts"
                value={leadExpertId}
                onChange={setLeadExpertId}
                placeholder={t("learning.schools.pick.expert")}
                invalid={invalid.has("leadExpertId")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-project">
                {t("learning.schools.fields.project")}
              </Label>
              <LearningRelationPicker
                id="school-project"
                resource="projects"
                value={projectId}
                onChange={setProjectId}
                placeholder={t("learning.schools.pick.project")}
                invalid={invalid.has("projectId")}
              />
            </div>
            <FormFieldGroup>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="school-new-title">
                  {t("learning.schools.fields.title")}
                </Label>
                <Input
                  id="school-new-title"
                  value={title}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="school-new-slug">
                  {t("learning.schools.fields.slug")}
                </Label>
                <Input
                  id="school-new-slug"
                  value={slug}
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  aria-invalid={invalid.has("slug") || undefined}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
            </FormFieldGroup>
            <FormActions>
              <Button type="submit" disabled={busy}>
                {t("learning.schools.submit")}
              </Button>
            </FormActions>
          </form>
        </div>
      </AppShell>
    </Authenticated>
  );
}

function pickKey(path: string): "direction" | "expert" | "project" {
  if (path === "leadExpertId") return "expert";
  if (path === "projectId") return "project";
  return "direction";
}
