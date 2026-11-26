"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  Link,
  Skeleton,
  Textarea,
} from "@ds/design-system";
import { FormActions, FormFieldGroup } from "@ds/design-system/blocks";
import {
  LEARNING_SCHOOL_FACTS_MAX,
  type LearningCourseAdmin,
  type LearningSchoolAdminDetail,
  type LearningSchoolFact,
  type LearningScopeKind,
  type UpdateLearningSchoolRequest,
} from "@ds/schemas";

import {
  ADMIN_COPY as C,
  RULES_COPY as R,
  STRUCTURE_COPY as S,
} from "./admin-copy";
import { isStale, structureRefusalLines } from "./refusals";
import type { LearningAdminTransport } from "./transport";

// 023 EARS-26, EARS-27 (#4018) — the school editor (023-design §1 `./admin`
// `SchoolEditor`): the school's EARS-1 data (title, description, up to four
// «О школе» facts, the «скоро» note, the community link, the mentoring and
// internship offers), publish / unpublish, the number of doctors waiting for
// the school (EARS-7, a count only), and the school's courses in school order
// with «Выше / Ниже» and a new course placed last. Every write carries the
// version the screen rendered from (EARS-28); the host transport adds the
// admin session, CSRF and the idempotency key. The school's mentoring requests
// and `school.mentoringEligibility` land with the mentoring slice (023-design
// §10 slice 6).

export interface SchoolEditorScreenProps {
  schoolId: string;
  transport: LearningAdminTransport;
  courseHref: (courseId: string) => string;
  /** EARS-29 — the rules editor of a scope, when the host has one. */
  rulesHref?: (scopeKind: LearningScopeKind, scopeId: string) => string;
}

interface DetailsDraft {
  title: string;
  description: string;
  facts: LearningSchoolFact[];
  soonNote: string;
  communityUrl: string;
  mentoringOffer: string;
  internshipOffer: string;
}

function draftOf(school: LearningSchoolAdminDetail): DetailsDraft {
  return {
    title: school.title,
    description: school.description,
    facts: school.facts.map((f) => ({ ...f })),
    soonNote: school.soonNote ?? "",
    communityUrl: school.communityUrl ?? "",
    mentoringOffer: school.mentoringOffer ?? "",
    internshipOffer: school.internshipOffer ?? "",
  };
}

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

function requestOf(d: DetailsDraft): UpdateLearningSchoolRequest {
  return {
    title: d.title,
    description: d.description,
    facts: d.facts,
    soonNote: orNull(d.soonNote),
    communityUrl: orNull(d.communityUrl),
    mentoringOffer: orNull(d.mentoringOffer),
    internshipOffer: orNull(d.internshipOffer),
  };
}

