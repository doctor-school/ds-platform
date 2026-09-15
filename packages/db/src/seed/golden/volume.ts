// #2213 — the VOLUME half of the golden dataset.
//
// The named catalogue in `ids.ts` carries one row per state, which proves a
// state EXISTS but proves nothing about how the product behaves when it is
// full: a schedule with one upcoming event never paginates, never fills a week
// grid and never shows a month with two эфира in it, and an archive with one
// row never reaches page two. Production data cannot be copied onto a staging
// box (real doctors, real consents), so the substitute has to be a dataset that
// is SHAPED like production.
//
// «Production shape» is a decision the owner made on the Stage-B walk of PR
// #2216 and it is not a floor: doctor.school runs эфиры EVERY day. So this
// module lays out a real season — a Monday-anchored calendar that carries two
// or three эфиров on every weekday, a Saturday эфир every other week and a
// monthly Sunday «школа», from six months behind the run instant to four months
// ahead of it. The number of events is an OUTPUT of that shape, never a knob.
//
// Rules this module obeys, all load-bearing:
//   * every instant derives from the ONE resolved «now» (`now.ts`), exactly as
//     `dataset.ts` does — no literal dates, no `Date.now()`;
//   * no randomness of any kind. Every value is either a curated literal or an
//     index-derived function of the row's ordinal, so two builds at the same pin
//     are byte-identical and `pg_dump --data-only` diffs stay meaningful;
//   * the grid is anchored on WEEKS, not on days: the plan holds the same number
//     of cells in the same order at every pin, so an ordinal addresses the same
//     position in the season whatever weekday the seed runs on. What the pin
//     moves is which cells have already happened — which is the one thing that
//     genuinely depends on the run date;
//   * ordinals start at `GOLDEN_VOLUME_ORDINAL_BASE` in every `GOLDEN_GROUP`, so
//     volume rows can never collide with (or renumber) the named catalogue;
//   * every child row is derived from its PARENT's instant, never from a flat
//     window around «now». The season reaches two hundred days back, so a link
//     created «120 days ago» would predate half the эфиры it belongs to;
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
import {
  composeDescription,
  volumeEventTitle,
  VOLUME_EXPERTS,
  VOLUME_PROGRAMME,
  VOLUME_PROJECTS,
} from "./content.js";
import type { GoldenDoctorSpecialtyLink } from "./dataset.js";
import { golden, GOLDEN_GROUP, goldenUuid, isGoldenUuid } from "./ids.js";
import { goldenDateOnly, shiftFromNow } from "./now.js";
import {
  eventProgrammeKey,
  expertPhotoKey,
  hasProgramme,
  programmeTotalMinutes,
} from "./programme.js";

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

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
/** МСК is UTC+3 all year — Russia has had no DST since 2014. */
const MSK_OFFSET_MS = 3 * MS_HOUR;

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

/**
 * How far the season reaches, in whole weeks around the pin's own Monday.
 *
 * Twenty-eight weeks back is 196 days, comfortably past the 184-day worst case
 * of «six calendar months ago»; eighteen forward is 126 days against the
 * 123-day worst case of «four calendar months ahead». Anchoring on weeks rather
 * than on the pin's day is what keeps the plan's LENGTH and ORDER pin-invariant.
 */
const GRID_WEEKS_BACK = 28;
const GRID_WEEKS_AHEAD = 18;

/**
 * Эфиры per weekday, walked by a running weekday counter.
 *
 * Seven entries against five weekdays a week, so the pattern drifts across the
 * grid instead of stamping «Monday is always a two-эфир day» into the calendar.
 */
const WEEKDAY_CADENCE = [2, 3, 2, 3, 3, 2, 3] as const;

/** The two live rooms, minutes before the pin — far from the boundary. */
const LIVE_OFFSETS_MIN = [-20, -45] as const;

/**
 * Share of the past season that has been moved to the archive.
 *
 * The recent past is «Прошедшие» with its recording; the older third is what an
 * editor has since archived, which is the only way `in_archive` + `legacy` is
 * reachable at all.
 */
const ARCHIVE_SHARE_OF_PAST = 0.35;

/**
 * Below this many curated titles the season cannot be laid out at all.
 *
 * The bank is consumed by `volumeEventTitle`, which re-runs it as numbered
 * editions once walked through — so the plan can exceed the bank, but a bank
 * that had shrunk to a handful of entries would title a whole season from four
 * stems and read as a fixture again.
 */
const VOLUME_TITLE_BANK_FLOOR = 100;

