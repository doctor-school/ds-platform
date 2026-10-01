"use client";

import * as React from "react";

import {
  CONGRESS_SUBMISSION_LIMITS,
  type CongressSubmission,
  type CongressSubmissionDraftContent,
  type CongressSubmissionKindIntake,
  congressKindMarksPresenting,
} from "@ds/schemas";
import { Alert } from "@ds/design-system/alert";
import { Button } from "@ds/design-system/button";
import { Checkbox } from "@ds/design-system/checkbox";
import { Container } from "@ds/design-system/container";
import { Input } from "@ds/design-system/input";
import { Link } from "@ds/design-system/link";
import { Textarea } from "@ds/design-system/textarea";
import { cn } from "@ds/design-system/lib/utils";

import {
  CongressSubmissionsError,
  deleteDraft,
  putBirthDate,
  saveDraft,
  sendSubmission,
  withdrawSubmission,
} from "../client";
import { COPY, CONGRESS_SUBMISSION_CONSENT_HREF, KIND_COPY } from "../copy";
import {
  type FormError,
  actionsFor,
  closedText,
  dateLine,
  draftErrors,
  editable as isEditable,
  formFields,
  formatBirthDate,
  kindSendable,
  kindStartable,
  localDate,
  parseBirthInput,
  problemMessages,
  revisionView,
  summaryTitle,
  localTime,
  withdrawnNotice,
} from "../model/model";
import {
  type AuthorRow,
  AuthorsEditor,
  withUids,
  withoutUids,
} from "./authors-editor";
import { BirthField } from "./birth-field";
import { PosterBand } from "./poster-band";
import { useAutosave } from "./use-autosave";

/**
 * One open submission (canvas artboard «d-lk-congress · заявка»): the poster
 * band with its kind, topic and status plate, the committee comment, the
 * notices, the detail actions with the inline withdrawal and deletion asks,
 * the error summary, the kind's form (oral talk or poster) — editable for a
 * draft of a sendable kind or a revision before its deadline, read-only
 * otherwise — and the sticky send panel with the autosave line and the send
 * confirmation (046 EARS-7…20). The first poster draft carries the birth-date
 * field for correction (EARS-19); a poster draft of a holder at or above the
 * kind's age limit reads as closed with the refusal (EARS-20).
 */

export interface SubmissionDetailProps {
  submission: CongressSubmission;
  intake: CongressSubmissionKindIntake;
  eventTitle: string;
  consentRequired: boolean;
  /** The submission was sent in this visit — the sent notice shows. */
  justSent: boolean;
  now: Date;
  /** The account's birth date (EARS-19). */
  birthDate: string | null;
  /**
   * The poster flow shows the birth-date field here: a poster draft while no
   * poster of the holder has left the draft state (canvas `askBirth`).
   */
  askBirth: boolean;
  /** The birth-date hint with the kind's age rule. */
  birthHint: string;
  /** The holder's age refusal for this kind, or `null` (EARS-20). */
  ageRefusal: string | null;
  /** The Moscow day a birth date may not pass (the API's own check). */
  today: string;
  /** The holder wrote a new birth date. */
  onBirthDate: (birthDate: string) => void;
  /** The api returned a newer copy (autosave, take-back, withdrawal). */
  onReplace: (s: CongressSubmission) => void;
  onSent: (s: CongressSubmission) => void;
  onRemoved: (id: string) => void;
  /** The server state moved under the page — read the section again. */
  onStale: () => void;
  onClose: () => void;
}

interface Draft {
  title: string;
  authors: AuthorRow[];
  body: Record<string, string>;
}

const toContent = (d: Draft): CongressSubmissionDraftContent => ({
  title: d.title,
  authors: withoutUids(d.authors),
  body: d.body,
});

/** Keep a value inside its code-point budget so every autosave stays valid. */
const clip = (v: string, max: number) => {
  const cps = Array.from(v);
  return cps.length > max ? cps.slice(0, max).join("") : v;
};

