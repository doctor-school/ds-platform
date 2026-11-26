"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  Radio,
  Skeleton,
  Textarea,
} from "@ds/design-system";
import { FormActions, FormFieldGroup } from "@ds/design-system/blocks";
import type {
  LearningCourseComposition,
  LearningDocumentKind,
  LearningScopeKind,
  UpdateLearningCourseRequest,
} from "@ds/schemas";

import {
  ADMIN_COPY as C,
  LESSON_STATE_LABEL,
  RULES_COPY as R,
  STRUCTURE_COPY as S,
} from "./admin-copy";
import { PresetPanel } from "./preset-panel";
import { isStale, structureRefusalLines } from "./refusals";
import type { LearningAdminTransport } from "./transport";

// 024 EARS-28 — the way to a module's lessons: the course's modules and lessons,
// a new module and a new lesson (title, description, teaser; the lesson takes
// the course's project). Schools and courses are created and edited in the
// 023 structure editor (the school editor and this screen). EARS-29 slice 1 —
// the course's preset choice (`PresetPanel`). 023 EARS-27 (#4018) — the course
// structure editor (023-design §1 `CourseStructureEditor`): the course's
// EARS-1 data, publish / unpublish (an empty course is refused by the server,
// `409 PUBLISH_REQUIREMENTS_NOT_MET`), a module's rename and the module order.
// The module's club and reward are 023's next slice (EARS-1 club, EARS-2, #4282).

export interface CourseCompositionScreenProps {
  courseId: string;
  transport: LearningAdminTransport;
  lessonHref: (lessonId: string) => string;
  /** EARS-30 — the signed-in staff member's roles (the admin session read); null while it loads. */
  staffRoles: readonly string[] | null;
  /** EARS-29 — the rules editor of a scope, when the host has one. */
  rulesHref?: (scopeKind: LearningScopeKind, scopeId: string) => string;
  /** 023 EARS-27 — the course's school editor, when the host has one. */
  schoolHref?: (schoolId: string) => string;
  /**
   * 023 EARS-22 — the host's picker of a 032 partner organisation (its own
   * server-backed selector); absent, the course's partner is left as it is.
   */
  partnerField?: (props: {
    id: string;
    value: string | null;
    onChange: (value: string | null) => void;
  }) => ReactNode;
}

