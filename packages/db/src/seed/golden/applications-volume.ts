// 033 (#4030) — the application queue at volume.
//
// The admin «Заявки» list pages by cursor (EARS-13, 20 rows a page by
// default), shows a status with its outcome, the «Команда не уведомлена» and
// «Персональные данные стёрты» marks, and the detail shows the payload, the
// applicant read live, the consent, the notice outcomes, the team notes and the
// applicant's other applications (EARS-14..16). An empty table on a slot shows
// none of that, so this half writes what the product writes:
//
//   * author applications only — the partnership kind arrives with its intake
//     (#4032), the investor kind with 034;
//   * each one filed by an existing seeded account (a volume doctor or a
//     learner) with its own consent record of purpose
//     `author-application-personal-data`, captured at submission — what the
//     intake writes in one transaction (EARS-6, EARS-7); a few doctors apply
//     more than once, so the detail's «other applications» is not empty;
//   * every status — new, in review, closed accepted / declined / expired —
//     and every team-notice outcome, `version` counting the moves the admin
//     made (EARS-15): new → in review → closed, and the purge's own expiry
//     (EARS-23: a year without a change, no acting administrator);
//   * erased tombstones (EARS-20, EARS-24): the two retired volume doctors'
//     applications erased with their accounts — one still in review, one
//     closed — and one closed application erased on request; their notes carry
//     the sentinel;
//   * nothing the daily purge would move on the day the slot is built: an open
//     application changed within the year, a closed one closed within it.
//
// No randomness: every value is a curated literal or a function of the row's
// ordinal, every instant a whole offset from the dataset's «now».