/** МСК minutes-from-midnight of each эфир of a day, ascending. */
function slotMinutes(count: number, day: number): number[] {
  if (count === 2) {
    return [day % 2 === 1 ? 13 * 60 : 16 * 60, 19 * 60 + 30];
  }
  return [day % 2 === 1 ? 13 * 60 : 11 * 60, 18 * 60, 19 * 60 + 30];
}

/** One cell of the season grid, carrying the coordinates its state reads. */
interface GridCell {
  startsAt: Date;
  /** Week offset from the pin's own Monday; 0 is the week the seed runs in. */
  week: number;
  /** 0 = Monday … 6 = Sunday, in МСК. */
  day: number;
  /** Position of the эфир inside its own day. */
  slot: number;
}

interface VolumeEventPlan {
  index: number;
  state: NonNullable<NewEvent["state"]>;
  /** Whether the event carries a recording (ended-with-recording, or archived). */
  recorded: boolean;
  /** The recording exists but is still a draft — so nothing is PUBLISHED yet. */
  draftOnlyRecording?: boolean;
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

  if (VOLUME_PROGRAMME.length < VOLUME_TITLE_BANK_FLOOR) {
    throw new RangeError(
      `golden volume needs at least ${VOLUME_TITLE_BANK_FLOOR} curated titles, the bank carries ${VOLUME_PROGRAMME.length}`,
    );
  }

  const plans = planVolumeEvents(now);

  const experts = buildExperts(at);
  const projects = buildProjects(at);
  const events = plans.map((plan) => buildEvent(plan, now));
  const streamConfig = buildStreamConfig(plans);
  const eventExperts = buildEventExperts(plans, now);
  const eventProjects = buildEventProjects(plans, now);
  const users = buildDoctors(at);
  const registrations = buildRegistrations(plans, users, now);
  const eventRecordings = buildRecordings(plans, now);
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
 * The season grid: every эфир of the calendar, oldest first.
 *
 * Anchored on the МСК Monday that owns the pin's own day, so the grid lands on
 * real weekdays — a doctor looking at the schedule sees a working week and a
 * quiet weekend, not a five-on/two-off rhythm marching diagonally through the
 * month. Every slot is between 10:00 and 19:30 МСК, which keeps the UTC date of
 * an эфир equal to its МСК date and lets every consumer bucket by either.
 */
function gridCells(now: Date): GridCell[] {
  const mskMidnight =
    Math.floor((now.getTime() + MSK_OFFSET_MS) / MS_DAY) * MS_DAY;
  const dow = new Date(mskMidnight).getUTCDay(); // 0 = Sunday
  const monday = mskMidnight - ((dow + 6) % 7) * MS_DAY;

  const cells: GridCell[] = [];
  let weekdayCounter = 0;
  let dayCounter = 0;
  for (let week = -GRID_WEEKS_BACK; week <= GRID_WEEKS_AHEAD; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const dayStart = monday + (week * 7 + day) * MS_DAY;
      const push = (minutes: number, slot: number) =>
        cells.push({
          startsAt: new Date(dayStart + minutes * MS_MINUTE - MSK_OFFSET_MS),
          week,
          day,
          slot,
        });
      if (day <= 4) {
        const count = WEEKDAY_CADENCE[
          weekdayCounter % WEEKDAY_CADENCE.length
        ] as number;
        weekdayCounter += 1;
        for (const [slot, minutes] of slotMinutes(count, dayCounter).entries()) {
          push(minutes, slot);
        }
      } else if (day === 5) {
        // A Saturday эфир every other week — the weekend is lighter, not empty.
        if (week % 2 === 0) push(11 * 60, 0);
      } else if (week % 4 === 0) {
        // One Sunday «школа» a month: the long-format weekend event.
        push(10 * 60, 0);
      }
      dayCounter += 1;
    }
  }
  return cells;
}

/**
 * The event plan: which cell of the season is in which state.
 *
 * State follows POSITION ON THE TIMELINE, because that is what the product
 * itself does: an эфир that has not happened is `published`, one that has is
 * `ended`, and the older third of the past has since been archived. Nothing
 * here picks a state to satisfy a floor.
 *
 * Three rows are appended after the grid, in a fixed order, so no grid ordinal
 * ever moves: two `live` rooms (the room happy path has to be reachable at any
 * pin, and a grid cell is only «live» for ninety minutes a week) and one эфир
 * later TODAY. Today is a schedule state of its own — the badge, the countdown
 * and the «начнётся сегодня» copy are reachable through nothing else — and on a
 * pin in the last hours of a month it is also what keeps «этот месяц»
 * non-empty, which is the symptom #2212/#2213 exist to prevent.
 */
