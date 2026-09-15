// #2213 — the VOLUME half of the golden dataset.
//
// The named catalogue in `ids.ts` carries one row per state, which proves a
// state EXISTS but proves nothing about how the product behaves when it is
// full: a schedule with one upcoming event never paginates, never fills a week
// grid and never shows a month with two эфира in it, and an archive with one
// row never reaches page two. Production data cannot be copied onto a staging
// box (real doctors, real consents), so the substitute has to be a dataset that
// is SHAPED like production — dozens of events months back and forward, every
// entity family in every state, several of each.
//
// Rules this module obeys, all load-bearing:
//   * every instant derives from the ONE resolved «now» (`now.ts`), exactly as
//     `dataset.ts` does — no literal dates, no `Date.now()`;
//   * no randomness of any kind. Every value is either a curated literal or an
//     index-derived function of the row's ordinal, so two builds at the same pin
//     are byte-identical and `pg_dump --data-only` diffs stay meaningful;
//   * ordinals start at `GOLDEN_VOLUME_ORDINAL_BASE` in every `GOLDEN_GROUP`, so
//     volume rows can never collide with (or renumber) the named catalogue;
//   * volume identities are deliberately NOT added to the `golden` catalogue.
//     That catalogue is the published scenario contract; these rows are
//     background population, addressed in bulk by the tests and by the eye.

import type { NewConsentRecord } from "../../schema/consent-records.js";
import type { NewEventRecording } from "../../schema/event-recordings.js";
import type { NewEvent, NewStreamConfigRow } from "../../schema/events.js";
import type { NewRegistration } from "../../schema/registrations.js";
import type {
  NewEventExpert,
  NewEventProject,
  NewExpert,
  NewProject,
} from "../../schema/taxonomy.js";
import type { NewUser } from "../../schema/users.js";
import { GOLDEN_CONSENT_PURPOSES, GOLDEN_CONSENT_VERSION } from "./consent.js";
import type { GoldenDoctorSpecialtyLink } from "./dataset.js";
import { golden, GOLDEN_GROUP, goldenUuid, isGoldenUuid } from "./ids.js";
import { goldenDateOnly, shiftFromNow } from "./now.js";

/**
 * First ordinal the volume half may use, in every group.
 *
 * The named catalogue's highest ordinal is 33 (`consent_records`). A four-digit
 * floor leaves the catalogue room to grow by three orders of magnitude before
 * the two halves could ever meet, and it makes «is this a volume row?» a
 * question the tests can answer from the id alone.
 */
export const GOLDEN_VOLUME_ORDINAL_BASE = 1000;

/**
 * True for a golden uuid minted by this module (ordinal ≥ the volume base).
 *
 * The golden prefix is part of the question: without it any production uuid
 * whose last twelve hex digits happen to exceed the base would answer `true`,
 * and this predicate is exported — it is used to scope assertions and dumps to
 * the volume half, never to classify a row the platform itself created.
 */
export function isGoldenVolumeUuid(id: string): boolean {
  if (!isGoldenUuid(id)) return false;
  const ordinal = Number.parseInt(id.slice(-12), 16);
  return Number.isInteger(ordinal) && ordinal >= GOLDEN_VOLUME_ORDINAL_BASE;
}

/** The volume rows, in the same families the dataset writes. */
export interface GoldenVolume {
  users: NewUser[];
  experts: NewExpert[];
  projects: NewProject[];
  events: NewEvent[];
  streamConfig: NewStreamConfigRow[];
  eventExperts: NewEventExpert[];
  eventProjects: NewEventProject[];
  registrations: NewRegistration[];
  eventRecordings: NewEventRecording[];
  consentRecords: NewConsentRecord[];
  doctorSpecialties: GoldenDoctorSpecialtyLink[];
}

/**
 * Curated event programme: `[title, specialty]`, one entry per volume event.
 *
 * Literal and product-like on purpose. Generated titles («Event 17») make a
 * staging walk unreadable — the operator cannot tell a layout defect from a
 * fixture artefact — and they hide the text-length problems a real catalogue
 * has. The list is also the length contract: one entry = one event.
 */
