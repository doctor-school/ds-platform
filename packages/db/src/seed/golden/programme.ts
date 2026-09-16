// #2213 — the programme of a volume эфир, as pure data.
//
// Kept apart from `media.ts` on purpose: THIS module is imported by `volume.ts`
// and therefore by every consumer of the golden dataset (step 7's route params,
// the regression scenarios, the unit suite). It must stay free of `pdf-lib` and
// of `node:fs` — `media.ts` is where the bytes are made, and nothing that only
// needs the dataset should have to load a PDF writer to get it.
//
// Two things live here:
//   * the deterministic OBJECT KEYS the seed owns, and
//   * the programme itself — sessions, times, speakers, the closing line — as a
//     list of plain text lines. The lines are what the PDF renders AND what the
//     unit suite asserts on, because a PDF's text cannot be read back out of a
//     subsetted font: asserting on the source of the render is the honest test,
//     and it is the same string the reader will see.

import {
  PROGRAMME_CLOSING_LINES as PROGRAMME_CLOSING_SOURCE,
  SESSION_TITLES as SESSION_TITLE_SOURCE,
} from "./content.js";

/**
 * Object-storage key of an expert's portrait.
 *
 * Seed-owned and deterministic: the seed is idempotent, so the key must be a
 * function of the row's ordinal and nothing else. A content hash would change
 * whenever a portrait is re-normalised and leave the old object orphaned in
 * every slot bucket that ever cloned the template.
 */
export function expertPhotoKey(ordinal: number): string {
  return `golden/experts/${ordinal}.webp`;
}

/** Object-storage key of an event's programme PDF. */
export function eventProgrammeKey(ordinal: number): string {
  return `golden/events/${ordinal}/programme.pdf`;
}

