"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Authenticated, useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Label, Textarea } from "@ds/design-system";
import {
  APPLICATION_NOTE_MAX,
  type AdminApplicationDetail,
  type AdminApplicationOutcome,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  ApplicationCloseDialog,
  ApplicationEraseDialog,
} from "@/components/application-dialogs";
import { StatusChip } from "@/components/status-chip";
import {
  APPLICATIONS_ROUTE,
  applicationActions,
  applicationRefusal,
  applicationStatusLabelKey,
  applicationsUrl,
  type ApplicationRefusal,
} from "@/lib/applications";
import { formatMskDateTime } from "@/lib/msk";

type Banner =
  | { kind: "stale" }
  | { kind: "error"; text: string }
  | { kind: "success"; text: string };

/**
 * One application (033 EARS-14…EARS-16, EARS-20; approved-non-canvas states
 * `application-detail`, `application-erase` and `stale` of 033-design «UI
 * composition → Admin»): what the applicant sent with its labels, the
 * applicant (the account's CURRENT name, email and phone, or the contact as
 * sent), the consent, both notice outcomes, the status commands, the notes
 * oldest first with «Добавить заметку», and the erasure on request.
 *
 * The status move carries the version this page read as `If-Match` (the
 * `custom` transport adds it with the idempotency key and the CSRF proof); a
 * `412` means another administrator changed the application — the reload
 * notice says nothing was changed and «Обновить» reads it again. Every
 * successful command answers or is followed by a fresh read, so the next
 * command asserts the version the server holds.
 */
export default function ApplicationDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { result, query } = useCustom<AdminApplicationDetail>({
    url: applicationsUrl.detail(id),
    method: "get",
  });
  const detail = query.isError ? undefined : result.data;
  const { mutate, mutation } = useCustomMutation();
  const pending = mutation.isPending;

  const [banner, setBanner] = useState<Banner | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const refusalText = (refusal: ApplicationRefusal) =>
    t(`applications.errors.${refusal}`);

  const refresh = () => void query.refetch();

  /** A stale version (or a transition the page no longer reflects) → reload. */
  function onRefused(error: unknown, show: (text: string) => void): void {
    const refusal = applicationRefusal(error);
    if (refusal === "stale") {
      setClosing(false);
      setErasing(false);
      setBanner({ kind: "stale" });
      return;
    }
    if (refusal === "alreadyErased" || refusal === "transitionNotAllowed")
      refresh();
    show(refusalText(refusal));
  }

  function moveStatus(
    current: AdminApplicationDetail,
    status: "in_review" | "closed",
    outcome?: AdminApplicationOutcome,
  ) {
    setBanner(null);
    setCloseError(null);
    mutate(
      {
        url: applicationsUrl.status(current.id),
        method: "post",
        values: outcome ? { status, outcome } : { status },
        meta: { version: current.version },
      },
      {
        onSuccess: () => {
          setClosing(false);
          setBanner({
            kind: "success",
            text: t("applications.detail.statusSaved"),
          });
          refresh();
        },
        onError: (error) =>
          onRefused(error, (text) =>
            status === "closed"
              ? setCloseError(text)
              : setBanner({ kind: "error", text }),
          ),
      },
    );
  }

  function addNote(current: AdminApplicationDetail) {
    const body = note.trim();
    if (body.length === 0 || body.length > APPLICATION_NOTE_MAX) {
      setNoteError(t("applications.errors.noteInvalid"));
      return;
    }
    setNoteError(null);
    setBanner(null);
    mutate(
      {
        url: applicationsUrl.notes(current.id),
        method: "post",
        values: { body },
      },
      {
        onSuccess: () => {
          setNote("");
          setBanner({
            kind: "success",
            text: t("applications.detail.noteAdded"),
          });
          refresh();
        },
        onError: (error) =>
          onRefused(error, (text) =>
            setNoteError(
              applicationRefusal(error) === "invalid"
                ? t("applications.errors.noteInvalid")
                : text,
            ),
          ),
      },
    );
  }

  function erase(current: AdminApplicationDetail) {
    setEraseError(null);
    setBanner(null);
    mutate(
      {
        url: applicationsUrl.erase(current.id),
        method: "post",
        // The erasure takes no body; the transport still sends JSON.
        values: {},
      },
      {
        onSuccess: () => {
          setErasing(false);
          setBanner({ kind: "success", text: t("applications.erase.done") });
          refresh();
        },
        onError: (error) => onRefused(error, setEraseError),
      },
    );
  }

  const loadError = query.isError
    ? applicationRefusal(query.error) === "notFound"
      ? t("applications.errors.notFound")
      : applicationRefusal(query.error) === "forbidden"
        ? t("applications.errors.forbidden")
        : t("applications.errors.detailLoadFailed")
    : null;

  return (
    <Authenticated key="applications-detail" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href={APPLICATIONS_ROUTE}
            label={t("applications.backToList")}
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !detail ? (
          <Alert variant="danger" data-testid="detail-error">
            {loadError}
          </Alert>
        ) : (
          <ApplicationBody
            detail={detail}
            banner={banner}
            pending={pending}
            note={note}
            noteError={noteError}
            onNoteChange={setNote}
            onReload={() => {
              setBanner(null);
              refresh();
            }}
            onTakeIntoWork={() => moveStatus(detail, "in_review")}
            onOpenClose={() => {
              setCloseError(null);
              setClosing(true);
            }}
            onAddNote={() => addNote(detail)}
            onOpenErase={() => {
              setEraseError(null);
              setErasing(true);
            }}
          />
        )}

        {detail ? (
          <>
            <ApplicationCloseDialog
              open={closing}
              pending={pending}
              error={closeError}
              onOpenChange={setClosing}
              onSubmit={(outcome) => moveStatus(detail, "closed", outcome)}
            />
            <ApplicationEraseDialog
              open={erasing}
              pending={pending}
              error={eraseError}
              onOpenChange={setErasing}
              onConfirm={() => erase(detail)}
            />
          </>
        ) : null}
      </AppShell>
    </Authenticated>
  );
}

