// #4172 — the congresses at volume.
//
// The named catalogue configures two congresses (`golden.events.upcoming`,
// `golden.events.doctorCongress`) and holds no submission and no attendance
// mark, so on a slot the committee's submission list (046) and the desk roster's
// day column (044) render empty. Two volume эфиры of the doctor storefront are
// configured as congresses here — as the named `golden.events.upcoming` эфир is
// (the intake settings attach to any event) — and carry what those screens
// list, in the shape the product writes:
//
//   * an offline эфир a few days BEHIND the pin — intake closed, the committee's
//     decisions made, the desk's attendance marked on its day;
//   * an offline эфир five to twelve days AHEAD — oral and poster intake open
//     until the day before it, abstracts announced, submissions in every
//     pre-decision state.
//
// Both are fixed grid ordinals of `volume.ts`: the grid is anchored on the pin's
// own Monday, so an ordinal keeps its format and audience at every pin and its
// distance from the pin drifts by at most a week — the builder refuses a grid
// that moved them. The upcoming one starts before the named
// `golden.events.doctorCongress` (+15 days) at every pin: the doctor's congress
// section is the configured event with the LATEST start (046 EARS-1,
// `CongressSubmissionsService.congressEventId`), and it must stay the named one.
//
// Their registrants are the verified volume doctors, registered before the
// эфир started and after their account existed (`volume.ts` rule 6). A doctor
// the stride already registered keeps that registration; the rest take
// ordinals ≥ `CONGRESS_REGISTRATION_ORDINAL` inside the `registrations` volume
// namespace, which the plan replaces on every run; the submissions and the
// marks are its declared children (`plan.ts`).

import type {
  congressSubmissionKindSettings,
  congressSubmissionSettings,
} from "../../schema/congress-submission-settings.js";
import type { congressSubmissions } from "../../schema/congress-submissions.js";
import type { NewEvent } from "../../schema/events.js";
import type { registrationAttendance } from "../../schema/registration-attendance.js";
import type { NewRegistration } from "../../schema/registrations.js";
import type { NewUser } from "../../schema/users.js";
import { goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { goldenDateOnly, goldenMskMidnight, shiftFromNow } from "./now.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";

/** Above every ordinal the stride registrations of `volume.ts` reach. */
const CONGRESS_REGISTRATION_ORDINAL = 100_000;

/** The two congress эфиры: grid indices of `volume.ts` (doctors, offline). */
export const GOLDEN_VOLUME_CONGRESSES = Object.freeze({
  past: Object.freeze({
    id: goldenUuid(GOLDEN_GROUP.events, GOLDEN_VOLUME_ORDINAL_BASE + 391),
    state: "ended",
  }),
  upcoming: Object.freeze({
    id: goldenUuid(GOLDEN_GROUP.events, GOLDEN_VOLUME_ORDINAL_BASE + 421),
    state: "published",
  }),
});

/** Raised when the volume grid no longer puts a congress where this module expects it. */
export class GoldenCongressVolumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCongressVolumeError";
  }
}

const MS_DAY = 86_400_000;
/** Talks as a doctor would title and describe them. */
const TALKS = [
  [
    "Ранняя диагностика сердечной недостаточности в амбулаторной практике",
    "Показать, какие признаки и анализы позволяют заподозрить сердечную недостаточность до госпитализации.",
  ],
  [
    "Опыт применения SGLT2-ингибиторов у пациентов с ХБП",
    "Оценить переносимость и динамику СКФ за год наблюдения в городской поликлинике.",
  ],
  [
    "Фибрилляция предсердий у пожилых: выбор антикоагулянта",
    "Сравнить частоту кровотечений на разных схемах антикоагуляции у пациентов старше 75 лет.",
  ],
  [
    "Контроль артериального давления: телемедицинский дневник",
    "Описать, как дистанционный дневник АД меняет приверженность лечению за шесть месяцев.",
  ],
  [
    "Дислипидемия после инфаркта: достижение целевого ЛПНП",
    "Проанализировать, сколько пациентов достигают целевого уровня ЛПНП через год после события.",
  ],
  [
    "Анемия у пациентов с сердечной недостаточностью",
    "Показать распространённость железодефицита и результаты внутривенной коррекции.",
  ],
  [
    "Синкопальные состояния: алгоритм для терапевта",
    "Предложить короткий алгоритм обследования пациента после обморока на приёме.",
  ],
  [
    "Полипрагмазия у пациентов с сердечно-сосудистыми заболеваниями",
    "Оценить, как пересмотр назначений снижает число лекарственных взаимодействий.",
  ],
] as const;

const WORKPLACES = [
  "ГБУЗ «Городская поликлиника № 12», Москва",
  "ФГБУ «НМИЦ кардиологии», Москва",
  "ГБУЗ «Областная клиническая больница», Тверь",
  "Клиника семейной медицины, Казань",
] as const;