export function SubmissionDetail({
  submission: s,
  intake,
  eventTitle,
  consentRequired,
  justSent,
  now,
  birthDate,
  askBirth,
  birthHint,
  ageRefusal,
  today,
  onBirthDate,
  onReplace,
  onSent,
  onRemoved,
  onStale,
  onClose,
}: SubmissionDetailProps) {
  // A draft of a holder at or above the kind's age limit cannot become a
  // submission: read-only with the refusal, like the canvas `over40` (EARS-20).
  const ageLocked = s.status === "draft" && ageRefusal !== null;
  const canEdit = isEditable(s, intake, now) && !ageLocked;
  // A draft whose kind is not open: why it cannot be sent, and no active send
  // (046 EARS-10) — still editable before the opening, read-only after closing.
  const readDraft =
    s.status === "draft" && (!kindSendable(intake) || ageLocked);
  const sendable = canEdit && !readDraft;
  const blockedText = ageLocked ? ageRefusal : closedText(intake);
  // The birth date stays correctable in the first poster draft, the age-locked
  // one included — a mistyped date must not lock the holder out (EARS-19).
  const showBirth = askBirth && s.status === "draft" && kindStartable(intake);
  const fields = formFields(s.kind);
  const speakerPick = congressKindMarksPresenting(s.kind);
  const rev = revisionView(s, now);
  const kind = KIND_COPY[s.kind];

  const [draft, setDraft] = React.useState<Draft>(() => ({
    title: s.title,
    authors: withUids(s.authors),
    body: { ...s.body },
  }));
  const [consent, setConsent] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<FormError[]>([]);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [sendFailed, setSendFailed] = React.useState(false);
  const [ask, setAsk] = React.useState<"withdraw" | "delete" | null>(null);
  const [birthText, setBirthText] = React.useState(() =>
    formatBirthDate(birthDate),
  );
  const [birthRefused, setBirthRefused] = React.useState(false);

  /** Write the field's date when it is a real day the account does not hold yet. */
  async function saveBirth(): Promise<boolean> {
    const iso = parseBirthInput(birthText, today);
    if (!iso) return false;
    if (iso === birthDate) return true;
    try {
      onBirthDate((await putBirthDate(iso)).birthDate);
      return true;
    } catch {
      setBirthRefused(true);
      return false;
    }
  }

  const autosave = useAutosave<CongressSubmissionDraftContent>(
    async (content, { keepalive }) => {
      try {
        onReplace(await saveDraft(s.id, content, { keepalive }));
      } catch (e) {
        // The row left the editable state or is gone: nothing to retry — the
        // section is read again and shows where it stands now.
        if (
          e instanceof CongressSubmissionsError &&
          (e.status === 404 || e.status === 409)
        ) {
          onStale();
          return;
        }
        throw e;
      }
    },
  );

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((prev) => {
      const next = fn(prev);
      autosave.schedule(toContent(next));
      return next;
    });
    setServerErrors([]);
    setConfirming(false);
    setSendFailed(false);
  };
  const flush = () => void autosave.flush();

  const localErrors = canEdit
    ? draftErrors(
        { title: draft.title, authors: draft.authors, body: draft.body },
        { consentRequired, consentChecked: consent },
        {
          kind: s.kind,
          ...(showBirth ? { birthText } : {}),
          today,
        },
      )
    : [];
  const shown: FormError[] = [];
  if (tried && canEdit) {
    const seen = new Set<string>();
    for (const e of [...serverErrors, ...localErrors]) {
      if (seen.has(e.message)) continue;
      seen.add(e.message);
      shown.push(e);
    }
  }
  const errOf = (key: string) =>
    shown.find((e) => e.key === key)?.message ?? null;
  const birthError = errOf("birth") ?? (birthRefused ? COPY.errBirth : null);

  async function onSubmit() {
    await autosave.flush();
    setSendFailed(false);
    if (localErrors.length) {
      setTried(true);
      return;
    }
    if (showBirth && !(await saveBirth())) {
      setServerErrors(
        problemMessages(
          [{ code: "field-invalid", field: "birthDate" }],
          intake,
          now,
        ),
      );
      setTried(true);
      return;
    }
    setConfirming(true);
  }

  async function onConfirm() {
    setBusy(true);
    try {
      const sent = await sendSubmission(s.id, consentRequired && consent);
      onSent(sent);
    } catch (e) {
      setConfirming(false);
      if (
        e instanceof CongressSubmissionsError &&
        e.problems.some((p) => p.code === "status-conflict")
      ) {
        // The committee moved the submission meanwhile: the section is read
        // again and shows where it stands now (046 EARS-9).
        onStale();
      } else if (e instanceof CongressSubmissionsError && e.problems.length) {
        setServerErrors(problemMessages(e.problems, intake, now));
        setTried(true);
      } else if (e instanceof CongressSubmissionsError && e.status === 409) {
        onStale();
      } else {
        setSendFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    setBusy(true);
    try {
      onReplace(await withdrawSubmission(s.id, s.status));
    } catch {
      onStale();
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  async function onTakeBack() {
    setBusy(true);
    try {
      onReplace(await withdrawSubmission(s.id, "submitted"));
    } catch {
      onStale();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await deleteDraft(s.id);
      onRemoved(s.id);
    } catch {
      onStale();
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  const acts = actionsFor(s, intake, now);
  const detailActions = [
    ...(acts.primary?.action === "take-back" ? [acts.primary] : []),
    ...acts.secondary,
  ];
  const runAction = (a: (typeof detailActions)[number]) => {
    if (a.action === "take-back") void onTakeBack();
    else if (a.action === "withdraw") setAsk("withdraw");
    else if (a.action === "delete") setAsk("delete");
  };

  const topic = draft.title.trim() ? draft.title : COPY.untitled;
  const commentTone = s.status === "rejected" ? "rejected" : "revision";
  const savedAt = autosave.savedAt ?? new Date(s.updatedAt);
  const showBar = canEdit || readDraft;

  let sectionN = 0;
  const sectionHead = (text: string, sub?: string) => (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-3",
        sectionN++ ? "mt-1 border-t border-hairline pt-7" : "",
      )}
    >
      <h2 className="text-base font-extrabold tracking-tight text-foreground">
        {text}
      </h2>
      {sub ? <span className="text-caption text-faint">{sub}</span> : null}
    </div>
  );

  const labelClass = canEdit
    ? "text-sm font-bold text-foreground"
    : "text-caption font-bold text-muted-foreground";
  const roText = (v: string) => (
    <div className="max-w-prose whitespace-pre-wrap text-base leading-relaxed text-foreground">
      {v.trim() ? v : "—"}
    </div>
  );
  const fieldError = (key: string) => {
    const e = errOf(key);
    return e ? (
      <p className="mt-1.5 text-caption font-semibold text-destructive-text">
        {e}
      </p>
    ) : null;
  };

  return (
    <>
      <PosterBand
        mode="detail"
        eyebrow={`${kind.label} · ${eventTitle}`}
        topic={topic}
        status={s.status}
        dateLine={dateLine(s)}
        onBack={onClose}
      />
      <div className="pb-24 pt-9 layout:pt-13">
        <Container>
          <div
            data-screen-label="d-lk-congress · заявка"
            className="flex max-w-3xl flex-col gap-6"
          >
            {s.committeeComment ? (
              <div
                data-testid="congress-committee-comment"
                className={cn(
                  "-mx-4 px-4 py-4.5 layout:mx-0 layout:px-6.5 layout:py-5.5",
                  commentTone === "rejected"
                    ? "bg-destructive-tint"
                    : "bg-warning-tint",
                )}
              >
                <div
                  className={cn(
                    "mb-2 text-caption font-bold",
                    commentTone === "rejected"
                      ? "text-destructive-text"
                      : "text-foreground",
                  )}
                >
                  {COPY.committeeComment} · {localDate(s.statusChangedAt)}
                </div>
                <div
                  className={cn(
                    "text-pretty text-foreground",
                    s.committeeComment.length > 240
                      ? "max-w-prose whitespace-pre-wrap text-base leading-relaxed"
                      : "text-lg font-semibold leading-normal layout:text-xl",
                  )}
                >
                  {s.committeeComment}
                </div>
                {s.status === "needs_revision" && rev.text ? (
                  <div
                    className={cn(
                      "mt-3 text-body-compact text-foreground",
                      rev.urgent ? "font-bold" : "font-semibold",
                    )}
                  >
                    {rev.text}
                  </div>
                ) : null}
              </div>
            ) : null}

            {justSent ? (
              <Alert variant="success">{COPY.sentNotice}</Alert>
            ) : readDraft ? (
              <Alert variant="warn">{blockedText}</Alert>
            ) : s.status === "needs_revision" && !rev.open ? (
              <Alert variant="warn">{rev.text}</Alert>
            ) : s.status === "withdrawn" ? (
              <div
                role="status"
                className="-mx-4 flex items-start gap-3 bg-section px-4 py-3.5 layout:mx-0 layout:px-4.5"
              >
                <span
                  aria-hidden="true"
                  className="flex-none text-body-compact text-muted-foreground"
                >
                  —
                </span>
                <p className="text-sm font-semibold leading-normal text-foreground">
                  {withdrawnNotice(s)}
                </p>
              </div>
            ) : null}

            {detailActions.length ? (
              <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                {detailActions.map((a) => (
                  <Link
                    key={a.action}
                    asChild
                    tone={a.danger ? "danger" : "default"}
                    size="sm"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(a)}
                    >
                      {a.label}
                    </button>
                  </Link>
                ))}
              </div>
            ) : null}

            {ask ? (
              <InlineAsk
                text={ask === "withdraw" ? COPY.withdrawAsk : COPY.deleteAsk}
                yes={ask === "withdraw" ? COPY.withdraw : COPY.deleteDraft}
                busy={busy}
                onYes={() =>
                  void (ask === "withdraw" ? onWithdraw() : onDelete())
                }
                onNo={() => setAsk(null)}
              />
            ) : null}

            {shown.length ? (
              <div
                role="alert"
                data-screen-label="d-lk-congress · сводка ошибок"
                className="-mx-4 bg-destructive-tint px-4 py-4.5 layout:mx-0 layout:px-5.5"
              >
                <div className="text-sm font-bold text-foreground">
                  {summaryTitle(shown.length)}
                </div>
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
                  {shown.map((e) => (
                    <li
                      key={e.message}
                      className="text-body-compact text-destructive-text"
                    >
                      {e.focusId ? (
                        <Link asChild tone="danger" variant="inline">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() =>
                              document.getElementById(e.focusId!)?.focus()
                            }
                          >
                            {e.message}
                          </button>
                        </Link>
                      ) : (
                        <span className="font-bold">{e.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs text-muted-foreground">
                  {COPY.summarySaved}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-5">
              {sectionHead(
                COPY.sectionAbout,
                s.kind === "oral" ? COPY.onSite : undefined,
              )}
              <div>
                <label
                  htmlFor="in-topic"
                  className={cn("mb-2 block", labelClass)}
                >
                  {COPY.topic}
                </label>
                {canEdit ? (
                  <Input
                    id="in-topic"
                    value={draft.title}
                    maxLength={CONGRESS_SUBMISSION_LIMITS.title}
                    placeholder={COPY.topicPlaceholder}
                    aria-invalid={errOf("title") ? true : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      update((d) => ({ ...d, title: v }));
                    }}
                    onBlur={flush}
                  />
                ) : (
                  roText(draft.title)
                )}
                {fieldError("title")}
              </div>

              {showBirth ? (
                <BirthField
                  value={birthText}
                  hint={birthHint}
                  error={birthError}
                  onChange={(v) => {
                    setBirthText(v);
                    setBirthRefused(false);
                    setServerErrors([]);
                    setConfirming(false);
                  }}
                  onBlur={() => void saveBirth()}
                />
              ) : null}

              {sectionHead(
                COPY.sectionAuthors,
                speakerPick ? COPY.pickSpeaker : COPY.authorOrder,
              )}
              <AuthorsEditor
                authors={draft.authors}
                editable={canEdit}
                tried={tried}
                error={errOf("authors")}
                speakerPick={speakerPick}
                onChange={(authors) => update((d) => ({ ...d, authors }))}
                onBlur={flush}
              />

              {sectionHead(COPY.sectionContent)}
              {fields.map((f) => {
                const v = draft.body[f.key] ?? "";
                const max = f.max;
                return (
                  <div key={f.key}>
                    <label
                      htmlFor={`in-${f.key}`}
                      className={cn("mb-2 block", labelClass)}
                    >
                      {f.label}
                    </label>
                    {canEdit ? (
                      <Textarea
                        id={`in-${f.key}`}
                        value={v}
                        rows={f.rows}
                        placeholder={f.placeholder}
                        maxLength={max}
                        showCounter={Array.from(v).length >= max * 0.9}
                        aria-invalid={errOf(f.key) ? true : undefined}
                        onChange={(e) => {
                          const nv = clip(e.target.value, max);
                          update((d) => ({
                            ...d,
                            body: { ...d.body, [f.key]: nv },
                          }));
                        }}
                        onBlur={flush}
                      />
                    ) : (
                      roText(v)
                    )}
                    {fieldError(f.key)}
                  </div>
                );
              })}

              {canEdit && consentRequired ? (
                <>
                  {sectionHead(COPY.sectionConfirmations)}
                  <div>
                    <Checkbox
                      id="chk-pd"
                      checked={consent}
                      aria-invalid={errOf("consent") ? true : undefined}
                      onChange={(e) => {
                        setConsent(e.target.checked);
                        setServerErrors([]);
                        setConfirming(false);
                      }}
                    >
                      <span className="text-sm leading-normal text-foreground">
                        {COPY.consentBefore}
                        <Link
                          href={CONGRESS_SUBMISSION_CONSENT_HREF}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="inline"
                        >
                          {COPY.consentLink}
                        </Link>
                      </span>
                    </Checkbox>
                    {errOf("consent") ? (
                      <p className="ml-8 mt-1.5 text-caption font-semibold text-destructive-text">
                        {errOf("consent")}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {showBar ? (
                <div
                  data-screen-label="d-lk-congress · панель отправки"
                  className={cn(
                    "sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-4 border-t-2 border-border px-4 layout:mx-0",
                    confirming
                      ? "bg-tint py-4 layout:px-5"
                      : "bg-background py-3.5 layout:px-0",
                  )}
                >
                  {confirming ? (
                    <>
                      <div
                        data-screen-label="d-lk-congress · подтверждение отправки"
                        className="flex min-w-56 flex-1 flex-col gap-1"
                      >
                        <span className="text-body-compact font-extrabold text-foreground">
                          {s.status === "needs_revision"
                            ? COPY.confirmTitleAgain
                            : COPY.confirmTitle}
                        </span>
                        <span className="text-caption leading-normal text-foreground">
                          {s.status === "needs_revision"
                            ? COPY.confirmSubAgain
                            : COPY.confirmSub}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirming(false)}
                        >
                          {COPY.cancel}
                        </Button>
                        <Button
                          type="button"
                          loading={busy}
                          onClick={() => void onConfirm()}
                        >
                          {s.status === "needs_revision"
                            ? COPY.confirmYesAgain
                            : COPY.confirmYes}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-48 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
                        {canEdit ? (
                          <SaveLine state={autosave.state} savedAt={savedAt} />
                        ) : null}
                        {readDraft ? (
                          <span className="text-caption text-muted-foreground">
                            {blockedText.split(" — ")[0]}
                          </span>
                        ) : null}
                        {sendFailed ? (
                          <span
                            role="alert"
                            className="text-caption font-semibold text-destructive-text"
                          >
                            {COPY.sendFailed}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        disabled={!sendable}
                        onClick={() => void onSubmit()}
                      >
                        {s.status === "needs_revision"
                          ? COPY.sendAgain
                          : COPY.send}
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </Container>
      </div>
    </>
  );
}

function SaveLine({
  state,
  savedAt,
}: {
  state: "saved" | "saving" | "failed";
  savedAt: Date;
}) {
  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="congress-save-state"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 flex-none rounded-full",
          state === "failed"
            ? "bg-destructive"
            : state === "saving"
              ? "animate-skeleton-pulse bg-primary"
              : "bg-success",
        )}
      />
      <span
        role="status"
        className={cn(
          "text-caption font-semibold",
          state === "failed"
            ? "text-destructive-text"
            : "text-muted-foreground",
        )}
      >
        {state === "failed"
          ? COPY.saveFailed
          : state === "saving"
            ? COPY.saving
            : `${COPY.saved} · ${localTime(savedAt)}`}
      </span>
    </span>
  );
}

/** The inline confirmation of a withdrawal or a deletion (canvas `wdAskStyle`). */
export function InlineAsk({
  text,
  yes,
  busy,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-destructive-tint px-3.5 py-2.5 text-body-compact font-semibold text-foreground"
    >
      <span>{text}</span>
      <span className="flex items-center gap-3.5">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          loading={busy}
          onClick={onYes}
        >
          {yes}
        </Button>
        <Link asChild tone="muted" size="caption" weight="semibold">
          <button type="button" onClick={onNo}>
            {COPY.cancel}
          </button>
        </Link>
      </span>
    </div>
  );
}
