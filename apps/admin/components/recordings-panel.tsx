"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useCustom, useCustomMutation, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Switch,
} from "@ds/design-system";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  type AttachRecordingRequest,
  RECORDING_KINDS,
  type RecordingAdminDetail,
  type RecordingAdminList,
  type RecordingCommand,
  type RecordingKind,
  STREAM_PROVIDERS,
  type UpdateRecordingRequest,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import {
  RecordingSourceFormSchema,
  type RecordingSourceFields,
} from "@/lib/form-schemas";
import { formatMskDateTime } from "@/lib/msk";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { recordingsUrl, type UpdateEventVars } from "@/providers/data-provider";

/**
 * The «Записи» tab of the feature-007 event detail (014 EARS-1 / EARS-2,
 * 014-design §7; Stage-A option B, Product Lead 2026-08-17).
 *
 * ONE ROW PER KIND, not a list. `edited` and `raw` are two named slots the
 * database itself keeps unique per event, so the panel shows the two slots
 * always — an empty one invites an attach, a filled one carries its status chip,
 * source, poster, duration and the §3 action set. Rendering «no recordings yet»
 * as an empty list would hide the fact that there are exactly two places a
 * recording can go.
 *
 * THE ACTION SET COMES FROM THE SERVER. Each row's `validCommands` is computed by
 * the api from the §3 transition table PLUS the event's own lifecycle state, so
 * Publish simply is not offered while the event is not `ended`. A button that
 * always 409s is a worse surface than no button — but silence would be worse
 * still, so the panel says WHY in a notice keyed to the event state.
 *
 * NO DELETE ANYWHERE (EARS-2). Retire is the terminal action, it frees the kind
 * slot, the row stays addressable, and restore brings it back. The panel says so
 * in plain language rather than leaving the operator to guess whether «отозвать»
 * destroys anything.
 */
