import type { LearningCoursePath } from "@ds/schemas";
import { Link } from "@ds/design-system";
import { FEED_CARD_COPY } from "@ds/design-system/blocks";

import { schoolHref, type LearningHostConfig } from "./host-config";
import {
  COURSE_HEADER_COPY as H,
  DOCUMENT_LABEL,
  LEARNING_UI_COPY as C,
} from "./learning-ui-copy";

// 023 EARS-11, EARS-12, EARS-13, EARS-22 — the course header above the 024
// path block (`design-source/doctor-course.dc.html` v16 «d-course · шапка»):
// the school breadcrumb, the eyebrow with lessons and academic hours (no module
// count for a one-module course), the title, the description, then the
// author, the document with its prerequisites, the rules summary the 024
// sentence builder made for the course scope (what opens when, what counts as
// done, the certificate needs the whole course — never a preset's name) and the
// partner mark WHILE the course carries one.

export function CourseHeader({
  path,
  config,
}: {
  path: LearningCoursePath;
  config: LearningHostConfig;
}) {
  const { course, direction, school, author } = path;
  const facts: { label: string; value: string }[] = [
    ...(author
      ? [
          {
            label: H.author,
            value: [author.name, author.role].filter(Boolean).join(", "),
          },
        ]
      : []),
    { label: H.document, value: DOCUMENT_LABEL[course.document.kind] },
    ...(course.document.prerequisites
      ? [{ label: H.prerequisites, value: course.document.prerequisites }]
      : []),
    { label: H.rules, value: course.rulesSummary },
  ];
  return (
    <section className="px-gutter pt-10">
      <div className="mx-auto flex max-w-content flex-col gap-4">
        <nav
          aria-label={C.breadcrumbLabel}
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {direction ? (
            <>
              <span>{direction.title}</span>
              <span aria-hidden="true">›</span>
            </>
          ) : null}
          <Link href={schoolHref(config, school.slug)} size="sm" tone="muted">
            {school.title}
          </Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="font-semibold text-foreground">
            {course.title}
          </span>
        </nav>
        <div className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-action">
          {C.courseEyebrow(
            path.modules.length,
            course.lessonCount,
            course.academicHours,
          )}
        </div>
        <h1 className="m-0 text-panel-headline font-extrabold leading-display">
          {course.title}
        </h1>
        {course.description ? (
          <p className="m-0 text-lead leading-relaxed text-muted-foreground">
            {course.description}
          </p>
        ) : null}
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-bold text-muted-foreground">{f.label}</dt>
              <dd className="m-0 sm:col-span-3">{f.value}</dd>
            </div>
          ))}
        </dl>
        {course.partner ? (
          <div className="self-start border border-hairline px-2 py-1 text-xs font-extrabold tracking-wide text-faint uppercase">
            {FEED_CARD_COPY.partner(course.partner.name)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