const SUMMARY =
  "В исследование включены пациенты, наблюдавшиеся в течение года. Оценивались клинические исходы, переносимость терапии и приверженность лечению. Получены данные, которые можно применить в ежедневной практике врача первичного звена.";

type Status =
  | "draft"
  | "submitted"
  | "in_review"
  | "accepted"
  | "rejected"
  | "needs_revision"
  | "withdrawn";

/** Decided by the committee: the congress is over. */
const PAST_STATUSES: readonly Status[] = [
  "accepted",
  "accepted",
  "rejected",
  "accepted",
  "withdrawn",
  "accepted",
  "rejected",
  "accepted",
];

/** Intake open: every state before a decision, and a first decision or two. */
const UPCOMING_STATUSES: readonly Status[] = [
  "submitted",
  "in_review",
  "needs_revision",
  "draft",
  "in_review",
  "accepted",
  "submitted",
  "rejected",
];

export interface GoldenCongressVolume {
  registrations: NewRegistration[];
  congressSubmissionSettings: (typeof congressSubmissionSettings.$inferInsert)[];
  congressSubmissionKindSettings: (typeof congressSubmissionKindSettings.$inferInsert)[];
  congressSubmissions: (typeof congressSubmissions.$inferInsert)[];
  registrationAttendance: (typeof registrationAttendance.$inferInsert)[];
}

/** Splits «Фамилия Имя Отчество» into the author fields. */
function authorOf(displayName: string, workplace: string, presenting: boolean) {
  const [surname = "", firstName = "", patronymic] = displayName.split(" ");
  return { surname, firstName, patronymic, workplace, presenting };
}

/**
 * Builds the two volume congresses for the resolved «now».
 *
 * `volume` is the volume half (`volume.ts`): its events, doctors and stride
 * registrations, so no doctor passes the forty-эфир ceiling it holds them under.
 */
