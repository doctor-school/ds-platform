import {
  learningCourses,
  learningSchoolInterests,
  learningSchools,
} from "@ds/db";
import type { LearningSchoolInterest } from "@ds/schemas";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import {
  LearningServerError,
  type LearningDb,
  type LearningSchoolOpenedNotice,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";

// 023 EARS-7 (023-design §2, §6) — the doctor's interest in a «скоро» school
// and the one-time school-opened notice. An interest is a doctor ↔ school
// record: it never reads or writes the doctor's specialties (017) or feed (018).

type Handle = LearningDb | LearningTx;
type InterestRow = typeof learningSchoolInterests.$inferSelect;

const toInterest = (r: InterestRow): LearningSchoolInterest => ({
  schoolId: r.schoolId,
  state: r.state,
  registeredAt: r.registeredAt.toISOString(),
  withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
});

async function publishedSchool(db: Handle, schoolId: string) {
  const [school] = await db
    .select({ id: learningSchools.id })
    .from(learningSchools)
    .where(
      and(
        eq(learningSchools.id, schoolId),
        eq(learningSchools.state, "published"),
      ),
    );
  if (!school) throw new LearningServerError("NOT_FOUND", "school not found");
}

/** EARS-3, EARS-7 — whether the doctor has an active interest in the school. */
export async function hasActiveInterest(
  db: Handle,
  personId: string,
  schoolId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ state: learningSchoolInterests.state })
    .from(learningSchoolInterests)
    .where(
      and(
        eq(learningSchoolInterests.personId, personId),
        eq(learningSchoolInterests.schoolId, schoolId),
      ),
    );
  return row?.state === "active";
}

