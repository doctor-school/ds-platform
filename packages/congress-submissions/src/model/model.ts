import {
  CONGRESS_ABSTRACT_SECTIONS,
  CONGRESS_SUBMISSION_LIMITS,
  type CongressAbstractSection,
  type CongressAgeLimitParams,
  type CongressSubmissionStatement,
  abstractLength,
  congressKindStatements,
  CongressBirthDateSchema,
  type CongressSubmission,
  type CongressSubmissionDraftAuthor,
  type CongressSubmissionKind,
  type CongressSubmissionKindIntake,
  type CongressSubmissionProblem,
  type CongressSubmissionSectionEvent,
  congressAgeLimitParams,
  congressAgeOnDay,
  congressKindMarksPresenting,
  congressTextLength,
  instantToMskDay,
} from "@ds/schemas";

import { COPY, KIND_COPY } from "../copy";

/**
 * The section's decisions as pure functions of the API read and the clock —
 * which action a row offers, what a closed kind says, the revision countdown,
 * the send checks — so the UI renders and the tests pin them without a DOM.
 */

const MSK = "Europe/Moscow";

/**
 * Two clocks, never mixed: a RULE date (intake open/close, the revision
 * deadline, its countdown — 046 EARS-3/10/30/34) is the congress's Moscow date
 * and says so; a USER-ACTION time (changed, sent, withdrawn, autosaved) is the
 * viewer's own communication and renders in the browser's zone with no label.
 * The section reads its data client-side after mount, so the server never
 * renders a viewer-zone string (no hydration drift).
 */
function parts(
  iso: string | Date,
  withTime: boolean,
  timeZone: string | undefined,
): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    ...(timeZone ? { timeZone } : {}),
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** «16 декабря 2026» in Moscow time — a rule date. */
export function mskDate(iso: string): string {
  const p = parts(iso, false, MSK);
  return `${p.day} ${p.month} ${p.year}`;
}