export function buildGoldenCongressVolume(
  now: Date,
  volume: {
    events: readonly NewEvent[];
    users: readonly NewUser[];
    registrations: readonly NewRegistration[];
  },
): GoldenCongressVolume {
  const at = (offset: Parameters<typeof shiftFromNow>[1]) =>
    shiftFromNow(now, offset);
  const eventOf = (ref: { id: string; state: string }) => {
    const event = volume.events.find((e) => e.id === ref.id);
    if (
      !event ||
      event.state !== ref.state ||
      event.audience !== "doctors" ||
      event.participationFormat !== "offline"
    ) {
      throw new GoldenCongressVolumeError(
        `volume event ${ref.id} is no longer a ${ref.state} offline doctors эфир — the grid moved; pick the congress ordinals again`,
      );
    }
    return event;
  };
  const events = [
    eventOf(GOLDEN_VOLUME_CONGRESSES.past),
    eventOf(GOLDEN_VOLUME_CONGRESSES.upcoming),
  ];

  const held = new Map<string, NewRegistration[]>();
  for (const r of volume.registrations)
    held.set(r.userId, [...(held.get(r.userId) ?? []), r]);
  const registrants = volume.users.filter(
    (u) =>
      u.emailVerified &&
      !u.deletedAt &&
      (held.get(u.id as string) ?? []).length <= 38,
  );

  const registrations: NewRegistration[] = [];
  const submissions: GoldenCongressVolume["congressSubmissions"] = [];
  const attendance: GoldenCongressVolume["registrationAttendance"] = [];
  let ordinal = CONGRESS_REGISTRATION_ORDINAL;
  let submission = 0;

  // 046 EARS-1 / EARS-3 — instants on Moscow day boundaries, as the settings
  // screen writes them.
  const mskDay = (days: number) => goldenMskMidnight(at({ days }));
  // The upcoming congress sits on the pin's Monday grid, so its distance from
  // the pin drifts with the weekday: its intake closes on the Moscow day before
  // it starts, never a fixed «now + N» that could outlast the эфир.
  const upcomingCloses = goldenMskMidnight(
    new Date((events[1]!.startsAt as Date).getTime() - MS_DAY),
  );
  const plans = [
    {
      event: events[0]!,
      startsAt: events[0]!.startsAt as Date,
      statuses: PAST_STATUSES,
      opens: mskDay(-60),
      closes: mskDay(-20),
    },
    {
      event: events[1]!,
      startsAt: events[1]!.startsAt as Date,
      statuses: UPCOMING_STATUSES,
      opens: mskDay(-30),
      closes: upcomingCloses,
    },
  ];
  for (const plan of plans) {
    const past = plan.event.state === "ended";
    registrants.forEach((user, d) => {
      const stride = (held.get(user.id as string) ?? []).find(
        (r) => r.eventId === plan.event.id,
      );
      // A cancelled stride registration holds the doctor's one slot on the
      // эфир (`registrations_user_id_event_id_unique`): no submission there.
      if (stride?.recordStatus === "retired") return;
      const createdMs = (user.createdAt as Date).getTime();
      const registeredAt =
        (stride?.registeredAt as Date | undefined) ??
        new Date(
          Math.max(
            createdMs + MS_DAY,
            Math.min(
              plan.startsAt.getTime() - (20 + d * 3) * MS_DAY,
              now.getTime() - (1 + d) * 3_600_000,
            ),
          ),
        );
      const registrationId =
        (stride?.id as string | undefined) ??
        goldenUuid(
          GOLDEN_GROUP.registrations,
          GOLDEN_VOLUME_ORDINAL_BASE + ordinal++,
        );
      if (!stride) {
        registrations.push({
          id: registrationId,
          userId: user.id as string,
          eventId: plan.event.id as string,
          registeredAt,
          recordStatus: "active",
        });
      }
      // 044 EARS-34 — the desk marks the day of a congress that has happened;
      // one registrant in four did not come and has no mark at all.
      if (past && d % 4 !== 3) {
        attendance.push({
          registrationId,
          day: goldenDateOnly(
            new Date(
              goldenMskMidnight(plan.startsAt).getTime() + 3 * 3_600_000,
            ),
          ),
          present: true,
        });
      }

      const status = plan.statuses[d % plan.statuses.length]!;
      const [title, goal] =
        TALKS[(submission + (past ? 0 : 3)) % TALKS.length]!;
      const kind = d % 3 === 2 ? "poster" : "oral";
      // A submission is drafted inside the oral/poster window, after the
      // registration; a doctor who registered after it closed has none.
      const closesMs = Math.min(plan.closes.getTime(), now.getTime());
      const draftedMs =
        Math.max(registeredAt.getTime(), plan.opens.getTime()) + MS_DAY;
      if (draftedMs > closesMs - MS_DAY) return;
      const draftedAt = new Date(draftedMs);
      const sentAt = new Date(
        draftedMs + Math.min(2 * MS_DAY, (closesMs - draftedMs) / 2),
      );
      const decidedAt = new Date(
        sentAt.getTime() +
          Math.min(5 * MS_DAY, (now.getTime() - sentAt.getTime()) / 2),
      );
      const coAuthor = registrants[(d + 1) % registrants.length]!;
      const workplace = WORKPLACES[d % WORKPLACES.length]!;
      const authors = [
        authorOf(user.displayName as string, workplace, kind === "oral"),
        authorOf(
          coAuthor.displayName as string,
          WORKPLACES[(d + 1) % WORKPLACES.length]!,
          false,
        ),
      ];
      const sent = status !== "draft";
      const decided =
        status === "accepted" ||
        status === "rejected" ||
        status === "needs_revision";
      submissions.push({
        id: goldenUuid(
          GOLDEN_GROUP.congressSubmissions,
          GOLDEN_VOLUME_ORDINAL_BASE + 1 + submission++,
        ),
        eventId: plan.event.id as string,
        registrationId,
        userId: user.id as string,
        kind,
        status,
        title,
        authors,
        body:
          kind === "oral"
            ? { goal, summary: SUMMARY }
            : { goal, content: SUMMARY },
        committeeComment:
          status === "needs_revision"
            ? "Уточните размер выборки и период наблюдения в разделе с результатами."
            : status === "rejected"
              ? "Работа не соответствует тематике секций конгресса."
              : null,
        submittedAt: sent ? sentAt : null,
        statusChangedAt: decided ? decidedAt : sent ? sentAt : draftedAt,
        revisionDueAt:
          status === "needs_revision"
            ? goldenMskMidnight(at({ days: 10 }))
            : null,
        recordStatus: "active",
        createdAt: draftedAt,
        updatedAt: decided ? decidedAt : sent ? sentAt : draftedAt,
      });
    });
  }

  return {
    registrations,
    congressSubmissionSettings: events.map((e) => ({
      eventId: e.id as string,
      registrationUrl: null,
      firstAuthorCounts: false,
    })),
    congressSubmissionKindSettings: [
      ...(["oral", "poster"] as const).map((kind) => ({
        eventId: GOLDEN_VOLUME_CONGRESSES.past.id,
        kind,
        opensAt: plans[0]!.opens,
        closesAt: plans[0]!.closes,
        submitLimit: null,
        maxAgeYears: null,
      })),
      ...(["oral", "poster"] as const).map((kind) => ({
        eventId: GOLDEN_VOLUME_CONGRESSES.upcoming.id,
        kind,
        opensAt: plans[1]!.opens,
        closesAt: plans[1]!.closes,
        submitLimit: null,
        maxAgeYears: null,
      })),
      {
        eventId: GOLDEN_VOLUME_CONGRESSES.upcoming.id,
        kind: "abstract" as const,
        opensAt: mskDay(2),
        closesAt: upcomingCloses,
        submitLimit: 3,
        maxAgeYears: null,
      },
    ],
    congressSubmissions: submissions,
    registrationAttendance: attendance,
  };
}
