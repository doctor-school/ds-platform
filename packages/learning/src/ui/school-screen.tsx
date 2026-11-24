import type { LearningSchoolRead } from "@ds/schemas";
import { Button, Skeleton } from "@ds/design-system";

import { CourseCards, courseCard } from "./school-cards";
import { SchoolCourseList } from "./school-course-list";
import { SchoolInterest } from "./school-interest";
import {
  registerHref,
  schoolHref,
  type LearningHostConfig,
} from "./host-config";
import { LEARNING_UI_COPY, SCHOOL_UI_COPY as C } from "./learning-ui-copy";

// 023 EARS-4, EARS-5, EARS-8, EARS-22, EARS-23 — the school screen of
// `design-source/doctor-school.dc.html` (Stage A «Го» 2026-11-12): the poster
// header, «О школе», the school's courses — up to six as the doctor content
// card (`FeedCard` variant Б), more as «Вы учитесь» cards + searchable rows
// (`SchoolCourseList`) — and, for a guest, the registration gate. EARS-6,
// EARS-7: a `soon` school (no published course) shows «Скоро» in the header,
// «Школа готовится» with its note and the interest capture, and the empty
// events and reviews sections — empty by construction, as both hang on a
// published course. The open school's events, document block, mentoring,
// reviews and community land in their own slices.

const MAX_FACTS = 4;
/** 023 EARS-5 — up to six courses are all cards; more switch to the list. */
const MAX_CARDS = 6;

export interface SchoolScreenProps {
  config: LearningHostConfig;
  read: LearningSchoolRead;
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <div className="mb-6 flex items-baseline gap-4">
      <h2
        id={id}
        className="m-0 text-2xl font-extrabold leading-display tracking-tight whitespace-nowrap sm:text-3xl"
      >
        {children}
      </h2>
      <span
        aria-hidden="true"
        className="min-w-10 flex-1 -translate-y-1.5 border-t-2 border-foreground"
      />
    </div>
  );
}