function planVolumeEvents(now: Date): VolumeEventPlan[] {
  const nowMs = now.getTime();
  const cells = gridCells(now);
  const pastCount = cells.filter((cell) => cell.startsAt.getTime() <= nowMs)
    .length;
  const archiveCount = Math.floor(pastCount * ARCHIVE_SHARE_OF_PAST);

  const plans: VolumeEventPlan[] = [];
  let past = 0;
  let dated = 0;

  for (const cell of cells) {
    const index = plans.length;
    const startMs = cell.startsAt.getTime();

    if (startMs > nowMs) {
      // One draft and one hidden эфир per month of the future, on fixed
      // coordinates: both are admin-only states, so the stand needs a handful,
      // not a share. They take the FIRST slot of a day that carries two or
      // three, so the day still shows the doctor a published эфир.
      let state: NonNullable<NewEvent["state"]> = "published";
      if (cell.week > 0 && cell.slot === 0) {
        if (cell.week % 4 === 1 && cell.day === 1) state = "draft";
        else if (cell.week % 4 === 3 && cell.day === 3) state = "hidden";
      }
      plans.push({ index, state, recorded: false, startsAt: cell.startsAt });
      continue;
    }

    if (past < archiveCount) {
      // An archived эфир always carries a published recording: `hidden ->
      // in_archive` is offered only when one exists (014 EARS-25), so an archive
      // row without it is a shape the product cannot produce — and it renders as
      // a permanent «запись готовится» card in «Прошедшие».
      plans.push({
        index,
        state: "in_archive",
        recorded: true,
        startsAt: cell.startsAt,
        liveAt: cell.startsAt,
      });
      past += 1;
      continue;
    }

    // Seven ended эфиров in ten got their recording; the rest are the «запись
    // готовится» plaque, which is a state the archive has to render too. One
    // recorded эфир in thirteen is still a DRAFT montage — published to nobody,
    // so the доктор sees the same plaque.
    const recorded = past % 10 < 7;
    const draftOnly = recorded && past % 13 === 5;
    const plan: VolumeEventPlan = {
      index,
      state: "ended",
      recorded,
      startsAt: cell.startsAt,
      liveAt: cell.startsAt,
    };
    if (draftOnly) plan.draftOnlyRecording = true;
    if (!recorded || draftOnly) {
      // The DATED plaque is projected ONLY when the event has no PUBLISHED
      // recording (`recordings.projection.ts` reads the column exactly on the
      // rows whose LEFT JOIN found nothing), so the promise belongs to these
      // rows and to no other. A recent эфир promises a date still ahead of the
      // pin; an older one is deliberately overdue, because «обещанная дата уже
      // прошла» is its own rendered state.
      const recent = nowMs - startMs <= 20 * MS_DAY;
      plan.recordingExpectedBy = goldenDateOnly(
        recent
          ? new Date(nowMs + (2 + (dated % 12)) * MS_DAY)
          : new Date(startMs + 14 * MS_DAY),
      );
      dated += 1;
    }
    plans.push(plan);
    past += 1;
  }

  for (const minutes of LIVE_OFFSETS_MIN) {
    const startsAt = new Date(nowMs + minutes * MS_MINUTE);
    plans.push({
      index: plans.length,
      state: "live",
      recorded: false,
      startsAt,
      liveAt: startsAt,
    });
  }

  plans.push({
    index: plans.length,
    state: "published",
    recorded: false,
    startsAt: upcomingTodayStart(now),
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
function upcomingTodayStart(now: Date): Date {
  const sixHours = new Date(now.getTime() + 6 * MS_HOUR);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1;
  if (sixHours.getTime() <= monthEnd) return sixHours;
  return new Date(now.getTime() + Math.ceil((monthEnd - now.getTime()) / 2));
}

/**
 * When the editor created the event row.
 *
 * Clamped to the pin for a future эфир: the season reaches four months ahead,
 * and an эфир «created» thirty days before it happens would have been created
 * three months from now.
 */
function eventCreatedMs(plan: VolumeEventPlan, nowMs: number): number {
  return (
    Math.min(plan.startsAt.getTime(), nowMs) -
    (30 + (plan.index % 45)) * MS_DAY
  );
}

function buildEvent(plan: VolumeEventPlan, now: Date): NewEvent {
  const i = plan.index;
  const nowMs = now.getTime();
  const startMs = plan.startsAt.getTime();
  const { title, specialty } = volumeEventTitle(i);
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
    // The эфир's length is its programme's length, not an independent number:
    // an эфир advertising 45 minutes while handing out a seven-session
    // programme is the PR #2216 defect with more paper.
    durationMin: programmeTotalMinutes(i),
    description: composeDescription(i, specialty),
    specialties: i % 3 === 0 ? [specialty, "Терапия"] : [specialty],
    state: plan.state,
    origin,
    participationFormat,
    // Only a format with a room to fill has seats to run out of; one offline
    // event in eleven is «мест нет», which is the state the format block's
    // sold-out copy needs.
    seatsLeft:
      participationFormat === "online"
        ? null
        : i % 11 === 0
          ? 0
          : 20 + (i % 7) * 15,
    version: 1,
    recordStatus: "active",
    createdAt: new Date(eventCreatedMs(plan, nowMs)),
    // Last touched shortly after the эфир ran, or — for one still ahead —
    // within the last few hours, which is what an active editorial calendar
    // looks like.
    updatedAt: new Date(
      Math.min(startMs + 2 * MS_DAY, nowMs) - (1 + (i % 10)) * MS_HOUR,
    ),
  };
  if (hasProgramme(plan.state, i)) {
    row.programPdfRef = eventProgrammeKey(GOLDEN_VOLUME_ORDINAL_BASE + i);
  }
  if (plan.liveAt) row.liveAt = plan.liveAt;
  if (plan.recordingExpectedBy) {
    row.recordingExpectedBy = plan.recordingExpectedBy;
  }
  return row;
}

/**
 * The expert catalogue.
 *
 * Published well before the oldest эфир of the season: an expert first
 * published after the эфир they spoke at is a shape the editorial flow cannot
 * produce, and the season now reaches two hundred days back.
 */
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
    bio: spec.bio,
    photoRef: expertPhotoKey(GOLDEN_VOLUME_ORDINAL_BASE + i),
    status: "published" as const,
    firstPublishedAt: at({ days: -300 - i * 3 }),
    version: 1,
    createdAt: at({ days: -320 - i * 3 }),
    updatedAt: at({ days: -300 - i * 3 }),
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
    firstPublishedAt: at({ days: -310 - i * 4 }),
    version: 1,
    createdAt: at({ days: -330 - i * 4 }),
    updatedAt: at({ days: -310 - i * 4 }),
  }));
}