const VOLUME_PROGRAMME: readonly (readonly [string, string])[] = [
  ["Современные подходы к терапии ХСН", "Кардиология"],
  ["Артериальная гипертензия: цели и тактика", "Кардиология"],
  ["Фибрилляция предсердий: антикоагулянтная терапия", "Кардиология"],
  ["Острый коронарный синдром на догоспитальном этапе", "Кардиология"],
  ["Дислипидемии: от скрининга до статинов", "Кардиология"],
  ["Хроническая ишемия мозга: что доказано", "Неврология"],
  ["Мигрень: профилактика и купирование приступа", "Неврология"],
  ["Эпилепсия взрослых: подбор терапии", "Неврология"],
  ["Болезнь Паркинсона: ранние признаки", "Неврология"],
  ["Ишемический инсульт: терапевтическое окно", "Неврология"],
  ["ГЭРБ: длительная терапия ИПП", "Гастроэнтерология"],
  ["Воспалительные заболевания кишечника", "Гастроэнтерология"],
  ["НАЖБП: диагностика и ведение", "Гастроэнтерология"],
  ["Хронический панкреатит: ферментная терапия", "Гастроэнтерология"],
  [
    "Лекарственные взаимодействия в практике терапевта",
    "Клиническая фармакология",
  ],
  ["Антибиотикотерапия: выбор и деэскалация", "Клиническая фармакология"],
  ["Полипрагмазия у пожилых пациентов", "Гериатрия"],
  ["Саркопения и падения: что может врач", "Гериатрия"],
  ["Ведение беременности высокого риска", "Акушерство и гинекология"],
  ["Преэклампсия: ранняя диагностика", "Акушерство и гинекология"],
  ["Менопаузальная гормональная терапия", "Акушерство и гинекология"],
  ["Периоперационное ведение пациента", "Анестезиология-реаниматология"],
  ["Сепсис: первые шесть часов", "Анестезиология-реаниматология"],
  ["Респираторная поддержка вне ОРИТ", "Анестезиология-реаниматология"],
  ["Атопический дерматит: тактика ведения", "Дерматовенерология"],
  ["Псориаз: биологическая терапия", "Дерматовенерология"],
  ["Акне у взрослых: алгоритмы", "Дерматовенерология"],
  ["ХБП: нефропротекция в амбулаторной практике", "Нефрология"],
  ["Диабетическая нефропатия", "Нефрология"],
  ["Анемии: дифференциальный диагноз", "Гематология"],
  ["Тромбоцитопении в амбулаторной практике", "Гематология"],
  ["Антикоагулянты: ошибки назначения", "Гематология"],
  ["Внебольничная пневмония: маршрутизация", "Инфекционные болезни"],
  ["Хронические вирусные гепатиты", "Инфекционные болезни"],
  ["Вакцинопрофилактика взрослых", "Инфекционные болезни"],
  [
    "Лекарственная аллергия: подтвердить или снять",
    "Аллергология и иммунология",
  ],
  ["Бронхиальная астма: тяжёлое течение", "Аллергология и иммунология"],
  ["Крапивница: когда это не аллергия", "Аллергология и иммунология"],
  ["Скрининг колоректального рака", "Колопроктология"],
  ["Геморрой: консервативная тактика", "Колопроктология"],
  ["Синдром раздражённого кишечника", "Гастроэнтерология"],
  ["Остеопороз: кому и когда лечить", "Гериатрия"],
  ["Старт инсулинотерапии при диабете 2 типа", "Клиническая фармакология"],
  ["Кардиореабилитация после инфаркта", "Кардиология"],
  ["Головокружение: алгоритм первичного звена", "Неврология"],
  ["Хроническая боль: мультимодальный подход", "Анестезиология-реаниматология"],
  ["Ведение пациента после тяжёлой респираторной инфекции", "Инфекционные болезни"],
  ["Нарушения сна у взрослых", "Неврология"],
  ["Железодефицит без анемии", "Гематология"],
  ["Профилактика внезапной сердечной смерти", "Кардиология"],
  ["Гипотиреоз: рутинные ошибки ведения", "Клиническая фармакология"],
  ["Пищевая аллергия у взрослых", "Аллергология и иммунология"],
  ["Ведение пациента с деменцией", "Гериатрия"],
  ["Дерматоскопия для терапевта", "Дерматовенерология"],
  // The «сегодня» эфир — last in the programme because it is last in the plan.
  ["Неотложные состояния в кабинете терапевта", "Терапия"],
];

/** Descriptions, cycled by ordinal — varied prose, zero randomness. */
const VOLUME_DESCRIPTIONS: readonly string[] = [
  "Практический разбор клинических рекомендаций с ответами на вопросы аудитории.",
  "Клинические случаи из реальной практики и пошаговые алгоритмы ведения.",
  "Обзор доказательной базы и типичных ошибок амбулаторного приёма.",
  "Разбор маршрутизации пациента между амбулаторным и стационарным этапом.",
  "Интерактивная сессия с разбором назначений и лекарственных взаимодействий.",
  "Пошаговый алгоритм: от первичного осмотра до контроля эффективности терапии.",
];

interface VolumeExpertSpec {
  familyName: string;
  givenName: string;
  patronymic: string;
  professionalRole: string;
  credentials: string;
  affiliation: string;
}