export function RecordingsPanel({
  eventId,
  onEventChanged,
}: {
  eventId: string;
  onEventChanged: () => void;
}) {
  const t = useTranslations();
  const { result, query } = useCustom<RecordingAdminList>({
    url: recordingsUrl.collection(eventId),
    method: "get",
  });
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const list = result?.data;

  function announce(toastKey: string) {
    setErrorKey(null);
    setNoticeKey(toastKey);
    void query.refetch();
  }

  function fail(error: unknown, fallbackKey: string) {
    setNoticeKey(null);
    setErrorKey(taxonomyErrorKey(error, fallbackKey));
  }

  if (query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    );
  }
  if (!list) {
    return (
      <Alert variant="danger" data-testid="recordings-error">
        {t("recordings.errors.loadFailed")}
      </Alert>
    );
  }

  const ended = list.eventState === "ended";
  const retired = list.data.filter((row) => row.status === "retired");

  return (
    <div className="flex flex-col gap-6" data-testid="recordings-panel">
      <p className="text-sm text-muted-foreground">
        {t("recordings.description")}
      </p>

      <Alert
        variant={ended ? "success" : "info"}
        data-testid="recordings-event-state"
      >
        {ended
          ? t("recordings.eventStateReady")
          : t("recordings.eventStateNotice", {
              state: t(`events.state.${list.eventState}`),
            })}
      </Alert>

      {errorKey ? (
        <Alert variant="danger" data-testid="recordings-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="recordings-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      <ExpectedByForm
        eventId={eventId}
        value={list.recordingExpectedBy}
        onSaved={() => {
          announce("recordings.toast.expectedBySaved");
          onEventChanged();
        }}
        onError={(error) => fail(error, "recordings.errors.expectedByFailed")}
      />

      {RECORDING_KINDS.map((kind) => (
        <KindSlot
          key={kind}
          eventId={eventId}
          kind={kind}
          row={
            list.data.find(
              (candidate) =>
                candidate.kind === kind && candidate.status !== "retired",
            ) ?? null
          }
          onDone={announce}
          onError={fail}
        />
      ))}

      <div className="flex flex-col gap-3 border-t-2 border-border pt-6">
        {/* The DS Switch wraps its own <label>, so the visible text is its
            child — a sibling <label htmlFor> would name the control twice. */}
        <Switch
          id="show-retired"
          data-testid="recordings-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("recordings.showRetired")}
        </Switch>
        {showRetired ? (
          <div className="flex flex-col gap-3" data-testid="recordings-retired">
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("recordings.retiredEmpty")}
              </p>
            ) : (
              retired.map((row) => (
                <RetiredRow
                  key={row.id}
                  eventId={eventId}
                  row={row}
                  onDone={announce}
                  onError={fail}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {t("recordings.noDeleteNote")}
      </p>
    </div>
  );
}

type DoneHandler = (toastKey: string) => void;
type ErrorHandler = (error: unknown, fallbackKey: string) => void;

/** The RU toast key each §3 command reports on success. */
const COMMAND_TOAST: Record<RecordingCommand, string> = {
  publish: "recordings.toast.published",
  unpublish: "recordings.toast.unpublished",
  retire: "recordings.toast.retired",
  restore: "recordings.toast.restored",
};

/** One kind slot — either the attached row and its actions, or the empty invite. */
function KindSlot({
  eventId,
  kind,
  row,
  onDone,
  onError,
}: {
  eventId: string;
  kind: RecordingKind;
  row: RecordingAdminDetail | null;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid={`recording-slot-${kind}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`recordings.kinds.${kind}`)}
        </h3>
        {row ? (
          <Badge variant="label" data-testid={`recording-status-${kind}`}>
            {t(`recordings.statuses.${row.status}`)}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {t(`recordings.kindHint.${kind}`)}
      </p>

      {row ? (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Fact label={t("recordings.fields.provider")}>
              {t(`events.providers.${row.provider}`)}
            </Fact>
            <Fact label={t("recordings.fields.embedRef")}>
              <span data-testid={`recording-embed-ref-${kind}`}>
                {row.embedRef}
              </span>
            </Fact>
            <Fact label={t("recordings.fields.posterRef")}>
              {row.posterRef ?? t("common.notSet")}
            </Fact>
            <Fact label={t("recordings.fields.durationSec")}>
              {row.durationSec === null
                ? t("common.notSet")
                : String(row.durationSec)}
            </Fact>
            <Fact label={t("recordings.fields.firstPublishedAt")}>
              {/* The operator reads Moscow wall-clock everywhere else on this
                  page (the event header, the list); a raw ISO instant here would
                  be the one date on the surface they have to convert by hand. */}
              {row.firstPublishedAt
                ? `${formatMskDateTime(row.firstPublishedAt)} ${t("events.mskSuffix")}`
                : t("common.notSet")}
            </Fact>
          </dl>
          <div className="flex flex-wrap gap-2">
            <SourceDialog
              eventId={eventId}
              kind={kind}
              row={row}
              onDone={onDone}
              onError={onError}
            />
            {row.validCommands.map((command) => (
              <CommandButton
                key={command}
                eventId={eventId}
                row={row}
                command={command}
                testId={`recording-${kind}-${command}`}
                onDone={onDone}
                onError={onError}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p
            className="text-sm text-muted-foreground"
            data-testid={`recording-empty-${kind}`}
          >
            {t("recordings.empty")}
          </p>
          <div>
            <SourceDialog
              eventId={eventId}
              kind={kind}
              row={null}
              onDone={onDone}
              onError={onError}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** A retired row — addressable, listed, and restorable. Never deletable. */
function RetiredRow({
  eventId,
  row,
  onDone,
  onError,
}: {
  eventId: string;
  row: RecordingAdminDetail;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`recording-retired-${row.kind}`}
    >
      <span className="text-sm font-bold text-foreground">
        {t(`recordings.kinds.${row.kind}`)}
      </span>
      <Badge variant="label">{t(`recordings.statuses.${row.status}`)}</Badge>
      <span className="text-sm text-muted-foreground">{row.embedRef}</span>
      {row.validCommands.map((command) => (
        <CommandButton
          key={command}
          eventId={eventId}
          row={row}
          command={command}
          testId={`recording-retired-${row.kind}-${command}`}
          onDone={onDone}
          onError={onError}
        />
      ))}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A §3 command behind its modal confirmation (014-design §7: «every
 * status-changing action confirms in a modal before it fires»).
 *
 * `AlertDialog`, not `Dialog`: publish makes a recording visible to every doctor
 * on the event page and retire pulls it back — an operator must ANSWER, not
 * dismiss. The row `version` rides `meta` so the provider can send `If-Match`;
 * a stale one comes back as 412 and is shown, never applied blindly.
 */
function CommandButton({
  eventId,
  row,
  command,
  testId,
  onDone,
  onError,
}: {
  eventId: string;
  row: RecordingAdminDetail;
  command: RecordingCommand;
  testId: string;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mutate, mutation } = useCustomMutation();

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId}>
          {t(`recordings.action.${command}`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid={`${testId}-confirm`}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`recordings.confirm.${command}Title`)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`recordings.confirm.${command}Body`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testId}-submit`}
            disabled={mutation.isPending}
            onClick={(event) => {
              // Keep the modal mounted until the command resolves: closing it on
              // click would hide the refusal the operator needs to read.
              event.preventDefault();
              mutate(
                {
                  url: recordingsUrl.command(eventId, row.id, command),
                  method: "post",
                  values: {},
                  meta: { version: row.version },
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    onDone(COMMAND_TOAST[command]);
                  },
                  onError: (error) => {
                    setOpen(false);
                    onError(error, "recordings.errors.commandFailed");
                  },
                },
              );
            }}
          >
            {t(`recordings.action.${command}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Attach (no row yet) or edit the source (row present) — one form, because both
 * author the same source triple. `Dialog`, not `AlertDialog`: a half-filled form
 * an operator changes their mind about is exactly the walk-away case.
 *
 * The empty boxes mean «none», so they are sent as `null` on an edit (which
 * clears the field) and simply omitted on an attach.
 */
function SourceDialog({
  eventId,
  kind,
  row,
  onDone,
  onError,
}: {
  eventId: string;
  kind: RecordingKind;
  row: RecordingAdminDetail | null;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  const form = useForm<RecordingSourceFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      RecordingSourceFormSchema as unknown as z.ZodType<
        RecordingSourceFields,
        RecordingSourceFields
      >,
      "recordings.validation",
    ),
    defaultValues: {
      provider: row?.provider ?? STREAM_PROVIDERS[0],
      embedRef: row?.embedRef ?? "",
      posterRef: row?.posterRef ?? "",
      durationSecText:
        row?.durationSec === undefined || row?.durationSec === null
          ? ""
          : String(row.durationSec),
    },
  });

  function submit(values: RecordingSourceFields) {
    const posterRef = values.posterRef.trim();
    const durationText = values.durationSecText.trim();
    const durationSec = durationText.length === 0 ? null : Number(durationText);

    if (row) {
      const body: UpdateRecordingRequest = {
        provider: values.provider,
        embedRef: values.embedRef.trim(),
        posterRef: posterRef.length === 0 ? null : posterRef,
        durationSec,
      };
      mutate(
        {
          url: recordingsUrl.row(eventId, row.id),
          method: "patch",
          values: body,
          meta: { version: row.version },
        },
        {
          onSuccess: () => {
            setOpen(false);
            onDone("recordings.toast.updated");
          },
          onError: (error) => {
            setOpen(false);
            onError(error, "recordings.errors.updateFailed");
          },
        },
      );
      return;
    }

    const body: AttachRecordingRequest = {
      kind,
      provider: values.provider,
      embedRef: values.embedRef.trim(),
      ...(posterRef.length === 0 ? {} : { posterRef }),
      ...(durationSec === null ? {} : { durationSec }),
    };
    mutate(
      {
        url: recordingsUrl.collection(eventId),
        method: "post",
        values: body,
      },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
          onDone("recordings.toast.attached");
        },
        onError: (error) => {
          setOpen(false);
          onError(error, "recordings.errors.attachFailed");
        },
      },
    );
  }

  const triggerLabel = row ? t("recordings.edit") : t("recordings.attach");
  const testId = row ? `recording-edit-${kind}` : `recording-attach-${kind}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={row ? "outline" : "default"}
          size="sm"
          data-testid={testId}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid={`${testId}-dialog`}>
        <DialogHeader>
          <DialogTitle>
            {row
              ? t("recordings.editTitle", {
                  kind: t(`recordings.kinds.${kind}`),
                })
              : t("recordings.attachTitle", {
                  kind: t(`recordings.kinds.${kind}`),
                })}
          </DialogTitle>
          <DialogDescription>
            {t(`recordings.kindHint.${kind}`)}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            data-testid={`${testId}-form`}
            noValidate
            onSubmit={form.handleSubmit(submit)}
          >
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-provider`}>
                    {t("recordings.fields.provider")}
                  </FormLabel>
                  <FormControl>
                    <TokenSelect
                      id={`${testId}-provider`}
                      data-testid={`${testId}-provider`}
                      {...field}
                    >
                      {STREAM_PROVIDERS.map((provider) => (
                        <option key={provider} value={provider}>
                          {t(`events.providers.${provider}`)}
                        </option>
                      ))}
                    </TokenSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="embedRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-embed-ref`}>
                    {t("recordings.fields.embedRef")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={`${testId}-embed-ref`}
                      data-testid={`${testId}-embed-ref`}
                      {...field}
                    />
                  </FormControl>
                  {/* The reference shape differs per provider (#1134) — the hint
                      tracks the selected one, exactly as the stream form does. */}
                  <FormMessage>
                    {t(`events.fields.embedRefHint.${form.watch("provider")}`)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="posterRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-poster-ref`}>
                    {t("recordings.fields.posterRef")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={`${testId}-poster-ref`}
                      data-testid={`${testId}-poster-ref`}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage>
                    {t("recordings.fields.posterRefHint")}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="durationSecText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-duration`}>
                    {t("recordings.fields.durationSec")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={`${testId}-duration`}
                      data-testid={`${testId}-duration`}
                      inputMode="numeric"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage>
                    {t("recordings.fields.durationSecHint")}
                  </FormMessage>
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                data-testid={`${testId}-submit`}
              >
                {triggerLabel}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The event-level readiness date («запись ожидается к»), written through feature
 * 007's own `PATCH /v1/admin/events/:id` — it is a fact about the EVENT, not
 * about any one recording, which is why it is not a column on `event_recordings`.
 *
 * A plain `Input type="date"`: Stage A recorded the deliberate NON-adoption of a
 * date-picker runtime for the admin, so the browser's own control is the picker.
 */
function ExpectedByForm({
  eventId,
  value,
  onSaved,
  onError,
}: {
  eventId: string;
  value: string | null;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  // A real react-hook-form context, not a bare `FormItem`: the DS `FormControl`
  // reads `useFormContext()` for its id/aria wiring, so a `FormItem` rendered
  // outside a `<Form>` throws on render. One field, one form — the same
  // composition the attach dialog uses.
  const form = useForm<{ expectedBy: string }>({
    defaultValues: { expectedBy: value ?? "" },
  });
  const { mutate: update, mutation } = useUpdate();

  function save(next: string | null) {
    const vars: UpdateEventVars = { recordingExpectedBy: next };
    update(
      { resource: "events", id: eventId, values: vars },
      { onSuccess: () => onSaved(), onError: (error) => onError(error) },
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="recording-expected-by">
      <Form {...form}>
        <FormField
          control={form.control}
          name="expectedBy"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="recording-expected-by">
                {t("recordings.fields.expectedBy")}
              </FormLabel>
              <FormControl>
                <Input
                  id="recording-expected-by"
                  type="date"
                  data-testid="recording-expected-by-input"
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("recordings.fields.expectedByHint")}</FormMessage>
            </FormItem>
          )}
        />
      </Form>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          loading={mutation.isPending}
          data-testid="recording-expected-by-save"
          onClick={() => {
            const next = form.getValues("expectedBy");
            save(next.length === 0 ? null : next);
          }}
        >
          {t("recordings.action.saveExpectedBy")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="recording-expected-by-clear"
          onClick={() => {
            form.setValue("expectedBy", "");
            save(null);
          }}
        >
          {t("recordings.action.clearExpectedBy")}
        </Button>
      </div>
    </div>
  );
}