export function SchoolScreen({ config, read }: SchoolScreenProps) {
  const { school, signedIn, courses } = read;
  const facts = school.facts.slice(0, MAX_FACTS);
  return (
    <div className="bg-background pb-16 text-foreground">
      <SchoolPoster read={read} />

      {facts.length > 0 ? (
        <section
          aria-labelledby="school-about"
          className="px-gutter pt-section"
        >
          <div className="mx-auto max-w-content">
            <SectionHeading id="school-about">{C.aboutHeading}</SectionHeading>
            {facts.length > 0 ? (
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {facts.map((f) => (
                  <div key={f.label} className="bg-section px-5 py-4">
                    <dt className="text-xs font-extrabold tracking-eyebrow text-muted-foreground uppercase">
                      {f.label}
                    </dt>
                    <dd className="m-0 mt-2 text-sm leading-normal font-bold">
                      {f.text}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>
      ) : null}

      {school.status === "soon" ? <SoonSections config={config} read={read} /> : null}

      {courses.length > 0 ? (
        <section
          aria-labelledby="school-courses"
          className="px-gutter pt-section"
        >
          <div className="mx-auto max-w-content">
            <SectionHeading id="school-courses">
              {C.coursesHeading}
            </SectionHeading>
            {courses.length > MAX_CARDS ? (
              <SchoolCourseList
                config={config}
                schoolTitle={school.title}
                courses={courses}
              />
            ) : (
              <CourseCards
                cards={courses.map((c) => courseCard(config, school.title, c))}
              />
            )}
            {!signedIn ? (
              <div className="mt-6 flex flex-wrap items-center gap-4 border-2 border-border bg-tint p-5 shadow-lg sm:p-6">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-base font-extrabold tracking-tight text-tint-foreground">
                    {C.gate.title}
                  </div>
                  <div className="mt-1 text-sm leading-normal font-semibold text-muted-foreground">
                    {C.gate.text}
                  </div>
                </div>
                <Button asChild>
                  <a
                    href={registerHref(config, schoolHref(config, school.slug))}
                  >
                    {C.gate.action}
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The canvas's dashed empty block («школа готовится», empty events / reviews). */
function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-2 border-dashed border-hairline p-6 text-center sm:p-9">
      {children}
    </div>
  );
}

/** 023 EARS-6, EARS-7 — the soon school's courses state, events and reviews. */
function SoonSections({ config, read }: SchoolScreenProps) {
  const { school, signedIn, interested } = read;
  const sections = [
    { id: "school-events", heading: C.soon.eventsHeading, text: C.soon.eventsEmpty },
    { id: "school-reviews", heading: C.soon.reviewsHeading, text: C.soon.reviewsEmpty },
  ];
  return (
    <>
      <section aria-labelledby="school-courses" className="px-gutter pt-section">
        <div className="mx-auto max-w-content">
          <SectionHeading id="school-courses">{C.coursesHeading}</SectionHeading>
          <EmptyBlock>
            <div className="text-lg font-extrabold tracking-tight">
              {C.soon.title}
            </div>
            {school.soonNote ? (
              <p className="m-0 mx-auto mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {school.soonNote}
              </p>
            ) : null}
            <SchoolInterest
              config={config}
              schoolId={school.id}
              schoolSlug={school.slug}
              signedIn={signedIn}
              interested={interested}
            />
          </EmptyBlock>
        </div>
      </section>
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="px-gutter pt-section">
          <div className="mx-auto max-w-content">
            <SectionHeading id={s.id}>{s.heading}</SectionHeading>
            <EmptyBlock>
              <p className="m-0 text-sm font-semibold text-muted-foreground">
                {s.text}
              </p>
            </EmptyBlock>
          </div>
        </section>
      ))}
    </>
  );
}

function SchoolPoster({ read }: { read: LearningSchoolRead }) {
  const { school, direction, expert } = read;
  return (
    <section className="bg-hero px-gutter pt-10 pb-12 text-hero-foreground sm:pt-12 sm:pb-16">
      <div className="mx-auto max-w-content">
        <nav
          aria-label={LEARNING_UI_COPY.breadcrumbLabel}
          className="flex flex-wrap items-center gap-2 text-xs font-bold"
        >
          {direction ? (
            <>
              <span className="text-hero-muted">{direction.title}</span>
              <span aria-hidden="true" className="text-hero-muted">
                ›
              </span>
            </>
          ) : null}
          <span aria-current="page">{school.title}</span>
        </nav>
        <div className="mt-6 text-eyebrow font-extrabold tracking-eyebrow text-hero-muted uppercase">
          {C.eyebrow}
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <h1 className="m-0 mt-3 min-w-0 flex-1 basis-80 text-panel-headline leading-display font-extrabold tracking-tight text-balance">
            {school.title}
          </h1>
          <span className="mt-4 inline-block flex-none rotate-2 border-2 border-hero-foreground px-4 py-2.5 text-xs font-extrabold tracking-eyebrow uppercase">
            {school.status === "soon"
              ? C.soon.badge
              : C.counts(school.courseCount, school.lessonCount)}
          </span>
        </div>
        {school.description ? (
          <p className="m-0 mt-4 max-w-prose text-sm leading-relaxed font-medium text-hero-muted sm:text-base">
            {school.description}
          </p>
        ) : null}
        {expert ? (
          <p className="m-0 mt-4 text-sm font-semibold">
            <span className="text-hero-muted">{C.expert} · </span>
            {[expert.name, expert.role].filter(Boolean).join(", ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** One skeleton bar: the primitive fills a sized box (no call-site restyle). */
function Bar({ className }: { className: string }) {
  return (
    <div className={className}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

/** 023 EARS-4 — the canvas loading state («d-school · загрузка»): the page skeleton. */
export function SchoolScreenSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={C.loading}
      className="bg-background pb-16"
    >
      <div className="bg-hero px-gutter pt-12 pb-16">
        <div className="mx-auto flex max-w-content flex-col gap-4">
          <Bar className="h-4 w-1/3" />
          <Bar className="h-12 w-2/3" />
        </div>
      </div>
      <div className="px-gutter pt-section">
        <div className="mx-auto flex max-w-content flex-col gap-5">
          <Bar className="h-4 w-1/3" />
          <Bar className="h-3 w-2/3" />
          <Bar className="h-3 w-1/2" />
          <div className="flex flex-col gap-4 border-2 border-hairline p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Bar className="h-3.5 w-14 flex-none" />
                <Bar className="h-3.5 flex-1" />
                <Bar className="h-3.5 w-12 flex-none" />
              </div>
            ))}
          </div>
          <Bar className="h-44" />
        </div>
      </div>
    </div>
  );
}