const VOLUME_EXPERTS: readonly VolumeExpertSpec[] = [
  {
    familyName: "Иванова",
    givenName: "Мария",
    patronymic: "Сергеевна",
    professionalRole: "Заведующая отделением кардиологии",
    credentials: "к.м.н.",
    affiliation: "Городская клиническая больница",
  },
  {
    familyName: "Кузнецов",
    givenName: "Андрей",
    patronymic: "Владимирович",
    professionalRole: "Профессор кафедры неврологии",
    credentials: "д.м.н., профессор",
    affiliation: "Медицинский университет",
  },
  {
    familyName: "Смирнова",
    givenName: "Елена",
    patronymic: "Борисовна",
    professionalRole: "Доцент кафедры гастроэнтерологии",
    credentials: "к.м.н., доцент",
    affiliation: "Медико-стоматологический университет",
  },
  {
    familyName: "Орлов",
    givenName: "Сергей",
    patronymic: "Николаевич",
    professionalRole: "Клинический фармаколог",
    credentials: "к.м.н.",
    affiliation: "НМИЦ терапии и профилактической медицины",
  },
  {
    familyName: "Морозова",
    givenName: "Ольга",
    patronymic: "Дмитриевна",
    professionalRole: "Врач акушер-гинеколог высшей категории",
    credentials: "к.м.н.",
    affiliation: "Перинатальный центр",
  },
  {
    familyName: "Гаврилов",
    givenName: "Пётр",
    patronymic: "Ильич",
    professionalRole: "Заведующий отделением реанимации",
    credentials: "д.м.н.",
    affiliation: "НИИ скорой помощи",
  },
  {
    familyName: "Белова",
    givenName: "Наталья",
    patronymic: "Викторовна",
    professionalRole: "Врач-дерматовенеролог",
    credentials: "к.м.н.",
    affiliation: "Центр дерматовенерологии и косметологии",
  },
  {
    familyName: "Зайцев",
    givenName: "Максим",
    patronymic: "Олегович",
    professionalRole: "Врач-нефролог",
    credentials: "к.м.н.",
    affiliation: "Федеральный медико-биологический центр",
  },
];

interface VolumeProjectSpec {
  kind: "school" | "media";
  title: string;
  description: string;
}

const VOLUME_PROJECTS: readonly VolumeProjectSpec[] = [
  {
    kind: "school",
    title: "Школа кардиолога: практикум",
    description:
      "Годовой цикл разборов по кардиологии: от амбулаторного приёма до неотложных состояний.",
  },
  {
    kind: "school",
    title: "Школа неврологии",
    description:
      "Систематический курс по ведению пациентов с цереброваскулярной и болевой патологией.",
  },
  {
    kind: "school",
    title: "Школа терапевта: клинические разборы",
    description:
      "Междисциплинарные разборы для врачей первичного звена и врачей общей практики.",
  },
  {
    kind: "media",
    title: "Разбор недели",
    description:
      "Короткие выпуски о новых клинических рекомендациях и изменениях в практике.",
  },
  {
    kind: "media",
    title: "Клинические алгоритмы",
    description:
      "Подкаст-серия: один алгоритм ведения за выпуск, без теоретических отступлений.",
  },
];

/** Volume doctors, by ordinal. Thirteen names, thirteen specialties. */
const VOLUME_DOCTORS: readonly (readonly [string, string])[] = [
  ["Волкова Ирина Анатольевна", "Кардиология"],
  ["Лебедев Артём Сергеевич", "Неврология"],
  ["Новикова Светлана Игоревна", "Гастроэнтерология"],
  ["Фёдоров Денис Валерьевич", "Клиническая фармакология"],
  ["Егорова Татьяна Петровна", "Акушерство и гинекология"],
  ["Медведев Кирилл Андреевич", "Анестезиология-реаниматология"],
  ["Николаева Юлия Романовна", "Дерматовенерология"],
  ["Степанов Олег Витальевич", "Нефрология"],
  ["Макарова Алина Дмитриевна", "Гематология"],
  ["Тарасов Виктор Леонидович", "Инфекционные болезни"],
  ["Киселёва Дарья Максимовна", "Гериатрия"],
  ["Романов Глеб Эдуардович", "Колопроктология"],
  ["Полякова Вера Николаевна", "Аллергология и иммунология"],
];

/**
 * How many volume doctors carry each user state.
 *
 * ≥2 per state, so a scenario that retires or filters one still has another to
 * compare against — a single row per state cannot tell «the filter works» from
 * «the list is empty».
 */
const VOLUME_VERIFIED_DOCTORS = 8;
const VOLUME_UNVERIFIED_DOCTORS = 3;
/** The remaining doctors are soft-deleted (`retired` + `deleted_at`). */

/** Event-expert roles, by presentation slot. */
const VOLUME_EXPERT_ROLES = ["Спикер", "Модератор", "Эксперт"] as const;