import type {
  NewApplication,
  NewApplicationNote,
} from "../../schema/applications.js";
import type { NewConsentRecord } from "../../schema/consent-records.js";
import type { NewUser } from "../../schema/users.js";
import { specialtyCodeFromName } from "../specialty-code.js";
import { goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { shiftFromNow } from "./now.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";

/**
 * `@ds/schemas` values the seed writes. `@ds/db` carries `@ds/schemas` as a dev
 * dependency only, so the runtime seed holds the literals and `golden.spec.ts`
 * pins them to the contract.
 */
export const GOLDEN_AUTHOR_APPLICATION_PURPOSE =
  "author-application-personal-data";
export const GOLDEN_APPLICATION_NOTE_ERASED_SENTINEL = "[стёрто]";
/**
 * The consent version tag the seeded applicants ticked: the edition and text
 * hash of `consent-author-application` (`@ds/legal-content`) when the queue was
 * seeded. A later edition makes these the older version a real applicant
 * would also hold.
 */
export const GOLDEN_AUTHOR_APPLICATION_CONSENT_VERSION =
  "2026-11-25.sha256-af0cca1e651d0a483616b11521b5b669088ea50b5721eb8904d16acc15aef055";

/** How many applications the queue holds: more than three default pages. */
export const GOLDEN_APPLICATIONS = 62;
/** The last four are the purge's expiries, submitted more than a year ago. */
const EXPIRED_FROM = 58;
const NEW_BELOW = 10;
const IN_REVIEW_BELOW = 24;
/** Ordinals of the account-erased (EARS-24) and request-erased (EARS-20) rows. */
const ACCOUNT_ERASED: ReadonlyMap<number, number> = new Map([
  // ordinal → the retired volume doctor's index (`volume.ts` VOLUME_DOCTORS)
  [15, 11],
  [55, 12],
]);
const REQUEST_ERASED = 40;
const TEAM_NOTICE_FAILED = new Set([3, 12, 30]);
const TEAM_NOTICE_SKIPPED = new Set([7, 45]);
const RECEIPT_FAILED = new Set([5, 33]);
/** Above every consent ordinal the volume and learner halves mint. */
const CONSENT_ORDINAL_BASE = GOLDEN_VOLUME_ORDINAL_BASE + 33_000;

const FORMATS = ["course_series", "single_lesson", "podcast", "talk"] as const;

/** `[topic, Минздрав specialty name]` — the specialty the topic belongs to. */
const TOPICS: readonly (readonly [string, string])[] = [
  ["Фибрилляция предсердий: антикоагулянты у пожилых пациентов", "Кардиология"],
  ["Мигрень: профилактическая терапия в амбулаторной практике", "Неврология"],
  [
    "H. pylori и хронический гастрит: что изменилось в рекомендациях",
    "Гастроэнтерология",
  ],
  [
    "Лекарственные взаимодействия при полипрагмазии",
    "Клиническая фармакология",
  ],
  [
    "Гестационный сахарный диабет: ведение беременности",
    "Акушерство и гинекология",
  ],
  [
    "Периоперационное обезболивание без опиоидов",
    "Анестезиология-реаниматология",
  ],
  ["Атопический дерматит у взрослых: системная терапия", "Дерматовенерология"],
  [
    "Хроническая болезнь почек: раннее выявление в первичном звене",
    "Нефрология",
  ],
  ["Железодефицитная анемия: диагностика и лечение", "Гематология"],
  [
    "Эмпирическая антибиотикотерапия в эпоху резистентности",
    "Инфекционные болезни",
  ],
  ["Профилактика падений у пациентов старшего возраста", "Гериатрия"],
  ["Геморрой: малоинвазивные методы лечения", "Колопроктология"],
  [
    "Пищевая аллергия у взрослых: от диагноза до диеты",
    "Аллергология и иммунология",
  ],
  ["Резистентная артериальная гипертензия", "Кардиология"],
  ["Первые часы ишемического инсульта", "Неврология"],
  [
    "Синдром раздражённого кишечника: разговор с пациентом",
    "Гастроэнтерология",
  ],
  ["Как сообщать пациенту плохие новости", "Гериатрия"],
  [
    "Вакцинация взрослых: календарь и возражения пациентов",
    "Инфекционные болезни",
  ],
];

const SPECIALTY_OTHER = [
  "Медицинская психология",
  "Нутрициология",
  "Доказательная медицина",
];

const ABOUT = [
  "Практикующий врач, веду приём в городской поликлинике и преподаю на кафедре. Хочу разобрать типичные ошибки на реальных клинических случаях.",
  "Двенадцать лет в стационаре, автор нескольких публикаций по теме. Есть готовый план из шести занятий и черновые слайды.",
  "Читаю лекции для ординаторов; материал проверен на трёх потоках слушателей. Могу записать пилотный урок в течение месяца.",
  "Руковожу отделением, тема — наша ежедневная практика. Готов работать с методистом над структурой.",
];

const NOTES = [
  "Позвонили автору, договорились о пилотном уроке на 15 минут.",
  "Тема пересекается с курсом этого сезона — уточнить у редакции, нужен ли второй.",
  "Запросили у автора план курса и пример слайдов.",
  "Автор — практикующий врач, стаж 12 лет; публикаций по теме нет.",
  "Редакция готова взять в работу после согласования с методистом.",
  "Формат подходит под летнюю сетку эфиров, обсудить даты.",
  "Неделю нет ответа на письмо — напомнить.",
  "Передано куратору направления.",
];

/** How many notes ordinal `i` carries (expiries and most new rows carry none). */
function noteCount(i: number, status: string): number {
  if (i >= EXPIRED_FROM) return 0;
  if (status === "new") return i === 4 ? 1 : 0;
  return [0, 1, 2, 1][i % 4]!;
}

export interface GoldenApplicationsVolume {
  consentRecords: NewConsentRecord[];
  applications: NewApplication[];
  applicationNotes: NewApplicationNote[];
}

/**
 * Builds the queue for the resolved «now».
 *
 * `doctors` are the volume doctors in `VOLUME_DOCTORS` order (the last two
 * retired), `learners` the non-login learners, `adminId` the golden platform
 * administrator who moved the statuses and wrote the notes.
 */
export function buildGoldenApplicationsVolume(
  now: Date,
  input: {
    doctors: readonly NewUser[];
    learners: readonly NewUser[];
    adminId: string;
  },
): GoldenApplicationsVolume {
  const at = (offset: Parameters<typeof shiftFromNow>[1]) =>
    shiftFromNow(now, offset);
  const after = (from: Date, offset: Parameters<typeof shiftFromNow>[1]) =>
    shiftFromNow(from, offset);
  const out: GoldenApplicationsVolume = {
    consentRecords: [],
    applications: [],
    applicationNotes: [],
  };

  for (let i = 0; i < GOLDEN_APPLICATIONS; i += 1) {
    const expired = i >= EXPIRED_FROM;
    const status =
      i < NEW_BELOW ? "new" : i < IN_REVIEW_BELOW ? "in_review" : "closed";
    const submittedAt = expired
      ? at({ days: -(372 + (i - EXPIRED_FROM) * 6), hours: -3 })
      : at({ days: -(1 + i * 4), hours: -((i * 7) % 12) });

    // The applicant: the retired doctors for the account erasures, the oldest
    // doctors for the year-old expiries, a doctor on every sixth row (repeat
    // applicants), a learner otherwise.
    const erasedDoctor = ACCOUNT_ERASED.get(i);
    const applicant =
      erasedDoctor !== undefined
        ? input.doctors[erasedDoctor]!
        : expired
          ? input.doctors[i - EXPIRED_FROM]!
          : i % 6 === 0
            ? input.doctors[(i / 6) % 11]!
            : input.learners[(i * 7) % input.learners.length]!;

    const [topic, specialtyName] = TOPICS[i % TOPICS.length]!;
    const payload: Record<string, string> = {
      topic,
      format: FORMATS[(i + Math.floor(i / 4)) % FORMATS.length]!,
    };
    if (i % 4 === 0 || i % 4 === 1)
      payload.specialtyCode = specialtyCodeFromName(specialtyName);
    else if (i % 4 === 2)
      payload.specialtyOther = SPECIALTY_OTHER[i % SPECIALTY_OTHER.length]!;
    if (i % 5 !== 4) payload.about = ABOUT[i % ABOUT.length]!;

    const consentId = goldenUuid(
      GOLDEN_GROUP.consentRecords,
      CONSENT_ORDINAL_BASE + i,
    );
    out.consentRecords.push({
      id: consentId,
      userId: applicant.id as string,
      purpose: GOLDEN_AUTHOR_APPLICATION_PURPOSE,
      version: GOLDEN_AUTHOR_APPLICATION_CONSENT_VERSION,
      capturedAt: submittedAt,
    });

    // The moves: in review the next day, closed a few days to three weeks
    // later; an expiry a year and a day after a submission nobody touched.
    let statusChangedAt: Date | null = null;
    let statusChangedBy: string | null = null;
    let closedAt: Date | null = null;
    let outcome: string | null = null;
    let version = 1;
    if (expired) {
      closedAt = statusChangedAt = after(submittedAt, { days: 366 });
      outcome = "expired";
      version = 2;
    } else if (status !== "new") {
      statusChangedAt = after(submittedAt, { days: 1, hours: 2 });
      statusChangedBy = input.adminId;
      version = 2;
      if (status === "closed") {
        closedAt = statusChangedAt = after(submittedAt, {
          days: 3 + (i % 20),
          hours: 5,
        });
        outcome = i % 3 === 0 ? "accepted" : "declined";
        version = 3;
      }
    }

    const pdErasedAt =
      erasedDoctor !== undefined
        ? (applicant.deletedAt as Date)
        : i === REQUEST_ERASED
          ? after(closedAt!, { days: 10 })
          : null;
    const erased = pdErasedAt !== null;
    const teamNotice =
      i === 0
        ? "pending"
        : TEAM_NOTICE_FAILED.has(i)
          ? "failed"
          : TEAM_NOTICE_SKIPPED.has(i)
            ? "skipped"
            : "sent";
    const receiptNotice =
      i === 0 ? "pending" : RECEIPT_FAILED.has(i) ? "failed" : "sent";

    const id = goldenUuid(
      GOLDEN_GROUP.applications,
      GOLDEN_VOLUME_ORDINAL_BASE + i,
    );
    out.applications.push({
      id,
      kind: "author",
      status,
      outcome,
      applicantUserId: erased ? null : (applicant.id as string),
      payload: erased ? { erased: true } : payload,
      contact: null,
      subjectLine: erased ? null : topic,
      consentRecordId: consentId,
      consentPurpose: GOLDEN_AUTHOR_APPLICATION_PURPOSE,
      consentVersionTag: GOLDEN_AUTHOR_APPLICATION_CONSENT_VERSION,
      idempotencyKey: goldenUuid(
        GOLDEN_GROUP.applications,
        GOLDEN_VOLUME_ORDINAL_BASE + 500 + i,
      ),
      submittedAt,
      teamNotice,
      receiptNotice,
      statusChangedAt,
      statusChangedBy,
      closedAt,
      pdErasedAt,
      version: erased ? version + 1 : version,
    });

    for (let k = 0; k < noteCount(i, status); k += 1) {
      out.applicationNotes.push({
        id: goldenUuid(
          GOLDEN_GROUP.applicationNotes,
          GOLDEN_VOLUME_ORDINAL_BASE + i * 10 + k,
        ),
        applicationId: id,
        authorAdminId: input.adminId,
        body: erased
          ? GOLDEN_APPLICATION_NOTE_ERASED_SENTINEL
          : NOTES[(i + k * 3) % NOTES.length]!,
        createdAt: after(submittedAt, { days: 1, hours: 4 + k * 5 }),
      });
    }
  }
  return out;
}
