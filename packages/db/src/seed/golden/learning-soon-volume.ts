// 023 EARS-6 / EARS-7 (#4019) — the «скоро» school at volume.
//
// A published school with no published course is «Скоро»: the doctor screen
// shows the badge, «Школа готовится» with the school's own note, and the
// interest capture. Its interest list is held at the canvas volume switch 62
// (`design-source/doctor-school.dc.html` 3 / 22 / 62 / 200), taken from the
// non-login learners (`learning-results.ts`), with every seventh withdrawn, so
// the admin school read (`GET /v1/admin/learning/schools/{id}`) counts the
// active ones only and a slot shows a real number, never one row.
//
// No interest is `notified_at`: the school has not opened. The login doctors
// (the worker pool) hold no interest, so a drive starts from the capture.

import type {
  learningSchoolInterests,
  learningSchools,
} from "../../schema/learning.js";
import { golden, goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { goldenLearnerId } from "./learning-results.js";
import {
  goldenDirectionId,
  goldenVolumeExpertId,
  GOLDEN_VOLUME_ORDINAL_BASE,
} from "./volume.js";

/** The «скоро» school: a volume ordinal of its group (the long paths are `+5`). */
export const GOLDEN_SOON_SCHOOL = Object.freeze({
  id: goldenUuid(GOLDEN_GROUP.learningSchools, GOLDEN_VOLUME_ORDINAL_BASE + 6),
  slug: "golden-school-heart-failure",
});

/** Doctors who asked to hear when the school opens: the canvas switch 62. */
export const GOLDEN_SOON_SCHOOL_INTERESTS = 62;

/** Every seventh interest is withdrawn («Не сообщать»). */
export function goldenSoonInterestWithdrawn(i: number): boolean {
  return i % 7 === 6;
}

export interface GoldenLearningSoonVolume {
  learningSchools: (typeof learningSchools.$inferInsert)[];
  learningSchoolInterests: (typeof learningSchoolInterests.$inferInsert)[];
}

/** Builds the «скоро» school and its interests; `created` is the dataset's creation instant. */
export function buildGoldenLearningSoonVolume(
  created: Date,
): GoldenLearningSoonVolume {
  const at = (hours: number) => new Date(created.getTime() + hours * 3_600_000);
  return {
    learningSchools: [
      {
        id: GOLDEN_SOON_SCHOOL.id,
        directionId: goldenDirectionId("cardiology"),
        // `learning_schools_direction_expert_key`: the named cardiology school
        // holds (cardiology, the published expert), the long paths
        // (cardiology, volume expert 0); this one is led by volume expert 1.
        leadExpertId: goldenVolumeExpertId(1),
        projectId: golden.projects.publishedSchool.id,
        slug: GOLDEN_SOON_SCHOOL.slug,
        title: "Школа сердечной недостаточности",
        state: "published",
        description:
          "Ведение пациентов с хронической сердечной недостаточностью: диагностика, терапия по клиническим рекомендациям и наблюдение после выписки.",
        facts: [
          { label: "Формат", text: "Видеоуроки и разборы случаев" },
          { label: "Для кого", text: "Кардиологи и терапевты" },
        ],
        soonNote:
          "Готовим первый курс — о диагностике и стартовой терапии сердечной недостаточности.",
        version: 1,
        createdAt: created,
        updatedAt: created,
      },
    ],
    learningSchoolInterests: Array.from(
      { length: GOLDEN_SOON_SCHOOL_INTERESTS },
      (_, i) => {
        const withdrawn = goldenSoonInterestWithdrawn(i);
        return {
          personId: goldenLearnerId(i),
          schoolId: GOLDEN_SOON_SCHOOL.id,
          state: withdrawn ? ("withdrawn" as const) : ("active" as const),
          registeredAt: at(1 + i),
          withdrawnAt: withdrawn ? at(100 + i) : null,
          notifiedAt: null,
        };
      },
    ),
  };
}