function ApplicationBody({
  detail,
  banner,
  pending,
  note,
  noteError,
  onNoteChange,
  onReload,
  onTakeIntoWork,
  onOpenClose,
  onAddNote,
  onOpenErase,
}: {
  detail: AdminApplicationDetail;
  banner: Banner | null;
  pending: boolean;
  note: string;
  noteError: string | null;
  onNoteChange: (value: string) => void;
  onReload: () => void;
  onTakeIntoWork: () => void;
  onOpenClose: () => void;
  onAddNote: () => void;
  onOpenErase: () => void;
}) {
  const t = useTranslations();
  const actions = applicationActions(detail);
  const notSet = t("common.notSet");
  const at = (iso: string | null) => (iso ? formatMskDateTime(iso) : notSet);

  return (
    <>
      <div
        className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
        data-testid="application-detail-header"
      >
        <h1
          className="min-w-0 wrap-anywhere text-xl font-extrabold text-foreground"
          data-testid="application-heading"
        >
          {detail.subjectLine ?? detail.kindLabel}
        </h1>
        <StatusChip
          status={
            detail.status === "closed" && detail.outcome
              ? detail.outcome
              : detail.status
          }
          label={t(applicationStatusLabelKey(detail.status, detail.outcome))}
          testId="application-status"
        />
        {detail.erased ? (
          <Badge variant="label" data-testid="application-erased">
            {t("applications.marks.erased")}
          </Badge>
        ) : null}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {detail.kindLabel} ·{" "}
        {t("applications.detail.submittedAt", {
          at: formatMskDateTime(detail.submittedAt),
        })}
      </p>

      {banner?.kind === "stale" ? (
        <Alert variant="warn" className="mb-4" data-testid="application-stale">
          <span className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <span>{t("applications.errors.stale")}</span>
            <Button
              size="sm"
              variant="outline"
              data-testid="application-reload"
              onClick={onReload}
            >
              {t("applications.errors.reload")}
            </Button>
          </span>
        </Alert>
      ) : banner?.kind === "error" ? (
        <Alert
          variant="danger"
          className="mb-4"
          data-testid="application-error"
        >
          {banner.text}
        </Alert>
      ) : banner?.kind === "success" ? (
        <Alert
          variant="success"
          className="mb-4"
          data-testid="application-saved"
        >
          {banner.text}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section title={t("applications.detail.sentFields")}>
            {detail.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("applications.detail.noFields")}
              </p>
            ) : (
              <FieldList
                testId="application-fields"
                rows={detail.fields.map((f) => [f.label, f.value, f.key])}
              />
            )}
          </Section>

          <Section title={t("applications.detail.notes")}>
            {detail.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("applications.detail.noNotes")}
              </p>
            ) : (
              <ol
                className="flex flex-col gap-3"
                data-testid="application-notes"
              >
                {detail.notes.map((item) => (
                  <li
                    key={item.id}
                    className="border-2 border-hairline p-3"
                    data-testid={`application-note-${item.id}`}
                  >
                    <p className="mb-1 text-caption text-muted-foreground">
                      {item.authorName ??
                        t("applications.detail.noteAuthorUnknown")}{" "}
                      · {formatMskDateTime(item.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {actions.addNote ? (
              <div className="mt-4 flex flex-col gap-1.5">
                <Label htmlFor="application-note">
                  {t("applications.detail.noteLabel")}
                </Label>
                <Textarea
                  id="application-note"
                  value={note}
                  rows={3}
                  maxLength={APPLICATION_NOTE_MAX}
                  disabled={pending}
                  aria-describedby="application-note-hint"
                  aria-invalid={noteError ? true : undefined}
                  data-testid="application-note-input"
                  onChange={(event) => onNoteChange(event.target.value)}
                />
                <p
                  id="application-note-hint"
                  className="text-caption text-muted-foreground"
                >
                  {t("applications.detail.noteHint")}
                </p>
                {noteError ? (
                  <p
                    className="text-sm text-destructive"
                    role="alert"
                    data-testid="application-note-error"
                  >
                    {noteError}
                  </p>
                ) : null}
                <div>
                  <Button
                    variant="outline"
                    disabled={pending}
                    data-testid="application-note-submit"
                    onClick={onAddNote}
                  >
                    {t("applications.detail.addNote")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("applications.detail.noteErased")}
              </p>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title={t("applications.detail.statusSection")}>
            <p className="mb-3 text-sm text-muted-foreground">
              {detail.statusChangedAt
                ? t("applications.detail.statusChangedAt", {
                    at: formatMskDateTime(detail.statusChangedAt),
                  })
                : null}
            </p>
            <div className="flex flex-wrap gap-3">
              {actions.takeIntoWork ? (
                <Button
                  disabled={pending}
                  data-testid="application-take"
                  onClick={onTakeIntoWork}
                >
                  {t("applications.detail.takeIntoWork")}
                </Button>
              ) : null}
              {actions.close ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  data-testid="application-close"
                  onClick={onOpenClose}
                >
                  {t("applications.detail.close")}
                </Button>
              ) : null}
            </div>
          </Section>

          <Section title={t("applications.detail.applicant")}>
            {detail.applicant === null ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="application-applicant-erased"
              >
                {t("applications.detail.applicantErased", {
                  at: at(detail.pdErasedAt),
                })}
              </p>
            ) : detail.applicant.type === "account" ? (
              <FieldList
                testId="application-applicant"
                rows={[
                  [
                    t("applications.detail.applicantName"),
                    detail.applicant.displayName ?? notSet,
                    "name",
                  ],
                  [
                    t("applications.detail.applicantEmail"),
                    detail.applicant.email ?? notSet,
                    "email",
                  ],
                  [
                    t("applications.detail.applicantPhone"),
                    detail.applicant.phone ?? notSet,
                    "phone",
                  ],
                ]}
              />
            ) : (
              <FieldList
                testId="application-applicant"
                rows={detail.applicant.fields.map((f) => [
                  f.label,
                  f.value,
                  f.key,
                ])}
              />
            )}
            {actions.erase ? (
              <Button
                variant="destructive"
                className="mt-4"
                disabled={pending}
                data-testid="application-erase"
                onClick={onOpenErase}
              >
                {t("applications.erase.action")}
              </Button>
            ) : null}
          </Section>

          <Section title={t("applications.detail.consent")}>
            <FieldList
              testId="application-consent"
              rows={[
                [
                  t("applications.detail.consentPurpose"),
                  detail.consent.purpose,
                  "purpose",
                ],
                [
                  t("applications.detail.consentVersion"),
                  detail.consent.versionTag,
                  "version",
                ],
                [
                  t("applications.detail.consentAt"),
                  at(detail.consent.capturedAt),
                  "at",
                ],
              ]}
            />
          </Section>

          <Section title={t("applications.detail.notices")}>
            <FieldList
              testId="application-notices"
              rows={[
                [
                  t("applications.detail.teamNotice"),
                  t(`applications.detail.noticeOutcome.${detail.teamNotice}`),
                  "team",
                ],
                [
                  t("applications.detail.receiptNotice"),
                  t(
                    `applications.detail.noticeOutcome.${detail.receiptNotice}`,
                  ),
                  "receipt",
                ],
              ]}
            />
          </Section>

          {detail.otherApplications.length > 0 ? (
            <Section title={t("applications.detail.otherApplications")}>
              <ul
                className="flex flex-col gap-2"
                data-testid="application-others"
              >
                {detail.otherApplications.map((other) => (
                  <li key={other.id} className="text-sm">
                    <Link
                      href={`${APPLICATIONS_ROUTE}/${other.id}`}
                      className="text-foreground underline underline-offset-4"
                    >
                      {formatMskDateTime(other.submittedAt)}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      ·{" "}
                      {t(
                        applicationStatusLabelKey(other.status, other.outcome),
                      )}
                      {other.erased
                        ? ` · ${t("applications.marks.erased")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-2 border-hairline bg-card p-4">
      <h2 className="mb-3 text-base font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function FieldList({
  rows,
  testId,
}: {
  rows: [label: string, value: string, key: string][];
  testId: string;
}) {
  return (
    <dl className="flex flex-col gap-3" data-testid={testId}>
      {rows.map(([label, value, key]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
