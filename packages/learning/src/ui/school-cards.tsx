import type { LearningSchoolCourse } from "@ds/schemas";
import { FeedCard, type FeedContentCardData } from "@ds/design-system/blocks";

import { coursePathHref, type LearningHostConfig } from "./host-config";
import {
  DOCUMENT_LABEL,
  SCHOOL_UI_COPY as C,
  academicHoursText,
} from "./learning-ui-copy";

// 023 EARS-5, EARS-22 — a school course as the doctor content card (`FeedCard`
// variant Б), shared by the up-to-six list and «Вы учитесь».

export function courseCard(
  config: LearningHostConfig,
  schoolTitle: string,
  c: LearningSchoolCourse,
): FeedContentCardData {
  const state = c.state === "done" || c.state === "started" ? c.state : null;
  return {
    kind: "content",
    href: coursePathHref(config, c.slug),
    kicker: C.courseKicker,
    scope: schoolTitle,
    title: c.title,
    description: c.description || null,
    metric: {
      value: String(c.lessonCount),
      label: C.lessonsWord(c.lessonCount),
    },
    facts: [
      c.academicHours > 0 ? academicHoursText(c.academicHours) : null,
      DOCUMENT_LABEL[c.document.kind],
    ].filter((f): f is string => f !== null),
    state,
    partner: c.partner,
    cta:
      state === "done"
        ? C.cta.done
        : state === "started"
          ? C.cta.started(c.nextLessonNumber)
          : C.cta.open,
  };
}

/** The course cards in a vertical list (canvas `courseGap`: 12px phone, 16px desktop). */
export function CourseCards({ cards }: { cards: FeedContentCardData[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0 layout:gap-4">
      {cards.map((card) => (
        <li key={card.href}>
          <FeedCard card={card} />
        </li>
      ))}
    </ul>
  );
}