/** EARS-7, EARS-26 — the staff count: doctors with an active interest, never who. */
export async function activeInterestCount(
  db: Handle,
  schoolId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(learningSchoolInterests)
    .where(
      and(
        eq(learningSchoolInterests.schoolId, schoolId),
        eq(learningSchoolInterests.state, "active"),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * EARS-7 — `PUT /v1/me/learning/schools/{schoolId}/interest`: an upsert to
 * `active`. A repeat answers the existing active interest unchanged; a
 * register after a withdraw makes it active again with a new `registered_at`.
 * The capture is a «скоро» state: an open school (one with a published course)
 * takes no new interest — `409 INVALID_TRANSITION` — so no doctor is ever
 * notified by an interest no capture offered.
 */
export async function registerSchoolInterest(
  deps: LearningServerDeps,
  personId: string,
  schoolId: string,
): Promise<LearningSchoolInterest> {
  return deps.transaction(async (tx) => {
    await publishedSchool(tx, schoolId);
    const [open] = await tx
      .select({ id: learningCourses.id })
      .from(learningCourses)
      .where(
        and(
          eq(learningCourses.schoolId, schoolId),
          eq(learningCourses.state, "published"),
        ),
      )
      .limit(1);
    if (open)
      throw new LearningServerError(
        "INVALID_TRANSITION",
        "the school is open; interest is taken only while it is soon",
      );
    const now = deps.now?.() ?? new Date();
    const [inserted] = await tx
      .insert(learningSchoolInterests)
      .values({ personId, schoolId, state: "active", registeredAt: now })
      .onConflictDoUpdate({
        target: [learningSchoolInterests.personId, learningSchoolInterests.schoolId],
        set: { state: "active", registeredAt: now, withdrawnAt: null },
        setWhere: ne(learningSchoolInterests.state, "active"),
      })
      .returning();
    if (inserted) return toInterest(inserted);
    const [existing] = await tx
      .select()
      .from(learningSchoolInterests)
      .where(
        and(
          eq(learningSchoolInterests.personId, personId),
          eq(learningSchoolInterests.schoolId, schoolId),
        ),
      );
    return toInterest(existing!);
  });
}

/**
 * EARS-7 — `DELETE /v1/me/learning/schools/{schoolId}/interest`: marks the
 * interest `withdrawn` (the row stays, so its `notified_at` keeps the notice
 * once-only). Withdrawing an absent or already withdrawn interest is `404`.
 */
export async function withdrawSchoolInterest(
  deps: LearningServerDeps,
  personId: string,
  schoolId: string,
): Promise<LearningSchoolInterest> {
  return deps.transaction(async (tx) => {
    await publishedSchool(tx, schoolId);
    const now = deps.now?.() ?? new Date();
    const [row] = await tx
      .update(learningSchoolInterests)
      .set({ state: "withdrawn", withdrawnAt: now })
      .where(
        and(
          eq(learningSchoolInterests.personId, personId),
          eq(learningSchoolInterests.schoolId, schoolId),
          eq(learningSchoolInterests.state, "active"),
        ),
      )
      .returning();
    if (!row)
      throw new LearningServerError("NOT_FOUND", "no active interest");
    return toInterest(row);
  });
}

/** Claim every active, unsent interest of the school and answer its notices. */
async function claimInterests(
  tx: LearningTx,
  school: { id: string; slug: string; title: string },
  courseTitle: string,
  at: Date,
): Promise<LearningSchoolOpenedNotice[]> {
  const claimed = await tx
    .update(learningSchoolInterests)
    .set({ notifiedAt: at })
    .where(
      and(
        eq(learningSchoolInterests.schoolId, school.id),
        eq(learningSchoolInterests.state, "active"),
        isNull(learningSchoolInterests.notifiedAt),
      ),
    )
    .returning({ personId: learningSchoolInterests.personId });
  return claimed.map(({ personId }) => ({
    personId,
    school: { slug: school.slug, title: school.title },
    course: { title: courseTitle },
  }));
}

/**
 * EARS-7 (023-design §6) — inside the transaction that publishes `courseId`:
 * WHILE no other course of its school is published (the school goes from
 * «скоро» to open), claim every active interest whose notice is unsent by
 * setting `notified_at`, and answer the notices to send after commit. A
 * replay, or a publication while another course is already published, claims
 * nothing; the `notified_at IS NULL` guard keeps concurrent publishers from
 * claiming the same doctor twice. A draft school claims nothing here: its
 * republish claims instead (`claimSchoolRepublishedNotices`).
 */
export async function claimSchoolOpenedNotices(
  tx: LearningTx,
  courseId: string,
  at: Date,
): Promise<LearningSchoolOpenedNotice[]> {
  const [course] = await tx
    .select({
      schoolId: learningCourses.schoolId,
      title: learningCourses.title,
      schoolSlug: learningSchools.slug,
      schoolTitle: learningSchools.title,
      schoolState: learningSchools.state,
    })
    .from(learningCourses)
    .innerJoin(learningSchools, eq(learningSchools.id, learningCourses.schoolId))
    .where(eq(learningCourses.id, courseId));
  if (!course || course.schoolState !== "published") return [];
  const [other] = await tx
    .select({ id: learningCourses.id })
    .from(learningCourses)
    .where(
      and(
        eq(learningCourses.schoolId, course.schoolId),
        eq(learningCourses.state, "published"),
        ne(learningCourses.id, courseId),
      ),
    )
    .limit(1);
  if (other) return [];
  return claimInterests(
    tx,
    { id: course.schoolId, slug: course.schoolSlug, title: course.schoolTitle },
    course.title,
    at,
  );
}

/**
 * EARS-7 (023-design §6) — inside the transaction that publishes a school:
 * WHEN the school already has a published course (it was unpublished while
 * staff published its first course), it opens to doctors now, so claim the
 * unsent interests exactly as a first course publication does, naming its
 * first published course. Without a published course it reads «скоро» and
 * claims nothing; the `notified_at IS NULL` guard keeps a later republish or
 * course publication from claiming the same doctor twice.
 */
export async function claimSchoolRepublishedNotices(
  tx: LearningTx,
  school: { id: string; slug: string; title: string },
  at: Date,
): Promise<LearningSchoolOpenedNotice[]> {
  const [course] = await tx
    .select({ title: learningCourses.title })
    .from(learningCourses)
    .where(
      and(
        eq(learningCourses.schoolId, school.id),
        eq(learningCourses.state, "published"),
      ),
    )
    .orderBy(asc(learningCourses.position))
    .limit(1);
  if (!course) return [];
  return claimInterests(tx, school, course.title, at);
}