/** The state plan: how the 55 programme entries are distributed. */
const UPCOMING_COUNT = 16;
const LIVE_COUNT = 2;
const DRAFT_COUNT = 3;
const HIDDEN_COUNT = 3;
const ENDED_COUNT = 22;
const ARCHIVED_COUNT = 8;

/** Offsets, in days, for the states that do not need a formula. */
const DRAFT_OFFSETS = [5, 12, 19] as const;
const HIDDEN_OFFSETS = [9, 23, 40] as const;
/** The two live rooms, minutes before the pin — far from the boundary. */
const LIVE_OFFSETS_MIN = [-20, -45] as const;

interface VolumeEventPlan {
  index: number;
  state: NonNullable<NewEvent["state"]>;
  /** Whether the event carries a recording (ended-with-recording, or archived). */
  recorded: boolean;
  /** The recording exists but is still a draft — so nothing is PUBLISHED yet. */
  draftOnlyRecording?: boolean;
  /** Days from the pin — the anchor every child row of this event derives from. */
  offsetDays: number;
  startsAt: Date;
  liveAt?: Date;
  recordingExpectedBy?: string;
}

/**
 * Builds every volume row for the resolved «now».
 *
 * Deterministic in its only argument: same `now` ⇒ byte-identical output.
 */
export function buildGoldenVolume(now: Date): GoldenVolume {
  const at = (offset: Parameters<typeof shiftFromNow>[1]) =>
    shiftFromNow(now, offset);

  const plans = planVolumeEvents(now, at);
  if (plans.length !== VOLUME_PROGRAMME.length) {
    throw new RangeError(
      `golden volume plan covers ${plans.length} events but the programme carries ${VOLUME_PROGRAMME.length}`,
    );
  }

  const experts = buildExperts(at);
  const projects = buildProjects(at);
  const events = plans.map((plan) => buildEvent(plan, at));
  const streamConfig = buildStreamConfig(plans);
  const eventExperts = buildEventExperts(plans, at);
  const eventProjects = buildEventProjects(plans, at);
  const users = buildDoctors(at);
  const registrations = buildRegistrations(plans, at);
  const eventRecordings = buildRecordings(plans, at);
  const consentRecords = buildConsents(at);
  const doctorSpecialties = buildDoctorSpecialties(at);

  return {
    users,
    experts,
    projects,
    events,
    streamConfig,
    eventExperts,
    eventProjects,
    registrations,
    eventRecordings,
    consentRecords,
    doctorSpecialties,
  };
}

type At = (offset: Parameters<typeof shiftFromNow>[1]) => Date;

/**
 * The event plan: which programme entry lands in which state, and when.
 *
 * Upcoming events sit on a strict weekly grid (`+3 + 7k` days) so BOTH calendar
 * views the schedule offers are populated — every one of the next sixteen ISO
 * weeks has an эфир, and the four months those weeks span each have several.
 * The grid alone leaves two holes, both closed by the «сегодня» row appended
 * last: today is a schedule state the nearest grid row (three days out) never
 * reaches, and a seed run in the last days of a month puts the whole grid in
 * the NEXT month, leaving the doctor's «этот месяц» view empty — the exact
 * symptom #2212/#2213 exist to prevent.
 * Ended events walk backwards on a nine-day stride, which puts at least one row
 * in every one of the previous six months whatever day the pin falls on.
 */