/**
 * Speakers per event: TWO to four, chosen by four co-prime index strides.
 *
 * Two is the floor because one is not a panel: the owner's Stage-B verdict on
 * PR #2216 named single-speaker эфиры as part of what made the stand read as a
 * fixture. The first two strides always fire, so `VOLUME_EXPERT_ROLES` puts a
 * Модератор in position 1 on EVERY event; the third and fourth add an Эксперт
 * and a second Спикер on a schedule that is neither constant nor aligned.
 *
 * The strides are what make the distribution even without a random generator —
 * every expert ends up on dozens of events, so an expert page is never a
 * single-row page either.
 */
function expertSlotsFor(i: number): number[] {
  const n = VOLUME_EXPERTS.length;
  const slots = [i % n, (i * 7 + 3) % n];
  if (i % 3 !== 2) slots.push((i * 11 + 5) % n);
  if (i % 5 === 0) slots.push((i * 13 + 9) % n);
  return [...new Set(slots)];
}

function projectSlotsFor(i: number): number[] {
  const slots = [i % VOLUME_PROJECTS.length];
  if (i % 2 === 0) slots.push((i * 2 + 1) % VOLUME_PROJECTS.length);
  return [...new Set(slots)];
}

/** A link is attached to the event a few days after the event row was created. */
function linkCreatedAt(plan: VolumeEventPlan, nowMs: number): Date {
  return new Date(
    eventCreatedMs(plan, nowMs) + (1 + (plan.index % 5)) * MS_DAY,
  );
}

function buildEventExperts(
  plans: VolumeEventPlan[],
  now: Date,
): NewEventExpert[] {
  const rows: NewEventExpert[] = [];
  const nowMs = now.getTime();
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  for (const plan of plans) {
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    const createdAt = linkCreatedAt(plan, nowMs);
    for (const [position, slot] of expertSlotsFor(plan.index).entries()) {
      rows.push({
        id: goldenUuid(GOLDEN_GROUP.eventExperts, ordinal),
        eventId,
        expertId: goldenUuid(
          GOLDEN_GROUP.experts,
          GOLDEN_VOLUME_ORDINAL_BASE + slot,
        ),
        role: VOLUME_EXPERT_ROLES[
          position % VOLUME_EXPERT_ROLES.length
        ] as string,
        position,
        status: "active",
        version: 1,
        createdAt,
        updatedAt: createdAt,
      });
      ordinal += 1;
    }
  }
  return rows;
}