export function CourseCompositionScreen({
  courseId,
  transport,
  lessonHref,
  staffRoles,
  rulesHref,
  schoolHref,
  partnerField,
}: CourseCompositionScreenProps) {
  const [course, setCourse] = useState<LearningCourseComposition | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");

  const load = useCallback(async () => {
    try {
      setCourse(await transport.course(courseId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [courseId, transport]);

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
      <Alert variant="danger" data-testid="course-load-error">
        {C.loadFailed}{" "}
        <Button variant="link" onClick={() => void load()}>
          {C.retry}
        </Button>
      </Alert>
    );
  if (!course)
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

  const published = course.state === "published";
  function moveModule(index: number, by: -1 | 1) {
    const ids = course!.modules.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void write(() =>
      transport.reorderModules(course!.id, ids, course!.version),
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="course-composition">
      {schoolHref ? (
        <div>
          <Link href={schoolHref(course.schoolId)} variant="standalone">
            {S.toSchool}
          </Link>
        </div>
      ) : null}
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <h1 className="min-w-0 break-words text-xl font-extrabold text-foreground">
          {course.title}
        </h1>
        <Badge
          variant={published ? "success" : "label"}
          data-testid="course-state"
        >
          {LESSON_STATE_LABEL[course.state]}
        </Badge>
        <Button
          variant={published ? "outline" : "default"}
          disabled={busy}
          onClick={() =>
            void write(() =>
              published
                ? transport.unpublishCourse(course.id, course.version)
                : transport.publishCourse(course.id, course.version),
            )
          }
        >
          {published ? S.unpublishCourse : S.publishCourse}
        </Button>
        {rulesHref ? (
          <div className="flex flex-wrap gap-4 sm:ml-auto">
            <Link href={rulesHref("course", course.id)} variant="standalone">
              {R.heading("course")}
            </Link>
            <Link
              href={rulesHref("school", course.schoolId)}
              variant="standalone"
            >
              {R.heading("school")}
            </Link>
          </div>
        ) : null}
      </header>

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

      <CourseDetailsForm
        // Re-seed only when the course's own data change (a save, or a
        // colleague's edit read after a 412) — a module reorder or a publish
        // bumps the version but keeps unsaved edits; the save reads the
        // current version from here, so it always carries a fresh ETag.
        key={detailsKey(course)}
        course={course}
        busy={busy}
        partnerField={partnerField}
        onSave={async (body) => {
          const ok = await write(() =>
            transport.updateCourse(course.id, body, course.version),
          );
          if (ok) setSaved(true);
          return ok;
        }}
      />

      <PresetPanel
        scopeKind="course"
        scopeId={course.id}
        transport={transport}
        staffRoles={staffRoles}
      />

      <section
        aria-labelledby="course-modules-heading"
        className="flex flex-col gap-4"
      >
        <h2
          id="course-modules-heading"
          className="text-lg font-bold text-foreground"
        >
          {C.modulesHeading}
        </h2>
        {course.modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{C.noModules}</p>
        ) : null}
        {course.modules.map((module, mi) => (
          <Card key={module.id} data-testid={`module-${mi + 1}`}>
            <CardHeader>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-bold text-foreground">
                  {C.moduleHeading(mi + 1, module.title)}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {mi > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={S.moduleUp(mi + 1)}
                      onClick={() => moveModule(mi, -1)}
                    >
                      {C.up}
                    </Button>
                  ) : null}
                  {mi < course.modules.length - 1 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={S.moduleDown(mi + 1)}
                      onClick={() => moveModule(mi, 1)}
                    >
                      {C.down}
                    </Button>
                  ) : null}
                  {rulesHref ? (
                    <Link
                      href={rulesHref("module", module.id)}
                      variant="standalone"
                    >
                      {R.heading("module")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <ModuleRenameForm
                  key={`${module.id}-${module.version}`}
                  no={mi + 1}
                  moduleId={module.id}
                  title={module.title}
                  busy={busy}
                  onRename={(title) =>
                    write(() =>
                      transport.updateModule(
                        module.id,
                        { title },
                        module.version,
                      ),
                    )
                  }
                />
                {module.lessons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{C.noLessons}</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {module.lessons.map((lesson, li) => (
                      <li key={lesson.id} className="flex flex-col gap-0.5">
                        <Link href={lessonHref(lesson.id)} variant="standalone">
                          {C.lessonLink(li + 1, lesson.title)}
                        </Link>
                        <span className="text-sm text-muted-foreground">
                          {C.lessonMeta(
                            LESSON_STATE_LABEL[lesson.state],
                            lesson.durationMin,
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <NewLessonForm
                  idPrefix={`module-${module.id}`}
                  busy={busy}
                  onAdd={(fields) =>
                    write(() =>
                      transport.createLesson({
                        moduleId: module.id,
                        projectId: course.projectId,
                        ...fields,
                      }),
                    )
                  }
                />
              </div>
            </CardContent>
          </Card>
        ))}
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void write(() =>
              transport.createModule({
                courseId: course.id,
                title: moduleTitle,
              }),
            ).then((ok) => ok && setModuleTitle(""));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-module-title">{C.moduleTitle}</Label>
            <Input
              id="new-module-title"
              value={moduleTitle}
              required
              onChange={(e) => setModuleTitle(e.target.value)}
            />
          </div>
          <Button type="submit" size="field" variant="outline" disabled={busy}>
            {C.addModule}
          </Button>
        </form>
      </section>
    </div>
  );
}

function NewLessonForm({
  idPrefix,
  busy,
  onAdd,
}: {
  idPrefix: string;
  busy: boolean;
  onAdd: (fields: {
    title: string;
    description: string;
    teaser: string;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [teaser, setTeaser] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onAdd({ title, description, teaser })) {
      setTitle("");
      setDescription("");
      setTeaser("");
    }
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <FormFieldGroup>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-lesson-title`}>{C.lessonTitle}</Label>
          <Input
            id={`${idPrefix}-lesson-title`}
            value={title}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-lesson-teaser`}>{C.lessonTeaser}</Label>
          <Input
            id={`${idPrefix}-lesson-teaser`}
            value={teaser}
            onChange={(e) => setTeaser(e.target.value)}
          />
        </div>
      </FormFieldGroup>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-lesson-description`}>
          {C.lessonDescription}
        </Label>
        <Textarea
          id={`${idPrefix}-lesson-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <FormActions>
        <Button type="submit" variant="outline" disabled={busy}>
          {C.addLesson}
        </Button>
      </FormActions>
    </form>
  );
}

function ModuleRenameForm({
  no,
  moduleId,
  title: current,
  busy,
  onRename,
}: {
  no: number;
  moduleId: string;
  title: string;
  busy: boolean;
  onRename: (title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(current);
  const id = `module-${moduleId}-rename`;
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void onRename(title);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={id}>{S.moduleRename(no)}</Label>
        <Input
          id={id}
          value={title}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="field"
        variant="outline"
        disabled={busy || title.trim() === current}
      >
        {S.rename}
      </Button>
    </form>
  );
}

const DOCUMENT_KINDS: LearningDocumentKind[] = [
  "certificate",
  "certificate-nmo",
];

/** The identity of the course's EARS-1 data the form edits. */
function detailsKey(course: LearningCourseComposition): string {
  return JSON.stringify([
    course.id,
    course.title,
    course.description,
    course.academicHours,
    course.documentKind,
    course.documentPrerequisites,
    course.partnerOrganisationId,
  ]);
}

/** 023 EARS-27 — the course's EARS-1 data (the partner only through the host's picker). */
function CourseDetailsForm({
  course,
  busy,
  partnerField,
  onSave,
}: {
  course: LearningCourseComposition;
  busy: boolean;
  partnerField: CourseCompositionScreenProps["partnerField"];
  onSave: (body: UpdateLearningCourseRequest) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [hours, setHours] = useState(String(course.academicHours));
  const [documentKind, setDocumentKind] = useState(course.documentKind);
  const [prerequisites, setPrerequisites] = useState(
    course.documentPrerequisites,
  );
  const [partner, setPartner] = useState(course.partnerOrganisationId);
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-bold text-foreground">
          {S.courseDetailsHeading}
        </h2>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({
              title,
              description,
              academicHours: Number(hours),
              documentKind,
              documentPrerequisites: prerequisites,
              ...(partnerField ? { partnerOrganisationId: partner } : {}),
            });
          }}
        >
          <FormFieldGroup>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="course-title">{S.courseTitle}</Label>
              <Input
                id="course-title"
                value={title}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="course-hours">{S.academicHours}</Label>
              <Input
                id="course-hours"
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                step={1}
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
          </FormFieldGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="course-description">{S.courseDescription}</Label>
            <Textarea
              id="course-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-foreground">
              {S.documentLegend}
            </legend>
            {DOCUMENT_KINDS.map((kind) => (
              <Radio
                key={kind}
                name="course-document-kind"
                value={kind}
                checked={documentKind === kind}
                onChange={() => setDocumentKind(kind)}
              >
                {S.documentKind[kind]}
              </Radio>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="course-prerequisites">
              {S.documentPrerequisites}
            </Label>
            <Textarea
              id="course-prerequisites"
              value={prerequisites}
              onChange={(e) => setPrerequisites(e.target.value)}
            />
          </div>
          {partnerField
            ? partnerField({
                id: "course-partner",
                value: partner,
                onChange: setPartner,
              })
            : null}
          <FormActions>
            <Button type="submit" disabled={busy}>
              {S.save}
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