function planVolumeEvents(now: Date, at: At): VolumeEventPlan[] {
  const plans: VolumeEventPlan[] = [];
  let index = 0;

  for (let k = 0; k < UPCOMING_COUNT; k += 1, index += 1) {
    plans.push({
      index,
      state: "published",
      recorded: false,
      offsetDays: 3 + 7 * k,
      startsAt: at({ days: 3 + 7 * k }),
    });
  }

  for (let k = 0; k < LIVE_COUNT; k += 1, index += 1) {
    const startsAt = at({ minutes: LIVE_OFFSETS_MIN[k] as number });
    plans.push({
      index,
      state: "live",
      recorded: false,
      offsetDays: 0,
      startsAt,
      liveAt: startsAt,
    });
  }

  for (let k = 0; k < DRAFT_COUNT; k += 1, index += 1) {
    plans.push({
      index,
      state: "draft",
      recorded: false,
      offsetDays: DRAFT_OFFSETS[k] as number,
      startsAt: at({ days: DRAFT_OFFSETS[k] as number }),
    });
  }

  for (let k = 0; k < HIDDEN_COUNT; k += 1, index += 1) {
    plans.push({
      index,
      state: "hidden",
      recorded: false,
      offsetDays: HIDDEN_OFFSETS[k] as number,
      startsAt: at({ days: HIDDEN_OFFSETS[k] as number }),
    });
  }

  let recordedEnded = 0;
  let dated = 0;
  for (let k = 0; k < ENDED_COUNT; k += 1, index += 1) {
    const days = -8 - 9 * k;
    const startsAt = at({ days });
    // Two ended events in three got their recording; the rest are the «запись
    // готовится» plaque, which is a state the archive has to render too. One
    // recorded event in four is still a DRAFT montage — published to nobody, so
    // the доктор sees the same plaque.
    const recorded = k % 3 !== 2;
    const draftOnly = recorded && recordedEnded % 4 === 3;
    if (recorded) recordedEnded += 1;
    const plan: VolumeEventPlan = {
      index,
      state: "ended",
      recorded,
      offsetDays: days,
      startsAt,
      liveAt: startsAt,
    };
    if (draftOnly) plan.draftOnlyRecording = true;
    if (!recorded || draftOnly) {
      // The DATED plaque is projected ONLY when the event has no PUBLISHED
      // recording (`recordings.projection.ts` reads the column exactly on the
      // rows whose LEFT JOIN found nothing), so the promise belongs to these
      // rows and to no other. The first five promise a date still ahead of the
      // pin; the older ones are deliberately overdue, because «обещанная дата
      // уже прошла» is its own rendered state.
      const expectedDays = dated < 5 ? 2 + dated * 3 : days + 14;
      dated += 1;
      plan.recordingExpectedBy = goldenDateOnly(at({ days: expectedDays }));
    }
    plans.push(plan);
  }

  for (let k = 0; k < ARCHIVED_COUNT; k += 1, index += 1) {
    const days = -210 - 25 * k;
    const startsAt = at({ days });
    // An archived эфир always carries a published recording: `hidden ->
    // in_archive` is offered only when one exists (014 EARS-25), so an archive
    // row without it is a shape the product cannot produce — and it renders as
    // a permanent «запись готовится» card in «Прошедшие».
    plans.push({
      index,
      state: "in_archive",
      recorded: true,
      offsetDays: days,
      startsAt,
      liveAt: startsAt,
    });
  }

  // «Сегодня» — six hours out, appended last so no existing volume ordinal
  // moves. See `upcomingTodayStart` for why it is not simply `at({ hours: 6 })`.
  plans.push({
    index,
    state: "published",
    recorded: false,
    offsetDays: 0,
    startsAt: upcomingTodayStart(now, at),
  });

  return plans;
}

/**
 * Start of the «сегодня» эфир: six hours after the pin.
 *
 * Six hours can land in the NEXT calendar month when the seed runs late on the
 * last day of one, which is precisely the case this row exists to cover. In
 * that window it moves to the midpoint between the pin and the month's last
 * instant instead — still today, still strictly ahead of «now», and still
 * inside the month the doctor is looking at.
 */
function upcomingTodayStart(now: Date, at: At): Date {
  const sixHours = at({ hours: 6 });
  const monthEnd =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1;
  if (sixHours.getTime() <= monthEnd) return sixHours;
  return new Date(now.getTime() + Math.ceil((monthEnd - now.getTime()) / 2));
}

function buildEvent(plan: VolumeEventPlan, at: At): NewEvent {
  const i = plan.index;
  const entry = VOLUME_PROGRAMME[i] as readonly [string, string];
  const [title, specialty] = entry;
  // `legacy` is the discriminator of the archive machine (014 §3.1): only an
  // archived эфир may carry it, and it must never acquire a room record.
  const origin = plan.state === "in_archive" ? "legacy" : "platform";
  const participationFormat =
    plan.state === "live"
      ? "online"
      : (["online", "offline", "hybrid"] as const)[i % 3];
  const row: NewEvent = {
    id: goldenUuid(GOLDEN_GROUP.events, GOLDEN_VOLUME_ORDINAL_BASE + i),
    slug: `golden-volume-event-${i + 1}`,
    title,
    school: "Doctor.School",
    startsAt: plan.startsAt,
    durationMin: 45 + (i % 4) * 15,
    description: VOLUME_DESCRIPTIONS[
      i % VOLUME_DESCRIPTIONS.length
    ] as string,
    specialties: i % 3 === 0 ? [specialty, "Терапия"] : [specialty],
    state: plan.state,
    origin,
    participationFormat,
    // Only a format with a room to fill has seats to run out of; one offline
    // event in eleven is «мест нет», which is the state the format block's
    // sold-out copy needs.
    seatsLeft:
      participationFormat === "online" ? null : i % 11 === 0 ? 0 : 20 + (i % 7) * 15,
    version: 1,
    recordStatus: "active",
    createdAt: at({ days: -120 - (i % 30) }),
    updatedAt: at({ days: -2 - (i % 20) }),
  };
  if (plan.liveAt) row.liveAt = plan.liveAt;
  if (plan.recordingExpectedBy) {
    row.recordingExpectedBy = plan.recordingExpectedBy;
  }
  return row;
}