/** «16 декабря 2026, 18:40» in Moscow time — a rule date with its time. */
export function mskDateTime(iso: string): string {
  const p = parts(iso, true, MSK);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** «16 декабря 2026» in the viewer's zone — a user-action date. */
export function localDate(iso: string): string {
  const p = parts(iso, false, undefined);
  return `${p.day} ${p.month} ${p.year}`;
}

/** «16 декабря 2026, 18:40» in the viewer's zone — a user-action time. */
export function localDateTime(iso: string): string {
  const p = parts(iso, true, undefined);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** «18:40» in the viewer's zone — the autosave stamp. */
export function localTime(at: Date): string {
  const p = parts(at, true, undefined);
  return `${p.hour}:${p.minute}`;
}

/** A Moscow calendar day `YYYY-MM-DD` as «15 января 2027». */
export function mskDay(day: string): string {
  return mskDate(`${day}T12:00:00+03:00`);
}

/** The heading line under the title — «{event} · 23–24 апреля 2027». */
export function eventLine(event: CongressSubmissionSectionEvent): string {
  const a = parts(event.startsAt, false, MSK);
  const b = parts(event.endsAt, false, MSK);
  let days: string;
  if (a.day === b.day && a.month === b.month && a.year === b.year) {
    days = `${a.day} ${a.month} ${a.year}`;
  } else if (a.month === b.month && a.year === b.year) {
    days = `${a.day}–${b.day} ${a.month} ${a.year}`;
  } else {
    days = `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  }
  return `${event.title} · ${days}`;
}

/** Russian plural: one / few / many. */
export function plural(
  n: number,
  forms: readonly [string, string, string],
): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

const withN = (n: number, forms: readonly [string, string, string]) =>
  `${n} ${plural(n, forms)}`;

const YEARS = ["год", "года", "лет"] as const;
/** «младше N …» takes the genitive: 1/21 года, every other count «лет». */
const YEARS_GENITIVE = ["года", "лет", "лет"] as const;

/**
 * 046 EARS-20 — the age rule of a kind: its limit and the event's start day as
 * a Moscow day with no zone label (the canvas `ageRule`).
 */
export function ageRuleText(p: {
  maxAgeYears: number;
  eventStartDate: string;
}): string {
  return (
    `Постерные доклады принимают от участников младше ${withN(p.maxAgeYears, YEARS_GENITIVE)} ` +
    `на дату начала Конгресса — ${mskDay(p.eventStartDate)}`
  );
}

/**
 * 046 EARS-20 — the age-limit refusal (owner decision 2026-10-01): the rule
 * and the age the holder will be on that day.
 */
export function ageLimitText(p: CongressAgeLimitParams): string {
  return `${ageRuleText(p)}. На эту дату вам будет ${withN(p.age, YEARS)}.`;
}

/** The event's start as its Moscow calendar day — the day the age rule counts on. */
export function eventStartDay(
  event: Pick<CongressSubmissionSectionEvent, "startsAt">,
): string {
  return instantToMskDay(new Date(event.startsAt));
}

/**
 * 046 EARS-20 — the refusal the API gives the holder for this kind: the kind
 * has an age limit and the holder's full years on the event's Moscow start day
 * reach it. `null` — the kind is open to them, or the birth date is not known
 * yet (EARS-19 asks for it first).
 */
export function ageRefusalOf(
  intake: Pick<CongressSubmissionKindIntake, "maxAgeYears">,
  birthDate: string | null,
  startDay: string,
): CongressAgeLimitParams | null {
  if (intake.maxAgeYears === null || !birthDate) return null;
  const age = congressAgeOnDay(birthDate, startDay);
  return age < intake.maxAgeYears
    ? null
    : { maxAgeYears: intake.maxAgeYears, eventStartDate: startDay, age };
}

/** 046 EARS-19 — the birth-date hint: asked once, and the kind's age rule. */
export function birthHint(
  intake: Pick<CongressSubmissionKindIntake, "maxAgeYears">,
  startDay: string,
): string {
  if (intake.maxAgeYears === null) return COPY.birthAskedOnce;
  const rule = ageRuleText({
    maxAgeYears: intake.maxAgeYears,
    eventStartDate: startDay,
  });
  return `${COPY.birthAskedOnce} ${rule}.`;
}

/**
 * 046 EARS-19 — the birth-date field is the browser's date control (DS
 * `Input type="date"`), which owns entry and hands over `YYYY-MM-DD` or "". The
 * value counts only as a real calendar day from 1900 up to `today` (the Moscow
 * day, as the API checks it); anything else is `null`.
 */
export function readBirthDate(value: string, today: string): string | null {
  if (!CongressBirthDateSchema.safeParse(value).success) return null;
  return value > today ? null : value;
}

/** «осталось …» — days and hours, or hours and minutes under a day. */
export function countdownText(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const H = ["час", "часа", "часов"] as const;
  if (d)
    return withN(d, ["день", "дня", "дней"]) + (h ? ` ${withN(h, H)}` : "");
  return `${withN(h, H)} ${withN(m, ["минута", "минуты", "минут"])}`;
}

/** «… назад» — whole days, whole hours under a day, «меньше часа» under an hour. */
export function agoText(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  if (hours >= 24)
    return `${withN(Math.floor(hours / 24), ["день", "дня", "дней"])} назад`;
  if (hours >= 1) return `${withN(hours, ["час", "часа", "часов"])} назад`;
  return "меньше часа назад";
}

/** A draft of this kind can be started now (046 EARS-6: refused only after closing). */
export function kindStartable(intake: CongressSubmissionKindIntake): boolean {
  return intake.offered && intake.state !== "closed";
}

/** The kind can take a send: its form is offered and its window is open. */
export function kindSendable(intake: CongressSubmissionKindIntake): boolean {
  return intake.offered && intake.state === "open";
}

/** The picker's intake line of a kind (046 EARS-10). */
export function intakeLine(intake: CongressSubmissionKindIntake): string {
  switch (intake.state) {
    case "not-announced":
      return COPY.notAnnounced;
    case "not-yet-open":
      return `Приём откроется ${mskDate(intake.opensAt!)}`;
    case "open":
      return `Приём до ${mskDay(intake.lastDay!)} включительно`;
    case "closed":
      return `Приём закрыт ${mskDay(intake.lastDay!)}`;
  }
}

/** The picker's count line of a limited kind (046 EARS-17; canvas `pk.count` / `reason`). */
export function limitLine(intake: CongressSubmissionKindIntake): string | null {
  if (!intake.offered || intake.submitLimit === null) return null;
  const line = `Отправлено ${intake.used} ${plural(intake.used, KIND_COPY[intake.kind].countForms)} из ${intake.submitLimit}`;
  return intake.used >= intake.submitLimit
    ? `${line} — больше подать нельзя`
    : line;
}

/** Why a draft of this kind cannot be sent now (046 EARS-10). */
export function closedText(intake: CongressSubmissionKindIntake): string {
  const gen = KIND_COPY[intake.kind].gen;
  switch (intake.state) {
    case "not-announced":
      return `Дату открытия приёма ${gen} объявят позже — черновик сохранится`;
    case "not-yet-open":
      return `Приём ${gen} откроется ${mskDate(intake.opensAt!)} — черновик сохранится`;
    default:
      return `Приём ${gen} закрыт ${intake.lastDay ? mskDay(intake.lastDay) : ""} — отправить заявку нельзя`;
  }
}

export interface RevisionView {
  open: boolean;
  /** Under three days left — the line takes the warning weight. */
  urgent: boolean;
  text: string;
}

/** The revision deadline line of a `needs_revision` submission (046 EARS-11). */
export function revisionView(
  s: Pick<CongressSubmission, "revisionDueAt">,
  now: Date,
): RevisionView {
  if (!s.revisionDueAt) return { open: true, urgent: false, text: "" };
  const due = new Date(s.revisionDueAt);
  const p = parts(new Date(due.getTime() - 1).toISOString(), false, MSK);
  const day = `${p.day} ${p.month}, 23:59 МСК`;
  const left = due.getTime() - now.getTime();
  if (left > 0) {
    return {
      open: true,
      urgent: left < 3 * 86_400_000,
      text: `Исправить и отправить до ${day} · осталось ${countdownText(left)}`,
    };
  }
  return {
    open: false,
    urgent: true,
    text: `Срок доработки истёк ${day} (${agoText(-left)}) — отправить заявку нельзя`,
  };
}

/**
 * A draft of an offered kind until its intake closes — a draft may be written
 * before the opening, it just cannot be sent (046 EARS-6, EARS-10) — or a
 * revision before its deadline (046 EARS-7, EARS-30).
 */
export function editable(
  s: CongressSubmission,
  intake: CongressSubmissionKindIntake,
  now: Date,
): boolean {
  if (s.status === "draft") return kindStartable(intake);
  if (s.status === "needs_revision") return revisionView(s, now).open;
  return false;
}

export type RowAction = "open" | "take-back" | "withdraw" | "delete";

export interface ActionView {
  action: RowAction;
  label: string;
  danger?: boolean;
}

export interface Actions {
  primary: ActionView | null;
  secondary: ActionView[];
}

/**
 * What a submission offers in the list and in the detail (046 EARS-11…13).
 * `ageRefusal` — the holder's age-limit refusal for this kind (046 EARS-20,
 * `ageLimitText`), or `null`; an age-locked draft opens rather than continues.
 */
export function actionsFor(
  s: CongressSubmission,
  intake: CongressSubmissionKindIntake,
  now: Date,
  ageRefusal: string | null = null,
): Actions {
  const withdraw: ActionView = {
    action: "withdraw",
    label: COPY.withdraw,
    danger: true,
  };
  switch (s.status) {
    case "withdrawn":
      return { primary: null, secondary: [] };
    case "draft":
      return {
        primary: {
          action: "open",
          label:
            kindStartable(intake) && ageRefusal === null
              ? COPY.continue
              : COPY.open,
        },
        secondary: [
          { action: "delete", label: COPY.deleteDraft, danger: true },
        ],
      };
    case "submitted":
      return intake.state === "open"
        ? {
            primary: { action: "take-back", label: COPY.takeBack },
            secondary: [],
          }
        : {
            primary: { action: "open", label: COPY.open },
            secondary: [withdraw],
          };
    case "in_review":
      return {
        primary: { action: "open", label: COPY.open },
        secondary: [withdraw],
      };
    case "needs_revision":
      return {
        primary: {
          action: "open",
          label: revisionView(s, now).open ? COPY.continue : COPY.open,
        },
        secondary: [withdraw],
      };
    default:
      return { primary: { action: "open", label: COPY.open }, secondary: [] };
  }
}

/**
 * The list row's meta line (046 EARS-11). A draft that cannot be sent carries
 * why, lower-cased up to « — »: the age rule first (046 EARS-20, `ageRefusal`
 * as in `actionsFor`), else the closed intake (canvas `closedText`).
 */
export function rowMeta(
  s: CongressSubmission,
  intake: CongressSubmissionKindIntake,
  _now: Date,
  ageRefusal: string | null = null,
): string {
  const out = [
    KIND_COPY[s.kind].label,
    `${s.status === "draft" ? "изменён" : "изменено"} ${localDate(s.updatedAt)}`,
  ];
  if (s.status === "submitted") out.push(COPY.sentMeta);
  if (s.status === "draft" && (ageRefusal !== null || !kindSendable(intake))) {
    const why = ageRefusal ?? closedText(intake);
    out.push(why.split(" — ")[0]!.toLowerCase());
  }
  return out.join(" · ");
}

/** The detail header's date line. */
export function dateLine(s: CongressSubmission): string {
  if (s.status === "draft") return `черновик изменён ${localDate(s.updatedAt)}`;
  if (s.status === "withdrawn")
    return `отозвана ${localDate(s.statusChangedAt)}`;
  return `отправлена ${localDateTime(s.submittedAt ?? s.updatedAt)}`;
}

/** The withdrawn notice (046 EARS-12). */
export function withdrawnNotice(s: CongressSubmission): string {
  return `Заявка отозвана ${localDate(s.statusChangedAt)}. Программный комитет её не рассмотрит; изменить или отправить её снова нельзя.`;
}

// ---------------------------------------------------------------------------
// Send checks
// ---------------------------------------------------------------------------

export interface FormError {
  /** The field the message sits next to; `null` — the summary only. */
  key: string | null;
  message: string;
  /** The element the summary link focuses. */
  focusId?: string;
}

export interface OralDraft {
  title: string;
  authors: CongressSubmissionDraftAuthor[];
  body: Record<string, string | undefined>;
}

/** One text field of a kind's body (canvas `DEFS`). */
export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  rows: number;
  /** The code-point budget (046-design «Field set and limits»). */
  max: number;
}

export const ORAL_FIELDS: readonly FormField[] = [
  {
    key: "goal",
    label: COPY.goal,
    placeholder: COPY.goalPlaceholder,
    rows: 2,
    max: CONGRESS_SUBMISSION_LIMITS.oralGoal,
  },
  {
    key: "summary",
    label: COPY.summary,
    placeholder: COPY.summaryPlaceholder,
    rows: 5,
    max: CONGRESS_SUBMISSION_LIMITS.oralSummary,
  },
];

/** 046 EARS-18 — the poster's goal and content; the canvas draws no placeholders. */
export const POSTER_FIELDS: readonly FormField[] = [
  {
    key: "goal",
    label: COPY.posterGoal,
    rows: 2,
    max: CONGRESS_SUBMISSION_LIMITS.posterGoal,
  },
  {
    key: "content",
    label: COPY.posterContent,
    rows: 5,
    max: CONGRESS_SUBMISSION_LIMITS.posterContent,
  },
];

const ABSTRACT_LABELS: Record<CongressAbstractSection, [string, number]> = {
  relevance: [COPY.abstractRelevance, 3],
  goal: [COPY.abstractGoal, 2],
  methods: [COPY.abstractMethods, 4],
  results: [COPY.abstractResults, 4],
  conclusions: [COPY.abstractConclusions, 3],
};

/**
 * 046 EARS-21 — the five abstract sections in the canvas order; each may take
 * the whole total, which the one counter guards (EARS-22).
 */
export const ABSTRACT_FIELDS: readonly FormField[] =
  CONGRESS_ABSTRACT_SECTIONS.map((key) => ({
    key,
    label: ABSTRACT_LABELS[key][0],
    rows: ABSTRACT_LABELS[key][1],
    max: CONGRESS_SUBMISSION_LIMITS.abstractTotal,
  }));

/** The body fields of a kind's form. */
export function formFields(kind: CongressSubmissionKind): readonly FormField[] {
  if (kind === "abstract") return ABSTRACT_FIELDS;
  return kind === "poster" ? POSTER_FIELDS : ORAL_FIELDS;
}

/** A count as the canvas prints it — `toLocaleString('ru-RU')`. */
const ru = (n: number) => n.toLocaleString("ru-RU");
const ABSTRACT_MAX_TEXT = "5 000";
/** The canvas marks the counter from 4 500 on (`near`). */
const ABSTRACT_NEAR = 4500;

export interface AbstractCounterView {
  /** The server's length (`abstractLength`). */
  length: number;
  /** «4 998 / 5 000». */
  text: string;
  over: boolean;
  near: boolean;
  /** «осталось N» near the limit, «больше на N» above it. */
  note: string | null;
}

/**
 * 046 EARS-22 — the one total counter of the five sections, from the same
 * `abstractLength` the server refuses by (046-design «Abstract length»).
 */
export function abstractCounter(
  body: Record<string, string | undefined>,
): AbstractCounterView {
  const length = abstractLength(body);
  const max = CONGRESS_SUBMISSION_LIMITS.abstractTotal;
  const over = length > max;
  const near = !over && length >= ABSTRACT_NEAR;
  return {
    length,
    text: `${ru(length)} / ${ABSTRACT_MAX_TEXT}`,
    over,
    near,
    note: over
      ? `больше на ${ru(length - max)}`
      : near
        ? `осталось ${ru(max - length)}`
        : null,
  };
}

const abstractTooLong = (length: number): FormError => ({
  key: "counter",
  message: `Сократите текст тезисов до ${ABSTRACT_MAX_TEXT} знаков — сейчас ${ru(length)}`,
  focusId: "in-results",
});

const STATEMENT_ERRORS: Record<CongressSubmissionStatement, FormError> = {
  plag: { key: "plag", message: COPY.errStatementPlag, focusId: "chk-plag" },
  trade: {
    key: "trade",
    message: COPY.errStatementTrade,
    focusId: "chk-trade",
  },
};

const BIRTH_ERROR: FormError = {
  key: "birth",
  message: COPY.errBirth,
  focusId: "in-birth",
};

/** The one-speaker refusal, linked to the first author's «Докладчик» choice. */
const SPEAKER_ERROR: FormError = {
  key: "authors",
  message: COPY.errSpeaker,
  focusId: "in-a0-sp",
};

const filled = (v: string | undefined) => congressTextLength(v ?? "") > 0;

function authorIncomplete(a: CongressSubmissionDraftAuthor): boolean {
  return !filled(a.surname) || !filled(a.firstName) || !filled(a.workplace);
}

/**
 * The form's unmet send conditions, before the server is asked (046 EARS-8,
 * EARS-16, EARS-18, EARS-19) — the server repeats every one of them.
 * `birthValue` is the birth-date control's value (`YYYY-MM-DD` or "") when the
 * poster flow asks for it; `today` is the Moscow day the API checks it against.
 */
export function draftErrors(
  d: OralDraft,
  consent: { consentRequired: boolean; consentChecked: boolean },
  form: {
    kind?: CongressSubmissionKind;
    birthValue?: string;
    today?: string;
    /** The statements the author has ticked (046 EARS-23). */
    statements?: readonly CongressSubmissionStatement[];
  } = {},
): FormError[] {
  const out: FormError[] = [];
  if (!filled(d.title)) {
    out.push({ key: "title", message: COPY.errTopic, focusId: "in-topic" });
  }
  const bad = d.authors.findIndex(authorIncomplete);
  if (d.authors.length === 0 || bad >= 0) {
    out.push({
      key: "authors",
      message: COPY.errAuthors,
      focusId: `in-a${Math.max(bad, 0)}-sn`,
    });
  } else if (
    congressKindMarksPresenting(form.kind ?? "oral") &&
    d.authors.filter((a) => a.presenting).length !== 1
  ) {
    out.push(SPEAKER_ERROR);
  }
  if (form.birthValue !== undefined) {
    const today = form.today ?? instantToMskDay(new Date());
    if (!readBirthDate(form.birthValue, today)) out.push(BIRTH_ERROR);
  }
  for (const f of formFields(form.kind ?? "oral")) {
    if (!filled(d.body[f.key])) {
      out.push({
        key: f.key,
        message: `Заполните поле «${f.label}»`,
        focusId: `in-${f.key}`,
      });
    }
  }
  if (form.kind === "abstract") {
    const length = abstractLength(d.body);
    if (length > CONGRESS_SUBMISSION_LIMITS.abstractTotal) {
      out.push(abstractTooLong(length));
    }
  }
  for (const s of congressKindStatements(form.kind ?? "oral")) {
    if (!form.statements?.includes(s)) out.push(STATEMENT_ERRORS[s]);
  }
  if (consent.consentRequired && !consent.consentChecked) {
    out.push({ key: "consent", message: COPY.errConsent, focusId: "chk-pd" });
  }
  return out;
}

function fieldProblem(
  field: string | undefined,
  kind: CongressSubmissionKind,
  params: CongressSubmissionProblem["params"],
): FormError | null {
  if (!field) return null;
  if (field === "birthDate") return BIRTH_ERROR;
  if (field === "body" && typeof params?.length === "number") {
    return abstractTooLong(params.length);
  }
  if (field === "title") {
    return { key: "title", message: COPY.errTopic, focusId: "in-topic" };
  }
  const author = /^authors\.(\d+)/.exec(field);
  if (author) {
    return {
      key: "authors",
      message: COPY.errAuthors,
      focusId: `in-a${author[1]}-sn`,
    };
  }
  if (field === "authors") {
    return congressKindMarksPresenting(kind)
      ? SPEAKER_ERROR
      : { key: "authors", message: COPY.errAuthors, focusId: "in-a0-sn" };
  }
  const body = /^body\.(\w+)/.exec(field);
  const def = body
    ? formFields(kind).find((f) => f.key === body[1])
    : undefined;
  if (def) {
    return {
      key: def.key,
      message: `Заполните поле «${def.label}»`,
      focusId: `in-${def.key}`,
    };
  }
  return null;
}

/** A server refusal, each problem in plain language next to the form (046 EARS-9). */
export function problemMessages(
  problems: CongressSubmissionProblem[],
  intake: CongressSubmissionKindIntake,
  now: Date,
): FormError[] {
  const out: FormError[] = [];
  const seen = new Set<string>();
  const push = (e: FormError | null) => {
    if (!e || seen.has(e.message)) return;
    seen.add(e.message);
    out.push(e);
  };
  for (const p of problems) {
    switch (p.code) {
      case "limit-reached": {
        const n = Number(p.params?.limit ?? intake.submitLimit ?? 0);
        push({
          key: null,
          message: `Можно отправить не больше ${n} ${plural(n, KIND_COPY[intake.kind].forms)}`,
        });
        break;
      }
      case "kind-closed":
      case "kind-not-open":
        push({ key: null, message: closedText(intake) });
        break;
      case "consent-required":
        push({ key: "consent", message: COPY.errConsent, focusId: "chk-pd" });
        break;
      case "registration-required":
        push({ key: null, message: COPY.noRegistration });
        break;
      case "field-invalid":
        push(
          fieldProblem(p.field, intake.kind, p.params) ?? {
            key: null,
            message: COPY.errFieldInvalid,
          },
        );
        break;
      case "revision-closed": {
        // The server has refused: the deadline is past even when the
        // viewer's clock lags behind it — then it passed «меньше часа назад».
        const due = p.params?.revisionDueAt;
        push({
          key: null,
          message:
            typeof due === "string"
              ? revisionView(
                  { revisionDueAt: due },
                  new Date(Math.max(now.getTime(), new Date(due).getTime())),
                ).text
              : COPY.errRevisionClosed,
        });
        break;
      }
      case "status-conflict":
        push({ key: null, message: COPY.errStatusChanged });
        break;
      case "withdraw-not-allowed":
        push({ key: null, message: COPY.errWithdrawNotAllowed });
        break;
      case "kind-not-available":
        push({ key: null, message: COPY.errKindNotAvailable });
        break;
      case "first-author-limit-reached": {
        const n = Number(p.params?.limit ?? intake.submitLimit ?? 0);
        push({
          key: null,
          message: `Можно отправить не больше ${n} ${plural(n, KIND_COPY[intake.kind].forms)} с одним и тем же первым автором`,
        });
        break;
      }
      case "age-limit": {
        const age = congressAgeLimitParams(p.params);
        push({
          key: null,
          message: age ? ageLimitText(age) : COPY.errAgeLimit,
        });
        break;
      }
      case "statement-required": {
        const s = p.params?.statement;
        push(
          s === "plag" || s === "trade"
            ? STATEMENT_ERRORS[s]
            : { key: null, message: COPY.errStatement },
        );
        break;
      }
      default: {
        // Every code the API can return is named above — a new one fails here.
        const unmapped: never = p.code;
        push({ key: null, message: String(unmapped) });
      }
    }
  }
  return out;
}

/** A plural-agreeing «Исправьте N ошибку/ошибки/ошибок:». */
export function summaryTitle(n: number): string {
  return `Заявка не отправлена. Исправьте ${n} ${plural(n, ["ошибку", "ошибки", "ошибок"])}:`;
}

/** The picker's note, drawn only when the limits are the ones it states. */
export function pickerNote(
  kinds: CongressSubmissionKindIntake[],
): string | null {
  const by = new Map(kinds.map((k) => [k.kind, k]));
  const abstractLimit = by.get("abstract")?.submitLimit;
  if (
    by.get("oral")?.submitLimit !== null ||
    by.get("poster")?.submitLimit !== null ||
    typeof abstractLimit !== "number"
  ) {
    return null;
  }
  return `Можно подать сколько угодно докладов и постеров и до ${abstractLimit} ${plural(abstractLimit, KIND_COPY.abstract.forms)}, пока приём открыт.`;
}
