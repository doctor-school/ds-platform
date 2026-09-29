"use client";

import { useEffect, type Ref } from "react";
import { useCustom, type HttpError } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button } from "@ds/design-system";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ds/design-system/sheet";
import {
  CongressParticipantCardSchema,
  type CongressParticipantCard,
  type CongressParticipantDay,
} from "@ds/schemas";
import { AttendanceCell } from "@/components/attendance-cell";
import { congressDayLongLabel } from "@/lib/congress-roster";
import { formatMskDateTime } from "@/lib/msk";
import {
  PARTICIPANT_CARD_FIELDS,
  consentPurposeKey,
  participantCardFailure,
  participantCardFields,
} from "@/lib/participant-card";
import { congressRosterUrl } from "@/providers/data-provider";

/**
 * 044 EARS-36 — the participant card: a right-hand side panel over the roster
 * (owner shape on #2377 — the roster stays visible and clickable, ↑/↓ walk the
 * rows, Esc closes, the address carries `?registration=`). It is the SAME
 * side-panel slot as the desk entry form (`desk-registration-form.tsx`, owner
 * decision on #2399): one `Sheet` primitive, whose modality per breakpoint and
 * ↑/↓ record paging (`onNavigate`) live in the design system, not here.
 *
 * Every field is read-only; the one control is the EARS-34 attendance mark,
 * which is the roster's own `AttendanceCell` — the same PUT, the same pending
 * and refused states — so the registrar finds, checks and marks without leaving
 * the panel. After a mark the card AND the roster re-read, so the history here
 * and the roster's boxes both show the server's truth.
 *
 * The card never says whether the email had a Doctor.School account before
 * this registration (EARS-36): the contract has no such field (strict schema).
 */
