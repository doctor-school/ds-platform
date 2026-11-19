"use client";

import { useState } from "react";
import type { LearningSchoolCourse } from "@ds/schemas";
import { Button, Input, Label } from "@ds/design-system";
import { FeedCard } from "@ds/design-system/blocks";

import { coursePathHref, type LearningHostConfig } from "./host-config";
import { SCHOOL_UI_COPY as C } from "./learning-ui-copy";
import { CourseCards, courseCard } from "./school-cards";

// 023 EARS-5 — a school with more than six published courses (canvas
// `doctor-school.dc.html` «много курсов»): the doctor's started and done
// courses as cards under «Вы учитесь», the rest as rows (`FeedCard` variant В)
// with «Найти курс» filtering by title and «Показать ещё 10» revealing the next
// ten rows. Both act client-side over the whole list the school read returns
// (023-design §4) — no URL edit. A guest has no states, so every course is a row.

const PAGE = 10;

export interface SchoolCourseListProps {
  config: LearningHostConfig;
  schoolTitle: string;
  courses: readonly LearningSchoolCourse[];
}

const isMine = (c: LearningSchoolCourse) =>
  c.state === "started" || c.state === "done";

export function SchoolCourseList({
  config,
  schoolTitle,
  courses,
}: SchoolCourseListProps) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const mine = courses.filter(isMine);
  const q = query.trim().toLowerCase();
  const rest = courses.filter(
    (c) => !isMine(c) && (!q || c.title.toLowerCase().includes(q)),
  );
  const visible = q ? rest : rest.slice(0, shown);
  const left = rest.length - visible.length;

  return (
    <>
      {mine.length > 0 ? (
        <div className="mb-7 layout:mb-10">
          <h3 className="m-0 mb-3 text-eyebrow font-extrabold tracking-eyebrow text-primary-action uppercase">
            {C.list.mine}
          </h3>
          <CourseCards
            cards={mine.map((c) => courseCard(config, schoolTitle, c))}
          />
        </div>
      ) : null}
      <div className="mb-3.5 flex flex-wrap items-end gap-3.5">
        <div className="min-w-50 flex-1 text-eyebrow font-extrabold tracking-eyebrow text-faint uppercase">
          {mine.length > 0 ? C.list.rest(rest.length) : C.list.all(rest.length)}
        </div>
        <div className="flex max-w-105 min-w-0 flex-1 basis-70 flex-col gap-1.5">
          <Label htmlFor="school-course-search">{C.list.search}</Label>
          <Input
            id="school-course-search"
            type="search"
            value={query}
            placeholder={C.list.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {visible.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0 layout:gap-2">
          {visible.map((c) => (
            <li key={c.id}>
              <FeedCard
                card={{
                  kind: "content-row",
                  href: coursePathHref(config, c.slug),
                  kicker: C.courseKicker,
                  title: c.title,
                  meta: `${c.lessonCount} ${C.lessonsWord(c.lessonCount)}`,
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {q && visible.length === 0 ? (
        <p
          role="status"
          className="m-0 border-2 border-dashed border-hairline p-6 text-center text-sm font-semibold text-muted-foreground"
        >
          {C.list.noMatch(query.trim())}
        </p>
      ) : null}
      {left > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => setShown((n) => n + PAGE)}
        >
          {C.list.more(Math.min(PAGE, left), left)}
        </Button>
      ) : null}
    </>
  );
}
