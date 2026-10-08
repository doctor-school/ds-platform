"use client";

import { useEffect, useReducer, type ComponentProps, type Ref } from "react";
import { useCustom, useCustomMutation, type HttpError } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { KIND_COPY, STATUS_LABEL } from "@ds/congress-submissions";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  NativeSelect,
  Textarea,
} from "@ds/design-system";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ds/design-system/sheet";
import {
  CONGRESS_COMMITTEE_COMMENT_MAX,
  CongressSubmissionCardSchema,
  congressStatusNeedsComment,
  instantToMskDay,
  type CongressCommitteeStatus,
  type CongressSubmissionCard,
} from "@ds/schemas";
import {
  CardDisclosure,
  CardMeta as CardMetaRow,
  CardSection,
  EmailChip,
  Fact as CardFact,
  Field,
  PhoneChip,
  SECONDARY,
} from "@/components/admin-card-layout";
import { formatMskDateTime } from "@/lib/msk";
import { participantCardFailure } from "@/lib/participant-card";
import {
  committeeDecisionBasis,
  committeeDecisionError,
  committeeDecisionInitial,
  committeeDecisionReducer,
  committeeTargets,
  committeeWriteFailure,
  extensionRefusalOutsideForm,
  mayExtendRevision,
  revisionExtensionError,
  submissionAuthorLines,
  submissionBodySections,
  submissionDecisionSummary,
  type CommitteeDecisionRefusal,
} from "@/lib/congress-submissions";
import { congressSubmissionsUrl } from "@/providers/data-provider";

/**
 * 046 EARS-28 / EARS-35 (#2437) — the submission card: the right-hand `Sheet`
 * side panel over the registry, the same slot and behaviour as the 044
 * participant card (`participant-card-panel.tsx`, Stage A route А on #2437):
 * ↑/↓ walk the rows, Esc closes, the address carries `?submission=`.
 *
 * The content is read-only. The one write is the «Решение» block — a status
 * select limited to the machine's edges from the current status and a comment
 * required for «Отклонена» / «На доработке»; a `withdrawn` card offers nothing.
 * For the platform administrator only, a `needs_revision` card also carries
 * «Продлить срок доработки до» (EARS-35). After a write the card AND the
 * registry re-read, so both show the server's truth. The client checks mirror
 * the schema; the server's refusals are the authority and are named in RU.
 */