function buildExperts(at: At): NewExpert[] {
  return VOLUME_EXPERTS.map((spec, i) => ({
    id: goldenUuid(GOLDEN_GROUP.experts, GOLDEN_VOLUME_ORDINAL_BASE + i),
    slug: `golden-volume-expert-${i + 1}`,
    familyName: spec.familyName,
    givenName: spec.givenName,
    patronymic: spec.patronymic,
    professionalRole: spec.professionalRole,
    credentials: spec.credentials,
    affiliation: spec.affiliation,
    bio: `${spec.professionalRole}. Ведёт эфиры и клинические разборы на платформе.`,
    status: "published" as const,
    firstPublishedAt: at({ days: -120 - i * 5 }),
    version: 1,
    createdAt: at({ days: -150 - i * 5 }),
    updatedAt: at({ days: -120 - i * 5 }),
  }));
}

function buildProjects(at: At): NewProject[] {
  return VOLUME_PROJECTS.map((spec, i) => ({
    id: goldenUuid(GOLDEN_GROUP.projects, GOLDEN_VOLUME_ORDINAL_BASE + i),
    slug: `golden-volume-project-${i + 1}`,
    kind: spec.kind,
    title: spec.title,
    description: spec.description,
    status: "published" as const,
    firstPublishedAt: at({ days: -140 - i * 7 }),
    version: 1,
    createdAt: at({ days: -160 - i * 7 }),
    updatedAt: at({ days: -140 - i * 7 }),
  }));
}

/**
 * Speakers per event: one to three, chosen by three co-prime index strides.
 *
 * The strides are what make the distribution even without a random generator —
 * every expert ends up on at least six events, so an expert page is never a
 * single-row page either.
 */
function expertSlotsFor(i: number): number[] {
  const slots = [i % VOLUME_EXPERTS.length];
  if (i % 2 === 1) slots.push((i * 3 + 1) % VOLUME_EXPERTS.length);
  if (i % 3 === 0) slots.push((i * 5 + 2) % VOLUME_EXPERTS.length);
  return [...new Set(slots)];
}

function projectSlotsFor(i: number): number[] {
  const slots = [i % VOLUME_PROJECTS.length];
  if (i % 2 === 0) slots.push((i * 2 + 1) % VOLUME_PROJECTS.length);
  return [...new Set(slots)];
}

function buildEventExperts(plans: VolumeEventPlan[], at: At): NewEventExpert[] {
  const rows: NewEventExpert[] = [];
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  for (const plan of plans) {
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    for (const [position, slot] of expertSlotsFor(plan.index).entries()) {
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.eventExperts, ordinal),
        eventId,
        expertId: goldenUuid(
          GOLDEN_GROUP.experts,
          GOLDEN_VOLUME_ORDINAL_BASE + slot,
        ),
        role: VOLUME_EXPERT_ROLES[position % VOLUME_EXPERT_ROLES.length] as string,
        position,
        status: "active",
        version: 1,
        createdAt: at({ days: -110 - (plan.index % 25) }),
        updatedAt: at({ days: -110 - (plan.index % 25) }),
      });
      ordinal += 1;
    }
  }
  return rows;
}

function buildEventProjects(
  plans: VolumeEventPlan[],
  at: At,
): NewEventProject[] {
  const rows: NewEventProject[] = [];
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  for (const plan of plans) {
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    for (const slot of projectSlotsFor(plan.index)) {
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.eventProjects, ordinal),
        eventId,
        projectId: goldenUuid(
          GOLDEN_GROUP.projects,
          GOLDEN_VOLUME_ORDINAL_BASE + slot,
        ),
        status: "active",
        version: 1,
        createdAt: at({ days: -110 - (plan.index % 25) }),
        updatedAt: at({ days: -110 - (plan.index % 25) }),
      });
      ordinal += 1;
    }
  }
  return rows;
}

function buildStreamConfig(plans: VolumeEventPlan[]): NewStreamConfigRow[] {
  return plans
    // An archived эфир is `legacy`: it has a recording but never a room.
    .filter(
      (plan) =>
        plan.state === "live" || (plan.recorded && plan.state === "ended"),
    )
    .map((plan) => ({
      eventId: goldenUuid(
        GOLDEN_GROUP.events,
        GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
      ),
      provider: "rutube" as const,
      embedRef: `golden-volume-stream-${plan.index + 1}`,
    }));
}

/**
 * Volume doctors.
 *
 * DEVIATION, recorded in the README and the PR body: these thirteen carry a
 * SYNTHETIC `zitadel_sub` (`golden-volume-<ordinal>`) and no identity-provider
 * account. The named five in `ids.ts` stay IdP-backed because scenarios sign in
 * as them; a volume doctor exists to populate a roster, a registration list and
 * an admin table, and provisioning thirteen more real accounts would mean
 * thirteen more secrets on the box for rows nobody signs in as. The subject
 * shape is the precedent `goldenDeletedSubject` already set in
 * `tools/staging/idp.mjs`: deterministic, unique, and impossible to collide with
 * a Zitadel snowflake (which is decimal).
 *
 * MFA multiplicity stays at one: MFA is not a column at all (see `idp.ts`), so a
 * second MFA doctor is a second provisioned IdP account, not a dataset row.
 */
