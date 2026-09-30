import {
  type CongressSubmission,
  type CongressSubmissionDraftAuthor,
  type CongressSubmissionKindIntake,
  type CongressSubmissionProblem,
  type CongressSubmissionSectionEvent,
  congressTextLength,
} from "@ds/schemas";

import { COPY, KIND_COPY } from "../copy";

/**
 * The section's decisions as pure functions of the API read and the clock —
 * which action a row offers, what a closed kind says, the revision countdown,
 * the send checks — so the UI renders and the tests pin them without a DOM.
 */

const MSK = "Europe/Moscow";

function parts(iso: string, withTime: boolean): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK,
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** «16 декабря 2026» in Moscow time. */
export function mskDate(iso: string): string {
  const p = parts(iso, false);
  return `${p.day} ${p.month} ${p.year}`;
}

/** «16 декабря 2026, 18:40» in Moscow time. */
export function mskDateTime(iso: string): string {
  const p = parts(iso, true);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** A Moscow calendar day `YYYY-MM-DD` as «15 января 2027». */
export function mskDay(day: string): string {
  return mskDate(`${day}T12:00:00+03:00`);
}

/** The heading line under the title — «{event} · 23–24 апреля 2027». */
export function eventLine(event: CongressSubmissionSectionEvent): string {
  const a = parts(event.startsAt, false);
  const b = parts(event.endsAt, false);
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
  const p = parts(new Date(due.getTime() - 1).toISOString(), false);
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
    text: `Срок доработки истёк ${day} — отправить заявку нельзя`,
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

/** What a submission offers in the list and in the detail (046 EARS-11…13). */
export function actionsFor(
  s: CongressSubmission,
  intake: CongressSubmissionKindIntake,
  now: Date,
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
          label: kindStartable(intake) ? COPY.continue : COPY.open,
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

/** The list row's meta line (046 EARS-11). */
export function rowMeta(
  s: CongressSubmission,
  intake: CongressSubmissionKindIntake,
  _now: Date,
): string {
  const out = [
    KIND_COPY[s.kind].label,
    `${s.status === "draft" ? "изменён" : "изменено"} ${mskDate(s.updatedAt)}`,
  ];
  if (s.status === "submitted") out.push(COPY.sentMeta);
  if (s.status === "draft" && !kindSendable(intake)) {
    out.push(closedText(intake).split(" — ")[0]!.toLowerCase());
  }
  return out.join(" · ");
}

/** The detail header's date line. */
export function dateLine(s: CongressSubmission): string {
  if (s.status === "draft") return `черновик изменён ${mskDate(s.updatedAt)}`;
  if (s.status === "withdrawn") return `отозвана ${mskDate(s.updatedAt)}`;
  return `отправлена ${mskDateTime(s.submittedAt ?? s.updatedAt)}`;
}

/** The withdrawn notice (046 EARS-12). */
export function withdrawnNotice(s: CongressSubmission): string {
  return `Заявка отозвана ${mskDate(s.updatedAt)}. Программный комитет её не рассмотрит; изменить или отправить её снова нельзя.`;
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

export const ORAL_FIELDS = [
  { key: "goal", label: COPY.goal, placeholder: COPY.goalPlaceholder, rows: 2 },
  {
    key: "summary",
    label: COPY.summary,
    placeholder: COPY.summaryPlaceholder,
    rows: 5,
  },
] as const;

const filled = (v: string | undefined) => congressTextLength(v ?? "") > 0;

function authorIncomplete(a: CongressSubmissionDraftAuthor): boolean {
  return !filled(a.surname) || !filled(a.firstName) || !filled(a.workplace);
}

/**
 * The oral form's unmet send conditions, before the server is asked
 * (046 EARS-8, EARS-16) — the server repeats every one of them.
 */
export function draftErrors(
  d: OralDraft,
  consent: { consentRequired: boolean; consentChecked: boolean },
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
  } else if (d.authors.filter((a) => a.presenting).length !== 1) {
    out.push({ key: "authors", message: COPY.errSpeaker });
  }
  for (const f of ORAL_FIELDS) {
    if (!filled(d.body[f.key])) {
      out.push({
        key: f.key,
        message: `Заполните поле «${f.label}»`,
        focusId: `in-${f.key}`,
      });
    }
  }
  if (consent.consentRequired && !consent.consentChecked) {
    out.push({ key: "consent", message: COPY.errConsent, focusId: "chk-pd" });
  }
  return out;
}

function fieldProblem(field: string | undefined): FormError | null {
  if (!field) return null;
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
  if (field === "authors") return { key: "authors", message: COPY.errSpeaker };
  const body = /^body\.(\w+)/.exec(field);
  const def = body ? ORAL_FIELDS.find((f) => f.key === body[1]) : undefined;
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
          fieldProblem(p.field) ?? { key: null, message: COPY.errFieldInvalid },
        );
        break;
      case "revision-closed": {
        const due = p.params?.revisionDueAt;
        push({
          key: null,
          message:
            typeof due === "string"
              ? revisionView({ revisionDueAt: due }, new Date(due)).text
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
      case "first-author-limit-reached":
        push({ key: null, message: COPY.errFirstAuthorLimit });
        break;
      case "age-limit":
        push({ key: null, message: COPY.errAgeLimit });
        break;
      case "statement-required":
        push({ key: null, message: COPY.errStatement });
        break;
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