export function SubmissionCardPanel({
  eventId,
  submissionId,
  platformAdmin,
  onClose,
  onNavigate,
  onRegistryStale,
  onCloseAutoFocus,
  contentRef,
}: {
  eventId: string;
  /** The open card's submission; `null` = the panel is closed. */
  submissionId: string | null;
  /** The platform administrator sees the EARS-35 extension. */
  platformAdmin: boolean;
  onClose: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  /** A write changed the registry, or the grant is gone: the page re-reads. */
  onRegistryStale: () => void;
  onCloseAutoFocus: (event: Event) => void;
  contentRef?: Ref<HTMLDivElement>;
}) {
  const t = useTranslations("congressSubmissions.card");
  const { query } = useCustom<CongressSubmissionCard, HttpError>({
    url: congressSubmissionsUrl.card(eventId, submissionId ?? ""),
    method: "get",
    queryOptions: { enabled: submissionId !== null },
  });

  const parsed = query.data
    ? CongressSubmissionCardSchema.safeParse(query.data.data)
    : null;
  const card =
    !query.isError && parsed?.success && parsed.data.id === submissionId
      ? parsed.data
      : null;
  const failure = query.isError
    ? participantCardFailure(query.error?.statusCode)
    : parsed && !parsed.success
      ? "failed"
      : null;

  useEffect(() => {
    if (failure === "forbidden") onRegistryStale();
  }, [failure, onRegistryStale]);

  const body = () => {
    if (failure) {
      return (
        <Alert variant="danger" data-testid="submission-card-error">
          <p>{t(`errors.${failure}`)}</p>
          {failure === "failed" ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              {t("retry")}
            </Button>
          ) : null}
        </Alert>
      );
    }
    if (!card) {
      return (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          data-testid="submission-card-loading"
        >
          {t("loading")}
        </p>
      );
    }
    const written = () => {
      void query.refetch();
      onRegistryStale();
    };
    return (
      <div className="flex flex-col gap-6" data-testid="submission-card">
        <CardFacts card={card} />
        <Decision
          // A new card starts a fresh decision. A new status of THIS card does
          // not remount: the write's outcome must outlive its re-read.
          key={card.id}
          card={card}
          eventId={eventId}
          platformAdmin={platformAdmin}
          onWritten={written}
          onForbidden={onRegistryStale}
        />
      </div>
    );
  };

  return (
    <Sheet
      open={submissionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        ref={contentRef}
        size="md"
        data-testid="submission-card-panel"
        onNavigate={onNavigate}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader>
          {/* The submission's тема IS the panel's title; the generic name
              stands in only while the card loads. */}
          <SheetTitle data-testid="submission-card-title">
            {card ? (
              <span className="wrap-anywhere">{card.title || t("title")}</span>
            ) : (
              t("title")
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>
          {card ? <CardMeta card={card} /> : null}
        </SheetHeader>
        <SheetBody>{body()}</SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Under the title: вид and статус (the registry's badge), the send time. */
function CardMeta({ card }: { card: CongressSubmissionCard }) {
  const t = useTranslations("congressSubmissions.card");
  return (
    <CardMetaRow>
      <Badge variant="label" data-testid="submission-card-kind">
        {KIND_COPY[card.kind].label}
      </Badge>
      <Badge variant="label" data-testid="submission-card-status">
        {STATUS_LABEL[card.status]}
      </Badge>
      {card.submittedAt ? (
        <span className={SECONDARY} data-testid="submission-card-submitted-at">
          {t("submittedLine", { at: formatMskDateTime(card.submittedAt) })}
        </span>
      ) : null}
    </CardMetaRow>
  );
}

/** The submission card's fact: the shared layout's, under this card's ids. */
function Fact(props: ComponentProps<typeof CardFact>) {
  return <CardFact {...props} testId={`submission-card-${props.testId}`} />;
}

function CardFacts({ card }: { card: CongressSubmissionCard }) {
  const t = useTranslations("congressSubmissions");
  const c = (key: string, values?: Record<string, string | number>) =>
    t(`card.${key}`, values);
  const summary = submissionDecisionSummary(card, new Date());
  const authors = submissionAuthorLines(card.authors);
  const none = c("none");
  const phone = card.submitter.phone;

  return (
    <>
      {summary ? (
        // What the committee reads first: the decision already taken.
        <Card data-testid="submission-card-summary">
          <dl className="flex flex-col gap-4 p-4">
            {summary.deadline ? (
              <Fact label={c("fields.revision")} testId="revision">
                {summary.deadline.expired ? (
                  <Alert variant="warn" role="status">
                    {c("revisionExpired", { day: summary.deadline.day })}
                  </Alert>
                ) : (
                  c("revisionUntil", { day: summary.deadline.day })
                )}
              </Fact>
            ) : null}
            {summary.comment ? (
              <Fact label={c("fields.committeeComment")} testId="comment" prose>
                {summary.comment}
              </Fact>
            ) : null}
            {summary.lastLetter ? (
              <Fact label={c("fields.lastLetter")} testId="last-letter">
                <span className={SECONDARY}>
                  {c(`lastLetter.${summary.lastLetter.status}`, {
                    at: formatMskDateTime(summary.lastLetter.at),
                  })}
                </span>
              </Fact>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <CardSection
        titleId="submission-card-content-title"
        title={c("contentTitle")}
      >
        <dl className="flex flex-col gap-4">
          <Fact label={c("fields.authors")} testId="authors">
            {authors.length === 0 ? (
              none
            ) : (
              <ol className="flex flex-col gap-2">
                {authors.map((author, index) => (
                  <li key={index} className="flex flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{author.name || none}</span>
                      {author.presenting ? (
                        <Badge variant="speaker">{c("presenting")}</Badge>
                      ) : null}
                    </span>
                    {author.workplace ? (
                      <span className={SECONDARY}>{author.workplace}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Fact>
          {submissionBodySections(card.kind, card.body).map((section) => (
            <Fact
              key={section.key}
              label={c(`sections.${section.key}`)}
              testId={`section-${section.key.replace(".", "-")}`}
              prose
            >
              {section.text}
            </Fact>
          ))}
          {card.derivedFrom ? (
            <Fact label={c("fields.derivedFrom")} testId="derived-from">
              {c("derivedFromLine", {
                kind: KIND_COPY[card.derivedFrom.kind].label,
                title: card.derivedFrom.title,
                status: STATUS_LABEL[card.derivedFrom.status],
              })}
            </Fact>
          ) : null}
        </dl>
      </CardSection>

      <CardSection
        titleId="submission-card-submitter-title"
        title={c("submitterTitle")}
        divided
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label={c("fields.submitter")} testId="submitter">
            {card.submitter.fullName}
          </Fact>
          <Fact label={c("fields.phone")} testId="phone">
            {phone ? <PhoneChip phone={phone} /> : none}
          </Fact>
          <Fact
            label={c("fields.email")}
            testId="email"
            className="sm:col-span-2"
          >
            {card.submitter.email ? (
              <EmailChip email={card.submitter.email} />
            ) : (
              none
            )}
          </Fact>
          {card.kind === "poster" ? (
            <Fact label={c("fields.age")} testId="age">
              {card.submitter.ageOnEventStart === null
                ? none
                : c("ageYears", { years: card.submitter.ageOnEventStart })}
            </Fact>
          ) : null}
        </dl>
      </CardSection>

      <CardDisclosure
        summary={c("historySummary", { count: card.history.length })}
        testId="submission-card-history"
      >
        <ol className="mt-3 flex flex-col gap-3">
          {card.history.map((entry, index) => (
            <li
              key={`${entry.at}:${index}`}
              className="flex flex-col gap-0.5"
              data-testid="submission-card-history-entry"
            >
              <span className={SECONDARY}>
                {c("historyMeta", {
                  at: formatMskDateTime(entry.at),
                  actor: entry.actor ?? c("historyNoActor"),
                })}
              </span>
              <span className="text-sm text-foreground">
                {entry.from
                  ? `${STATUS_LABEL[entry.from]} → ${STATUS_LABEL[entry.to]}`
                  : STATUS_LABEL[entry.to]}
              </span>
            </li>
          ))}
        </ol>
        <p
          className={`mt-3 ${SECONDARY}`}
          data-testid="submission-card-updated-at"
        >
          {c("updatedLine", { at: formatMskDateTime(card.updatedAt) })}
        </p>
      </CardDisclosure>
    </>
  );
}

/** The catalog key of each refusal (problem codes are kebab-case on the wire). */
const FAILURE_KEY: Record<CommitteeDecisionRefusal, string> = {
  "status-conflict": "statusConflict",
  "transition-not-allowed": "transitionNotAllowed",
  "not-needs-revision": "notNeedsRevision",
  "revision-day-not-later": "revisionDayNotLater",
  "revision-day-in-past": "revisionDayInPast",
  forbidden: "forbidden",
  unavailable: "unavailable",
  invalid: "invalid",
  failed: "failed",
  statusRequired: "statusRequired",
  commentRequired: "commentRequired",
  commentTooLong: "commentTooLong",
  dayRequired: "dayRequired",
};

function Decision({
  card,
  eventId,
  platformAdmin,
  onWritten,
  onForbidden,
}: {
  card: CongressSubmissionCard;
  eventId: string;
  platformAdmin: boolean;
  onWritten: () => void;
  onForbidden: () => void;
}) {
  const t = useTranslations("congressSubmissions");
  const targets = committeeTargets(card.status);
  const basis = committeeDecisionBasis(card);
  const [state, dispatch] = useReducer(
    committeeDecisionReducer,
    basis,
    committeeDecisionInitial,
  );
  // The card re-read after a write or a concurrent-change refusal: the
  // controls follow the stored status; the outcome and the comment stay.
  if (state.basis !== basis) dispatch({ type: "card-read", basis });
  const {
    status,
    comment,
    extendTo,
    notice,
    decisionRefusal,
    extensionRefusal,
  } = state;
  const { mutate, mutation } = useCustomMutation();
  const refusal = (key: CommitteeDecisionRefusal) =>
    t(`decision.errors.${FAILURE_KEY[key]}`);

  const onRefused =
    (type: "decision-refused" | "extension-refused") => (error: unknown) => {
      const failure = committeeWriteFailure(error);
      if (failure === "forbidden") onForbidden();
      dispatch({ type, failure });
      // A concurrent change won: the card re-reads, so the next decision
      // starts from the status that is actually stored.
      if (failure === "status-conflict" || failure === "not-needs-revision") {
        onWritten();
      }
    };

  const submitDecision = () => {
    dispatch({ type: "submit" });
    const invalid = committeeDecisionError(status, comment);
    if (invalid || !status) {
      dispatch({
        type: "decision-refused",
        failure: invalid ?? "statusRequired",
      });
      return;
    }
    const text = comment.trim();
    mutate(
      {
        url: congressSubmissionsUrl.status(eventId, card.id),
        method: "post",
        values: {
          status,
          expectedStatus: card.status,
          // Only the statuses whose change carries the comment send one.
          ...(congressStatusNeedsComment(status) ? { comment: text } : {}),
        },
        successNotification: false,
        errorNotification: false,
      },
      {
        onSuccess: () => {
          dispatch({ type: "decision-saved" });
          onWritten();
        },
        onError: onRefused("decision-refused"),
      },
    );
  };

  const submitExtension = () => {
    dispatch({ type: "submit" });
    const invalid = revisionExtensionError(
      extendTo,
      card.revisionLastDay,
      instantToMskDay(new Date()),
    );
    if (invalid) {
      dispatch({ type: "extension-refused", failure: invalid });
      return;
    }
    mutate(
      {
        url: congressSubmissionsUrl.revisionDeadline(eventId, card.id),
        method: "post",
        values: { lastDay: extendTo },
        successNotification: false,
        errorNotification: false,
      },
      {
        onSuccess: () => {
          dispatch({ type: "extension-saved" });
          onWritten();
        },
        onError: onRefused("extension-refused"),
      },
    );
  };

  const pending = mutation.isPending;
  // The comment field exists only where the status change carries it.
  const commentTaken = status !== "" && congressStatusNeedsComment(status);
  const decisionRefused = decisionRefusal ? (
    <Alert variant="danger" data-testid="submission-decision-refused">
      {refusal(decisionRefusal)}
    </Alert>
  ) : null;
  const extensionRefused = (failure: CommitteeDecisionRefusal | null) =>
    failure ? (
      <Alert variant="danger" data-testid="submission-extension-refused">
        {refusal(failure)}
      </Alert>
    ) : null;
  const mayExtend = mayExtendRevision(platformAdmin, card.status);

  return (
    <CardSection
      titleId="submission-decision-title"
      title={t("decision.title")}
      divided
      testId="submission-decision"
    >
      {notice ? (
        <Alert
          variant="success"
          role="status"
          data-testid="submission-decision-saved"
        >
          {t(`decision.${notice}`)}
        </Alert>
      ) : null}
      {targets.length === 0 ? (
        <>
          <p
            className="text-sm text-muted-foreground"
            data-testid="submission-decision-withdrawn"
          >
            {t("decision.withdrawn")}
          </p>
          {/* A concurrent withdrawal refused the write: the reason stays. */}
          {decisionRefused}
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submitDecision();
          }}
        >
          <Field id="submission-decision-status" label={t("decision.status")}>
            <NativeSelect
              id="submission-decision-status"
              value={status}
              data-testid="submission-decision-status"
              onChange={(event) =>
                dispatch({
                  type: "choose",
                  status: event.target.value as CongressCommitteeStatus | "",
                })
              }
            >
              <option value="">{t("decision.statusPlaceholder")}</option>
              {targets.map((target) => (
                <option key={target} value={target}>
                  {STATUS_LABEL[target]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {commentTaken ? (
            <Field
              id="submission-decision-comment"
              label={t("decision.comment")}
              hint={t("decision.commentHint")}
            >
              <Textarea
                id="submission-decision-comment"
                value={comment}
                rows={5}
                maxLength={CONGRESS_COMMITTEE_COMMENT_MAX}
                aria-required
                aria-describedby="submission-decision-comment-hint"
                data-testid="submission-decision-comment"
                onChange={(event) =>
                  dispatch({ type: "type", comment: event.target.value })
                }
              />
            </Field>
          ) : null}
          {decisionRefused}
          <div>
            <Button
              type="submit"
              disabled={pending}
              data-testid="submission-decision-submit"
            >
              {t("decision.submit")}
            </Button>
          </div>
        </form>
      )}
      {mayExtend ? (
        <form
          className="flex flex-col gap-4 border-t border-border pt-4"
          noValidate
          data-testid="submission-extension"
          onSubmit={(event) => {
            event.preventDefault();
            submitExtension();
          }}
        >
          <Field
            id="submission-extension-day"
            label={t("decision.extensionLabel")}
            hint={t("decision.extensionHint")}
          >
            <Input
              id="submission-extension-day"
              type="date"
              value={extendTo}
              aria-describedby="submission-extension-day-hint"
              data-testid="submission-extension-day"
              onChange={(event) =>
                dispatch({ type: "day", day: event.target.value })
              }
            />
          </Field>
          {extensionRefused(extensionRefusal)}
          <div>
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              data-testid="submission-extension-submit"
            >
              {t("decision.extensionSubmit")}
            </Button>
          </div>
        </form>
      ) : (
        // The re-read took the submission off needs_revision and the form
        // with it: the refusal that says so stays.
        extensionRefused(
          extensionRefusalOutsideForm(state, platformAdmin, card.status),
        )
      )}
    </CardSection>
  );
}