function buildDoctors(at: At): NewUser[] {
  return VOLUME_DOCTORS.map(([displayName], i) => {
    const ordinal = GOLDEN_VOLUME_ORDINAL_BASE + i;
    const verified = i < VOLUME_VERIFIED_DOCTORS;
    const unverified =
      !verified && i < VOLUME_VERIFIED_DOCTORS + VOLUME_UNVERIFIED_DOCTORS;
    const retired = !verified && !unverified;
    const row: NewUser = {
      id: goldenUuid(GOLDEN_GROUP.users, ordinal),
      zitadelSub: `golden-volume-${ordinal}`,
      email: `golden.volume.doctor.${i + 1}@example.test`,
      displayName,
      emailVerified: !unverified,
      phoneVerified: false,
      role: "doctor_guest",
      recordStatus: retired ? "retired" : "active",
      createdAt: at({ days: -200 - i * 3 }),
      updatedAt: at({ days: -10 - i }),
    };
    if (retired) {
      // 018 erasure shape: retired iff deleted (`users_retired_iff_deleted`).
      row.deletedAt = at({ days: -6 - i });
      row.deactivatedAt = at({ days: -6 - i });
    }
    return row;
  });
}

/**
 * Which registrable volume events the two IdP-backed doctors sign up for.
 *
 * The numbers index the REGISTRABLE list below, not the plan, so a slot can
 * never silently become a draft row when the plan grows.
 */
const NAMED_DOCTOR_SLOTS: readonly (readonly [string, readonly number[]])[] = [
  [golden.doctors.verifiedCardiologist.id, [0, 4, 30, 40]],
  [golden.doctors.mfaEnrolled.id, [1, 5, 31]],
];

/**
 * Registrations at volume.
 *
 * Each volume doctor signs up for three events on co-prime strides, which
 * spreads the roster over past AND future events instead of piling it on the
 * nearest one. One registration in seven is `retired` + `deleted_at` — the
 * cancellation shape `registrations_retired_iff_deleted` pins — so the roster
 * read path is exercised with rows it must filter OUT.
 *
 * Only registrable эфиры take a roster: `draft` and `hidden` are refused by
 * `doctor-register.service.ts`, and an archived `legacy` эфир predates the
 * platform's registration flow, so a row on one is a shape production can never
 * hold. `registeredAt` is derived from the EVENT's own offset rather than from
 * a flat window, for the same reason — the ended rows reach two hundred days
 * back, and a registration created after its эфир is equally impossible.
 *
 * The two IdP-backed doctors get their own slots on top, because «мои эфиры» is
 * walked as THEM: a signed-in doctor with three rows proves the list, a doctor
 * with none proves only the empty state.
 */
function buildRegistrations(plans: VolumeEventPlan[], at: At): NewRegistration[] {
  const rows: NewRegistration[] = [];
  const registrable = plans.filter(
    (plan) =>
      plan.state === "published" ||
      plan.state === "live" ||
      plan.state === "ended",
  );
  const total = registrable.length;
  const slotPlan = (slot: number) => registrable[slot % total] as VolumeEventPlan;
  const eventId = (plan: VolumeEventPlan) =>
    goldenUuid(GOLDEN_GROUP.events, GOLDEN_VOLUME_ORDINAL_BASE + plan.index);
  /** Strictly before the эфир starts AND strictly in the past. */
  const registeredDays = (plan: VolumeEventPlan, n: number) =>
    Math.min(-(1 + (n % 30)), plan.offsetDays - (2 + (n % 14)));
  const registeredAt = (plan: VolumeEventPlan, n: number) =>
    at({ days: registeredDays(plan, n) });
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  let n = 0;

  for (let d = 0; d < VOLUME_DOCTORS.length; d += 1) {
    const userId = goldenUuid(
      GOLDEN_GROUP.users,
      GOLDEN_VOLUME_ORDINAL_BASE + d,
    );
    for (const offset of [0, 7, 17]) {
      const plan = slotPlan(d * 3 + offset);
      const row: NewRegistration = {
        id: goldenUuid(GOLDEN_GROUP.registrations, ordinal),
        userId,
        eventId: eventId(plan),
        registeredAt: registeredAt(plan, n),
        recordStatus: n % 7 === 6 ? "retired" : "active",
      };
      if (row.recordStatus === "retired") {
        // Cancelled AFTER it was created and BEFORE «now» — a cancellation
        // instant ahead of its own registration is not a shape a roster has.
        row.deletedAt = at({
          days: Math.min(-1, registeredDays(plan, n) + 1 + (n % 3)),
        });
      }
      rows.push(row);
      ordinal += 1;
      n += 1;
    }
  }

  for (const [userId, slots] of NAMED_DOCTOR_SLOTS) {
    for (const slot of slots) {
      const plan = slotPlan(slot);
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.registrations, ordinal),
        userId,
        eventId: eventId(plan),
        registeredAt: registeredAt(plan, n),
        recordStatus: "active",
      });
      ordinal += 1;
      n += 1;
    }
  }

  return rows;
}