/** The ordinal a golden media key addresses, or `null` for a foreign key. */
export function ordinalFromExpertPhotoKey(key: string): number | null {
  const match = /^golden\/experts\/(\d+)\.webp$/.exec(key);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/**
 * Object-storage key of a partner's logo.
 *
 * SVG, not WebP, because the bytes behind it are GENERATED from the partner's
 * own title rather than committed (`media.ts`): a wordmark is text on a
 * coloured field, which is exactly what a vector format states directly and
 * what a raster format would need a rendering toolchain to produce.
 */
export function partnerLogoKey(ordinal: number): string {
  return `golden/partners/${ordinal}.svg`;
}

/** The ordinal a golden partner-logo key addresses, or `null` for a foreign key. */
export function ordinalFromPartnerLogoKey(key: string): number | null {
  const match = /^golden\/partners\/(\d+)\.svg$/.exec(key);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/** Minutes of the closing «Вопросы и ответы» block. */
export const PROGRAMME_QA_MINUTES = 15;

/** Five to eight sessions — a real programme, not a title and a time. */
export function programmeSessionCount(i: number): number {
  return 5 + (i % 4);
}

/**
 * Minutes of session `k`, in 10–30.
 *
 * `7 mod 5` is co-prime with 5, so the five possible lengths all appear inside
 * the first five sessions of every programme: no эфир is eight identical
 * twenty-minute blocks.
 */
export function programmeSessionMinutes(i: number, k: number): number {
  return 10 + (((i * 3 + k * 7) % 5) * 5);
}

/**
 * The эфир's own length: its sessions plus the Q&A block.
 *
 * Derived rather than picked independently because the two are the same fact.
 * PR #2216 had a 45-minute эфир whose page offered no programme at all; an эфир
 * that advertises 45 minutes and hands out a programme of seven sessions is the
 * same defect with more paper.
 */
export function programmeTotalMinutes(i: number): number {
  let total = PROGRAMME_QA_MINUTES;
  for (let k = 0; k < programmeSessionCount(i); k += 1) {
    total += programmeSessionMinutes(i, k);
  }
  return total;
}

/**
 * Whether a volume event publishes its programme PDF.
 *
 * `draft` and `hidden` never do — nothing about them is published. Everything
 * that HAS happened (live, ended, archived) does: a programme is written before
 * the эфир, so an эфир that ran without one is not a state the product has.
 * Among the upcoming ones every sixth is deliberately left without, because
 * «программа готовится» is a rendered state of its own
 * (`event-page-view.ts` → `eventProgrammeContent`) and a stand where it never
 * appears cannot show the owner what that block looks like.
 */
export function hasProgramme(state: string, index: number): boolean {
  if (state === "draft" || state === "hidden") return false;
  if (state === "published") return index % 6 !== 3;
  return true;
}

/** One expert as the programme names them. */
export interface ProgrammeSpeaker {
  /** «Фамилия Имя Отчество», exactly as the expert row spells it. */
  name: string;
  /** The event-expert role: Спикер / Модератор / Эксперт. */
  role: string;
}

export interface ProgrammeSpec {
  /** Volume ordinal of the event — also the key's ordinal. */
  ordinal: number;
  /** Index in the volume plan; every derived value is a function of it. */
  index: number;
  title: string;
  /** Canonical UTC instant of the эфир's start. */
  startsAt: Date;
  durationMin: number;
  participationFormat: string;
  school: string;
  /** Title of the event's first project, or `null` when it has none. */
  projectTitle: string | null;
  speakers: readonly ProgrammeSpeaker[];
}

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/** МСК is UTC+3 all year — Russia has had no DST since 2014. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function msk(instant: Date): Date {
  return new Date(instant.getTime() + MSK_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** «14 марта 2026» in МСК. */
export function formatMskDate(instant: Date): string {
  const d = msk(instant);
  return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()] as string} ${d.getUTCFullYear()}`;
}

/** «19:00» in МСК. */
export function formatMskTime(instant: Date): string {
  const d = msk(instant);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const FORMAT_LABELS: Readonly<Record<string, string>> = {
  online: "онлайн",
  offline: "очно",
  hybrid: "онлайн и очно",
};

/** One row of the schedule table. */
export interface ProgrammeSession {
  /** «19:00 — 19:20», МСК. */
  time: string;
  title: string;
  /** Empty only when the event carries no experts at all. */
  speaker: string;
}

/** The schedule, in order, ending with the Q&A block. */
export function programmeSessions(spec: ProgrammeSpec): ProgrammeSession[] {
  const sessions: ProgrammeSession[] = [];
  const speakers = spec.speakers;
  const moderator = speakers.find((s) => s.role === "Модератор") ?? speakers[0];
  let cursor = spec.startsAt.getTime();

  const count = programmeSessionCount(spec.index);
  for (let k = 0; k < count; k += 1) {
    const minutes = programmeSessionMinutes(spec.index, k);
    const end = cursor + minutes * 60_000;
    const speaker = speakers[k % Math.max(speakers.length, 1)];
    sessions.push({
      time: `${formatMskTime(new Date(cursor))} — ${formatMskTime(new Date(end))}`,
      title: SESSION_TITLE_SOURCE[
        (spec.index * 5 + k * 3) % SESSION_TITLE_SOURCE.length
      ] as string,
      speaker: speaker ? `${speaker.name}, ${speaker.role.toLowerCase()}` : "",
    });
    cursor = end;
  }

  const qaEnd = cursor + PROGRAMME_QA_MINUTES * 60_000;
  sessions.push({
    time: `${formatMskTime(new Date(cursor))} — ${formatMskTime(new Date(qaEnd))}`,
    title: "Вопросы и ответы",
    speaker: moderator ? `${moderator.name}, модератор сессии` : "",
  });
  return sessions;
}

/**
 * The programme as plain text lines — the single source of the rendered page.
 *
 * Lines carrying an instant are the ONLY ones that move between two pins: the
 * suite asserts exactly that, which is what proves the seed re-dates its
 * fixtures (#2212) without re-authoring them.
 */
export function programmeLines(spec: ProgrammeSpec): string[] {
  const lines: string[] = [
    spec.school,
    spec.title,
    `${formatMskDate(spec.startsAt)}, ${formatMskTime(spec.startsAt)} МСК · ${
      FORMAT_LABELS[spec.participationFormat] ?? spec.participationFormat
    } · ${spec.durationMin} мин`,
  ];
  if (spec.projectTitle) lines.push(`Проект: ${spec.projectTitle}`);
  lines.push("", "ПРОГРАММА");
  for (const session of programmeSessions(spec)) {
    lines.push(`${session.time}  ${session.title}`);
    if (session.speaker) lines.push(`    ${session.speaker}`);
  }
  lines.push("", "УЧАСТВУЮТ");
  for (const speaker of spec.speakers) {
    lines.push(`${speaker.name} — ${speaker.role.toLowerCase()}`);
  }
  lines.push(
    "",
    PROGRAMME_CLOSING_SOURCE[
      spec.index % PROGRAMME_CLOSING_SOURCE.length
    ] as string,
  );
  return lines;
}

/** True for a line whose content depends on the resolved «now». */
export function isDatedProgrammeLine(line: string): boolean {
  return /\d{1,2}:\d{2}|\d{4}\sМСК|\d{1,2}\s\p{Lu}?[а-я]+\s\d{4}/u.test(line);
}