export function SchoolEditorScreen({
  schoolId,
  transport,
  courseHref,
  rulesHref,
}: SchoolEditorScreenProps) {
  const [school, setSchool] = useState<LearningSchoolAdminDetail | null>(null);
  const [courses, setCourses] = useState<LearningCourseAdmin[]>([]);
  const [draft, setDraft] = useState<DetailsDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseSlug, setCourseSlug] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        transport.school(schoolId),
        transport.schoolCourses(schoolId),
      ]);
      setSchool(s);
      setDraft(draftOf(s));
      setCourses(c);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [schoolId, transport]);

  useEffect(() => {
    void load();
  }, [load]);

  async function write(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setRefused(null);
    setSaved(false);
    try {
      await run();
      await load();
      return true;
    } catch (error) {
      const lines = structureRefusalLines(error);
      setRefused(lines.length > 0 ? lines : [C.failed]);
      if (isStale(error)) await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed)
    return (
      <Alert variant="danger" data-testid="school-load-error">
        {C.loadFailed}{" "}
        <Button variant="link" onClick={() => void load()}>
          {C.retry}
        </Button>
      </Alert>
    );
  if (!school || !draft)
    return (
      <div
        aria-busy="true"
        aria-label={C.loading}
        className="flex flex-col gap-3"
      >
        <div className="h-8 w-2/3">
          <Skeleton className="h-full w-full" />
        </div>
        <div className="h-24 w-full">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );

  const published = school.state === "published";
  const set = (patch: Partial<DetailsDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const setFact = (i: number, patch: Partial<LearningSchoolFact>) =>
    set({
      facts: draft.facts.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    });

  function move(index: number, by: -1 | 1) {
    const ids = courses.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void write(() => transport.reorderCourses(school!.id, ids, school!.version));
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    if (
      await write(() =>
        transport.updateSchool(school!.id, requestOf(draft!), school!.version),
      )
    )
      setSaved(true);
  }

  async function addCourse(event: FormEvent) {
    event.preventDefault();
    if (
      await write(() =>
        transport.createCourse({
          schoolId: school!.id,
          projectId: school!.projectId,
          title: courseTitle,
          slug: courseSlug,
        }),
      )
    ) {
      setCourseTitle("");
      setCourseSlug("");
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="school-editor">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <h1 className="min-w-0 break-words text-xl font-extrabold text-foreground">
          {school.title}
        </h1>
        <Badge
          variant={published ? "success" : "label"}
          data-testid="school-state"
        >
          {S.schoolState[school.state]}
        </Badge>
        <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
          {rulesHref ? (
            <Link href={rulesHref("school", school.id)} variant="standalone">
              {R.heading("school")}
            </Link>
          ) : null}
          <Button
            variant={published ? "outline" : "default"}
            disabled={busy}
            onClick={() =>
              void write(() =>
                published
                  ? transport.unpublishSchool(school.id, school.version)
                  : transport.publishSchool(school.id, school.version),
              )
            }
          >
            {published ? S.unpublishSchool : S.publishSchool}
          </Button>
        </div>
      </header>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>{published ? S.schoolPublishedHint : S.schoolDraftHint}</p>
        <p data-testid="school-interest-count">
          {S.interestCount(school.activeInterestCount)}
        </p>
      </div>

      {refused ? (
        <Alert variant="danger" data-testid="write-refusal">
          <p className="font-bold">{C.writeRefused}</p>
          <ul className="mt-1 list-disc pl-5">
            {refused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {saved ? (
        <Alert variant="success" data-testid="write-saved">
          {S.saved}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold text-foreground">
            {S.detailsHeading}
          </h2>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={saveDetails}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-title">{S.schoolTitle}</Label>
              <Input
                id="school-title"
                value={draft.title}
                required
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-description">{S.schoolDescription}</Label>
              <Textarea
                id="school-description"
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-bold text-foreground">
                {S.factsLegend}
              </legend>
              {draft.facts.map((fact, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                  <FormFieldGroup>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`school-fact-${i}-label`}>
                        {S.factLabel(i + 1)}
                      </Label>
                      <Input
                        id={`school-fact-${i}-label`}
                        value={fact.label}
                        required
                        onChange={(e) => setFact(i, { label: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`school-fact-${i}-text`}>
                        {S.factText(i + 1)}
                      </Label>
                      <Input
                        id={`school-fact-${i}-text`}
                        value={fact.text}
                        required
                        onChange={(e) => setFact(i, { text: e.target.value })}
                      />
                    </div>
                  </FormFieldGroup>
                  <Button
                    type="button"
                    size="field"
                    variant="outline"
                    aria-label={S.removeFact(i + 1)}
                    onClick={() =>
                      set({ facts: draft.facts.filter((_, j) => j !== i) })
                    }
                  >
                    {C.remove}
                  </Button>
                </div>
              ))}
              {draft.facts.length < LEARNING_SCHOOL_FACTS_MAX ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      set({ facts: [...draft.facts, { label: "", text: "" }] })
                    }
                  >
                    {S.addFact}
                  </Button>
                </div>
              ) : null}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-soon-note">{S.soonNote}</Label>
              <Input
                id="school-soon-note"
                value={draft.soonNote}
                aria-describedby="school-soon-note-hint"
                onChange={(e) => set({ soonNote: e.target.value })}
              />
              <p
                id="school-soon-note-hint"
                className="text-sm text-muted-foreground"
              >
                {S.soonNoteHint}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-community-url">{S.communityUrl}</Label>
              <Input
                id="school-community-url"
                type="url"
                inputMode="url"
                value={draft.communityUrl}
                onChange={(e) => set({ communityUrl: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-mentoring">{S.mentoringOffer}</Label>
              <Textarea
                id="school-mentoring"
                value={draft.mentoringOffer}
                onChange={(e) => set({ mentoringOffer: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-internship">{S.internshipOffer}</Label>
              <Textarea
                id="school-internship"
                value={draft.internshipOffer}
                onChange={(e) => set({ internshipOffer: e.target.value })}
              />
            </div>
            <FormActions>
              <Button type="submit" disabled={busy}>
                {S.save}
              </Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>

      <section
        aria-labelledby="school-courses-heading"
        className="flex flex-col gap-4"
      >
        <h2
          id="school-courses-heading"
          className="text-lg font-bold text-foreground"
        >
          {S.coursesHeading}
        </h2>
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{S.noCourses}</p>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="school-courses">
            {courses.map((course, i) => (
              <li
                key={course.id}
                className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row sm:items-center"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <Link href={courseHref(course.id)} variant="standalone">
                    {course.title}
                  </Link>
                  <Badge
                    variant={course.state === "published" ? "success" : "label"}
                  >
                    {S.courseState[course.state]}
                  </Badge>
                </span>
                <span className="flex gap-2">
                  {i > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={S.courseUp(course.title)}
                      onClick={() => move(i, -1)}
                    >
                      {C.up}
                    </Button>
                  ) : null}
                  {i < courses.length - 1 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={S.courseDown(course.title)}
                      onClick={() => move(i, 1)}
                    >
                      {C.down}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        <form
          className="flex flex-col gap-3 border-t border-border pt-4"
          onSubmit={addCourse}
          aria-label={S.newCourseHeading}
        >
          <h3 className="text-base font-bold text-foreground">
            {S.newCourseHeading}
          </h3>
          <FormFieldGroup>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-course-title">{S.courseTitle}</Label>
              <Input
                id="new-course-title"
                value={courseTitle}
                required
                onChange={(e) => setCourseTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-course-slug">{S.courseSlug}</Label>
              <Input
                id="new-course-slug"
                value={courseSlug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(e) => setCourseSlug(e.target.value)}
              />
            </div>
          </FormFieldGroup>
          <FormActions>
            <Button type="submit" variant="outline" disabled={busy}>
              {S.addCourse}
            </Button>
          </FormActions>
        </form>
      </section>
    </div>
  );
}