/**
 * Recordings for the ended events that have one.
 *
 * Every publication state appears several times, and BOTH kinds do. The retired
 * rows are the reason the partial unique index exists: a retired `edited`
 * recording keeps its id and its history and stops competing for the event's
 * one active `edited` slot, so an event may legitimately carry both.
 */
function buildRecordings(plans: VolumeEventPlan[], at: At): NewEventRecording[] {
  const rows: NewEventRecording[] = [];
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  let r = 0;

  for (const plan of plans) {
    if (!plan.recorded) continue;
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    const createdAt = at({ days: plan.offsetDays + 2 });
    const publishedAt = at({ days: plan.offsetDays + 5 });
    // Only an ENDED event may carry an unpublished montage: an archived row
    // is in the archive BECAUSE a published recording exists (014 EARS-25), so
    // it gets exactly one, published, and none of the variety below.
    const ended = plan.state === "ended";
    const draftEdited = plan.draftOnlyRecording === true;

    const edited: NewEventRecording = {
      id: goldenUuid(GOLDEN_GROUP.eventRecordings, ordinal),
      eventId,
      kind: "edited",
      provider: "rutube",
      embedRef: `golden-volume-recording-edited-${plan.index + 1}`,
      posterRef: `golden-volume-recording-poster-${plan.index + 1}`,
      durationSec: 1800 + (r % 5) * 600,
      status: draftEdited ? "draft" : "published",
      version: 1,
      createdAt,
      updatedAt: publishedAt,
    };
    if (!draftEdited) edited.firstPublishedAt = publishedAt;
    rows.push(edited);
    ordinal += 1;

    if (ended && r % 3 === 0) {
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.eventRecordings, ordinal),
        eventId,
        kind: "raw",
        provider: "rutube",
        embedRef: `golden-volume-recording-raw-${plan.index + 1}`,
        durationSec: 2400 + (r % 4) * 600,
        status: "draft",
        version: 1,
        createdAt,
        updatedAt: createdAt,
      });
      ordinal += 1;
    }

    if (ended && r % 4 === 0) {
      // A superseded montage: retired, so it no longer occupies the event's
      // active `edited` slot, but its publication instant survives.
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.eventRecordings, ordinal),
        eventId,
        kind: "edited",
        provider: "rutube",
        embedRef: `golden-volume-recording-superseded-${plan.index + 1}`,
        durationSec: 1500 + (r % 3) * 300,
        status: "retired",
        firstPublishedAt: at({ days: plan.offsetDays + 3 }),
        deletedAt: at({ days: plan.offsetDays + 6 }),
        version: 2,
        createdAt,
        updatedAt: at({ days: plan.offsetDays + 6 }),
      });
      ordinal += 1;
    }

    r += 1;
  }

  return rows;
}

function buildConsents(at: At): NewConsentRecord[] {
  const rows: NewConsentRecord[] = [];
  for (let d = 0; d < VOLUME_DOCTORS.length; d += 1) {
    for (const [p, purpose] of GOLDEN_CONSENT_PURPOSES.entries()) {
      rows.push({
        id: goldenUuid(
          GOLDEN_GROUP.consentRecords,
          GOLDEN_VOLUME_ORDINAL_BASE + d * 10 + p,
        ),
        userId: goldenUuid(GOLDEN_GROUP.users, GOLDEN_VOLUME_ORDINAL_BASE + d),
        purpose,
        version: GOLDEN_CONSENT_VERSION,
        capturedAt: at({ days: -200 - d * 3 }),
      });
    }
  }
  return rows;
}

function buildDoctorSpecialties(at: At): GoldenDoctorSpecialtyLink[] {
  return VOLUME_DOCTORS.map(([, specialtyName], d) => ({
    id: goldenUuid(
      GOLDEN_GROUP.doctorSpecialties,
      GOLDEN_VOLUME_ORDINAL_BASE + d,
    ),
    doctorId: goldenUuid(GOLDEN_GROUP.users, GOLDEN_VOLUME_ORDINAL_BASE + d),
    specialtyName,
    createdAt: at({ days: -200 - d * 3 }),
    updatedAt: at({ days: -200 - d * 3 }),
  }));
}