function buildEventProjects(
  plans: VolumeEventPlan[],
  now: Date,
): NewEventProject[] {
  const rows: NewEventProject[] = [];
  const nowMs = now.getTime();
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  for (const plan of plans) {
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    const createdAt = linkCreatedAt(plan, nowMs);
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
        createdAt,
        updatedAt: createdAt,
      });
      ordinal += 1;
    }
  }
  return rows;
}

function buildStreamConfig(plans: VolumeEventPlan[]): NewStreamConfigRow[] {
  return (
    plans
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
      }))
  );
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
 * They are registered more than a year before the pin, because a doctor holding
 * up to forty registrations across a season that reaches two hundred days back
 * has to have existed before the oldest of them.
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
      createdAt: at({ days: -400 - i * 3 }),
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
 * Prime strides, each larger than any registrable season.
 *
 * A stride larger than the pool and prime is co-prime with it, so `k * stride
 * mod total` visits `total` distinct slots before it repeats — which is how a
 * doctor gets up to forty DISTINCT registrations with no random source and no
 * `Set` dedupe. `REGISTRATION_POOL_CEILING` is the assumption made explicit: a
 * season that outgrew it would silently start handing out duplicates.
 */
const REGISTRATION_STRIDES = [
  1009, 1013, 1019, 1021, 1031, 1033, 1039, 1049, 1051, 1061, 1063, 1069, 1087,
] as const;
const REGISTRATION_POOL_CEILING = 1009;

/**
 * How many эфиров each IdP-backed doctor holds.
 *
 * Twelve rather than the volume doctors' fifteen-to-forty: «мои эфиры» is
 * WALKED as these two, so the list has to be long enough to prove the list and
 * short enough to read on one screen.
 */
const NAMED_DOCTOR_REGISTRATIONS = 12;

/**
 * When the named catalogue doctors were created (`dataset.ts`).
 *
 * Mirrored rather than imported because `dataset.ts` imports THIS module. The
 * `#2213: never registers a doctor before their account existed` assertion is
 * what keeps the mirror honest if the catalogue moves.
 */
const NAMED_DOCTOR_CREATED_DAYS = -90;

interface RegistrationHolder {
  userId: string;
  createdMs: number;
  /** The account's own erasure instant — no registration may outlive it. */
  untilMs: number;
  count: number;
}

/**
 * Registrations at volume.
 *
 * Every doctor holds fifteen to forty эфиров spread over the whole season —
 * past AND future — on a prime stride, which is what a real account looks like
 * after a few months and what the owner's Stage-B walk found missing. One
 * registration in ten is `retired` + `deleted_at` — the cancellation shape
 * `registrations_retired_iff_deleted` pins — so the roster read path is
 * exercised with rows it must filter OUT.
 *
 * Every row is reachable by the product that would have written it:
 *   * only `published`, `live` and `ended` эфиры take a roster — `draft` and
 *     `hidden` are refused by `doctor-register.service.ts`, and an archived
 *     `legacy` эфир predates the registration flow entirely;
 *   * `registered_at` is strictly after the doctor's account was created, and
 *     strictly before BOTH the эфир and «now»;
 *   * a retired doctor stopped registering when the account was erased, so
 *     their window closes at `deleted_at` rather than at «now».
 */