export function ParticipantCardPanel({
  eventId,
  registrationId,
  onClose,
  onNavigate,
  onRosterStale,
  onCloseAutoFocus,
  contentRef,
}: {
  eventId: string;
  /** The open card's registration; `null` = the panel is closed. */
  registrationId: string | null;
  onClose: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  /** A mark changed the roster, or the grant is gone: the page re-reads its list. */
  onRosterStale: () => void;
  onCloseAutoFocus: (event: Event) => void;
  /** The panel element — the page moves the focus into it on a row switch. */
  contentRef?: Ref<HTMLDivElement>;
}) {
  const t = useTranslations("congressRoster.participantCard");
  const { query } = useCustom<CongressParticipantCard, HttpError>({
    url: congressRosterUrl.card(eventId, registrationId ?? ""),
    method: "get",
    queryOptions: { enabled: registrationId !== null },
  });

  // Read the answer off the query, never Refine's `result` (a frozen `{}`
  // before the first answer), and hold it to the contract: a body that is not
  // a card is a failed read, not a half-drawn card.
  const parsed = query.data
    ? CongressParticipantCardSchema.safeParse(query.data.data)
    : null;
  const card =
    !query.isError &&
    parsed?.success &&
    parsed.data.registrationId === registrationId
      ? parsed.data
      : null;
  const failure = query.isError
    ? participantCardFailure(query.error?.statusCode)
    : parsed && !parsed.success
      ? "failed"
      : null;

  // The grant is gone (401/403): the roster re-reads, and its own refusal then
  // replaces the screen — exactly what a refused mark does.
  useEffect(() => {
    if (failure === "forbidden") onRosterStale();
  }, [failure, onRosterStale]);

  const body = () => {
    if (failure) {
      return (
        <Alert variant="danger" data-testid="participant-card-error">
          <p>{t(`errors.${failure}`)}</p>
          {failure === "failed" ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              data-testid="participant-card-retry"
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
          data-testid="participant-card-loading"
        >
          {t("loading")}
        </p>
      );
    }
    return (
      <CardFacts
        card={card}
        eventId={eventId}
        onMarked={() => {
          void query.refetch();
          onRosterStale();
        }}
        onForbidden={onRosterStale}
      />
    );
  };

  return (
    <Sheet
      open={registrationId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        ref={contentRef}
        size="md"
        data-testid="participant-card-panel"
        onNavigate={onNavigate}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <SheetBody>{body()}</SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function CardFacts({
  card,
  eventId,
  onMarked,
  onForbidden,
}: {
  card: CongressParticipantCard;
  eventId: string;
  onMarked: () => void;
  onForbidden: () => void;
}) {
  const t = useTranslations("congressRoster.participantCard");
  const fields = participantCardFields(card);
  const mail = card.confirmationMail;

  return (
    <div className="flex flex-col gap-6" data-testid="participant-card">
      {card.possibleDuplicate ? (
        <div
          className="flex flex-col items-start gap-2"
          data-testid="participant-card-duplicate"
        >
          <Badge variant="label">{t("possibleDuplicate")}</Badge>
          <p className="text-sm text-muted-foreground">
            {t("possibleDuplicateHint")}
          </p>
        </div>
      ) : null}
      <dl className="grid grid-cols-1 gap-3">
        {PARTICIPANT_CARD_FIELDS.map((key) => (
          <Fact key={key} label={t(`fields.${key}`)} testId={key}>
            {key === "registeredAt"
              ? t("atMsk", { at: fields.registeredAt })
              : fields[key]}
          </Fact>
        ))}
        <Fact label={t("fields.origin")} testId="origin">
          {t(`origins.${card.intakeOrigin}`)}
        </Fact>
        <Fact label={t("fields.consent")} testId="consent">
          {card.consents.length === 0 ? (
            t("none")
          ) : (
            <ul className="flex flex-col gap-2">
              {card.consents.map((consent) => {
                const purposeKey = consentPurposeKey(consent.purpose);
                return (
                  <li
                    key={`${consent.purpose}:${consent.capturedAt}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span>
                      {t("consentLine", {
                        purpose: purposeKey
                          ? t(`consentPurposes.${purposeKey}`)
                          : consent.purpose,
                        version: consent.version,
                        at: formatMskDateTime(consent.capturedAt),
                      })}
                    </span>
                    {consent.origin === "paper" ? (
                      <Badge variant="label">{t("consentPaper")}</Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Fact>
        <Fact label={t("fields.mail")} testId="mail">
          {mail.status && mail.at
            ? t(`mail.${mail.status}`, { at: formatMskDateTime(mail.at) })
            : t("none")}
        </Fact>
      </dl>
      {card.attendance.length > 0 ? (
        <section
          className="flex flex-col gap-3"
          aria-labelledby="participant-card-attendance-title"
          data-testid="participant-card-attendance"
        >
          <h3
            id="participant-card-attendance-title"
            className="text-sm font-bold text-foreground"
          >
            {t("attendanceTitle")}
          </h3>
          <AttendanceCell
            // A card of another participant starts from its own marks.
            key={card.registrationId}
            eventId={eventId}
            registrationId={card.registrationId}
            days={card.attendance.map((day) => day.day)}
            attendance={card.attendance.flatMap((day) =>
              day.present === null
                ? []
                : [{ day: day.day, present: day.present }],
            )}
            onMarked={onMarked}
            onForbidden={onForbidden}
          />
          {card.attendance.map((day) => (
            <DayHistory key={day.day} day={day} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function DayHistory({ day }: { day: CongressParticipantDay }) {
  const t = useTranslations("congressRoster.participantCard");
  return (
    <div
      className="flex flex-col gap-1"
      data-testid={`participant-card-history-${day.day}`}
    >
      <h4 className="text-xs text-muted-foreground">
        {t("historyTitle", { day: congressDayLongLabel(day.day) })}
      </h4>
      {day.history.length === 0 ? (
        <p className="text-sm text-foreground">{t("historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {day.history.map((entry, index) => (
            <li
              key={`${entry.at}:${index}`}
              className="text-sm text-foreground"
              data-testid="participant-card-history-entry"
            >
              {t("historyEntry", {
                actor: entry.actor ?? t("historyNoActor"),
                at: formatMskDateTime(entry.at),
                change: entry.present
                  ? t("historyMarked")
                  : t("historyCleared"),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One read-only fact — the admin `<dl>` precedent (`event-experts-panel.tsx`). */
function Fact({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className="text-sm text-foreground wrap-anywhere"
        data-testid={`participant-card-${testId}`}
      >
        {children}
      </dd>
    </div>
  );
}
