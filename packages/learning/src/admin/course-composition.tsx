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
import type { LearningCourseComposition } from "@ds/schemas";

import { ADMIN_COPY as C, LESSON_STATE_LABEL } from "./admin-copy";
import { PresetPanel } from "./preset-panel";
import { refusedFieldLines } from "./refusals";
import type { LearningAdminTransport } from "./transport";

// 024 EARS-28 — the way to a module's lessons: the course's modules and lessons,
// a new module and a new lesson (title, description, teaser; the lesson takes
// the course's project). School and course rows are created through the admin
// API in this slice; their editor is 023's (#4018). EARS-29 slice 1 — the
// course's preset choice (`PresetPanel`).

export interface CourseCompositionScreenProps {
  courseId: string;
  transport: LearningAdminTransport;
  lessonHref: (lessonId: string) => string;
}

export function CourseCompositionScreen({
  courseId,
  transport,
  lessonHref,
}: CourseCompositionScreenProps) {
  const [course, setCourse] = useState<LearningCourseComposition | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
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
    try {
      await run();
      await load();
      return true;
    } catch (error) {
      const lines = refusedFieldLines(error);
      setRefused(lines.length > 0 ? lines : [C.failed]);
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

  return (
    <div className="flex flex-col gap-6" data-testid="course-composition">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <h1 className="min-w-0 break-words text-xl font-extrabold text-foreground">
          {course.title}
        </h1>
        <Badge variant={course.state === "published" ? "success" : "label"}>
          {LESSON_STATE_LABEL[course.state]}
        </Badge>
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

      <PresetPanel courseId={course.id} transport={transport} />

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
              <h3 className="text-base font-bold text-foreground">
                {C.moduleHeading(mi + 1, module.title)}
              </h3>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
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