function buildRegistrations(
  plans: VolumeEventPlan[],
  users: NewUser[],
  now: Date,
): NewRegistration[] {
  const nowMs = now.getTime();
  const registrable = plans.filter(
    (plan) =>
      plan.state === "published" ||
      plan.state === "live" ||
      plan.state === "ended",
  );

  const holders: RegistrationHolder[] = users.map((user, d) => ({
    userId: user.id as string,
    createdMs: (user.createdAt as Date).getTime(),
    untilMs: Math.min(
      nowMs,
      user.deletedAt instanceof Date ? user.deletedAt.getTime() : nowMs,
    ),
    // Fifteen to forty, walked by a stride co-prime with 26 so no two adjacent
    // doctors hold the same number of эфиров.
    count: 15 + ((d * 7) % 26),
  }));
  for (const userId of [
    golden.doctors.verifiedCardiologist.id,
    golden.doctors.mfaEnrolled.id,
  ]) {
    holders.push({
      userId,
      createdMs: nowMs + NAMED_DOCTOR_CREATED_DAYS * MS_DAY,
      untilMs: nowMs,
      count: NAMED_DOCTOR_REGISTRATIONS,
    });
  }

  const rows: NewRegistration[] = [];
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  let n = 0;

  for (const [d, holder] of holders.entries()) {
    // The account has to exist a day before it registers for anything, and the
    // эфир has to be far enough ahead of that for the «signed up a few weeks
    // early» offsets below to stay inside the window.
    const windowStart = holder.createdMs + MS_DAY;
    const pool = registrable.filter(
      (plan) => plan.startsAt.getTime() > windowStart + 3 * MS_DAY,
    );
    if (pool.length >= REGISTRATION_POOL_CEILING) {
      throw new RangeError(
        `golden volume: ${pool.length} registrable эфиров outgrew the prime stride ceiling ${REGISTRATION_POOL_CEILING} — registrations would repeat`,
      );
    }
    if (pool.length === 0) continue;
    const stride = REGISTRATION_STRIDES[
      d % REGISTRATION_STRIDES.length
    ] as number;
    const count = Math.min(holder.count, pool.length);

    for (let k = 0; k < count; k += 1) {
      const plan = pool[(d * 37 + k * stride) % pool.length] as VolumeEventPlan;
      const startMs = plan.startsAt.getTime();
      // A few weeks before the эфир, but never before the account existed and
      // never after the window closed.
      const registeredMs = Math.max(
        windowStart + MS_HOUR,
        Math.min(
          startMs - (2 + (n % 25)) * MS_DAY,
          holder.untilMs - (1 + (n % 48)) * MS_HOUR,
        ),
      );
      const row: NewRegistration = {
        id: goldenUuid(GOLDEN_GROUP.registrations, ordinal),
        userId: holder.userId,
        eventId: goldenUuid(
          GOLDEN_GROUP.events,
          GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
        ),
        registeredAt: new Date(registeredMs),
        recordStatus: n % 10 === 7 ? "retired" : "active",
      };
      if (row.recordStatus === "retired") {
        // Cancelled AFTER it was created and BEFORE the window closed — a
        // cancellation instant ahead of its own registration is not a shape a
        // roster has.
        row.deletedAt = new Date(
          Math.round(registeredMs + (holder.untilMs - registeredMs) * 0.6),
        );
      }
      rows.push(row);
      ordinal += 1;
      n += 1;
    }
  }

  return rows;
}

/**
 * Recordings for the эфиры that have one.
 *
 * Every publication state appears many times, and BOTH kinds do. The retired
 * rows are the reason the partial unique index exists: a retired `edited`
 * recording keeps its id and its history and stops competing for the event's
 * one active `edited` slot, so an event may legitimately carry both.
 *
 * Every instant is a fraction of the span between the эфир and «now», capped at
 * a few days: an эфир that ran an hour ago cannot have a montage published five
 * days later, and an эфир from six months back should not have waited six
 * months for one.
 */
function buildRecordings(plans: VolumeEventPlan[], now: Date): NewEventRecording[] {
  const rows: NewEventRecording[] = [];
  const nowMs = now.getTime();
  let ordinal = GOLDEN_VOLUME_ORDINAL_BASE;
  let r = 0;

  for (const plan of plans) {
    if (!plan.recorded) continue;
    const eventId = goldenUuid(
      GOLDEN_GROUP.events,
      GOLDEN_VOLUME_ORDINAL_BASE + plan.index,
    );
    const startMs = plan.startsAt.getTime();
    const span = Math.max(nowMs - startMs, MS_HOUR);
    const after = (days: number, share: number) =>
      new Date(startMs + Math.min(days * MS_DAY, span * share));
    const createdAt = after(2, 0.2);
    const publishedAt = after(5, 0.5);
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
        firstPublishedAt: after(3, 0.35),
        deletedAt: after(6, 0.7),
        version: 2,
        createdAt,
        updatedAt: after(6, 0.7),
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
        // The day after the account was created — consent is given at sign-up,
        // never before the account it belongs to.
        capturedAt: at({ days: -399 - d * 3 }),
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
    createdAt: at({ days: -398 - d * 3 }),
    updatedAt: at({ days: -398 - d * 3 }),
  }));
}
