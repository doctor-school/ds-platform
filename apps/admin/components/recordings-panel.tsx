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
  Label,
  NativeSelect,
} from "@ds/design-system";
import type {
  AppliedFilter,
  DataTableColumn,
} from "@ds/design-system/blocks";
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
  RECORDING_STATUSES,
  type RecordingAdminDetail,
  type RecordingAdminList,
  type RecordingCommand,
  type RecordingKind,
  type RecordingStatus,
  STREAM_PROVIDERS,
  type UpdateRecordingRequest,
} from "@ds/schemas";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { RecordingSourceFieldSet } from "@/components/recording-source-fields";
import {
  type RecordingExpectedByFields,
  RecordingExpectedByFormSchema,
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
  /**
   * The 014 EARS-22 list query. `kind` rides beside the shared state rather than
   * inside it because it is 014's own facet — the shared state carries what
   * every admin list has (`q` / `status` / `includeRetired` / the page), and a
   * resource facet reaches the composition as `extraFilters` plus a chip.
   */
  const [listQuery, setListQuery] =
    useState<AdminDataListQueryState<RecordingStatus>>(
      ADMIN_DATA_LIST_INITIAL_QUERY,
    );
  const [kind, setKind] = useState<RecordingKind | "">("");
  // Server-backed, never a client-side filter over a full roster: the URL IS the
  // query, so what the operator sees is what the database matched and `total` is
  // the size of the filtered set rather than of the page.
  const { query } = useCustom<RecordingAdminList>({
    url: recordingsUrl.collection(eventId, {
      page: listQuery.page,
      pageSize: listQuery.pageSize,
      q: listQuery.q,
      status: listQuery.status,
      kind,
      includeRetired: listQuery.includeRetired,
    }),
    method: "get",
  });
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  /**
   * A successful recording command refetches the EVENT as well as the panel:
   * since 014 EARS-25 the `hidden → in_archive` edge is offered only while the
   * эфир has a published recording, so publishing (or retiring) one here changes
   * the transitions bar on the «Основное» tab. Without this the operator
   * publishes the recording, switches tabs and finds no «Архивировать» until a
   * manual reload — the bar would be showing a precondition that no longer holds.
   */
  function announce(toastKey: string) {
    setErrorKey(null);
    setNoticeKey(toastKey);
    void query.refetch();
    onEventChanged();
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

  // The QUERY is the source of presence, not `result`: Refine's `result.data`
  // substitutes a frozen `{}` when the query has no answer, so a check against it
  // reads "loaded" for a failed read and then trips over `list.eventState` /
  // `list.data`.
  const list = query.data?.data;
  if (!list) {
    return (
      <Alert variant="danger" data-testid="recordings-error">
        {t("recordings.errors.loadFailed")}
      </Alert>
    );
  }

  const ended = list.eventState === "ended";

  const statusLabels: Record<RecordingStatus, string> = {
    draft: t("recordings.statuses.draft"),
    published: t("recordings.statuses.published"),
    retired: t("recordings.statuses.retired"),
  };

  /** The one resource facet 014 has, rendered inside the shared bar. */
  const kindFilter = (
    <div className="flex flex-col gap-1.5 sm:w-56">
      <Label htmlFor="recordings-history-kind">
        {t("recordings.history.kind")}
      </Label>
      <NativeSelect
        id="recordings-history-kind"
        value={kind}
        data-testid="recordings-history-kind"
        onChange={(event) => {
          setKind(event.target.value as RecordingKind | "");
          setListQuery({ ...listQuery, page: 1 });
        }}
      >
        <option value="">{t("recordings.history.kindAny")}</option>
        {RECORDING_KINDS.map((option) => (
          <option key={option} value={option}>
            {t(`recordings.kinds.${option}`)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  const kindApplied: AppliedFilter[] = kind
    ? [
        {
          id: "kind",
          label: t(`recordings.kinds.${kind}`),
          onRemove: () => {
            setKind("");
            setListQuery({ ...listQuery, page: 1 });
          },
        },
      ]
    : [];

  const historyColumns: DataTableColumn<RecordingAdminDetail>[] = [
    {
      key: "status",
      header: t("recordings.history.columns.status"),
      width: "16%",
      overflow: "wrap",
      fullValue: (row) => statusLabels[row.status],
      render: (row) => (
        <Badge variant="label" data-testid={`recording-row-status-${row.id}`}>
          {statusLabels[row.status]}
        </Badge>
      ),
    },
    {
      key: "source",
      header: t("recordings.history.columns.source"),
      width: "26%",
      fullValue: (row) => `${row.provider} · ${row.embedRef}`,
      render: (row) => (
        <span className="text-muted-foreground">
          {row.provider} · {row.embedRef}
        </span>
      ),
    },
    {
      key: "updatedAt",
      header: t("recordings.history.columns.updated"),
      width: "18%",
      fullValue: (row) => formatMskDateTime(row.updatedAt),
      render: (row) => (
        <span className="text-muted-foreground">
          {formatMskDateTime(row.updatedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("recordings.history.columns.actions"),
      width: "22%",
      overflow: "wrap",
      // `validCommands` is the SERVER's answer for this row in this event state,
      // so a command that cannot change anything is never rendered — there is no
      // present-but-doomed button here that would 409 if it were pressed
      // (014-design §7; EARS-22 «hide or disable every action that cannot change
      // state»). The row's own version rides each button as `If-Match`.
      fullValue: (row) =>
        row.validCommands
          .map((command) => t(`recordings.action.${command}`))
          .join(", "),
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          {row.validCommands.map((command) => (
            <CommandButton
              key={command}
              eventId={eventId}
              row={row}
              command={command}
              testId={`recording-row-${row.id}-${command}`}
              onDone={announce}
              onError={fail}
            />
          ))}
        </div>
      ),
    },
  ];

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
        onSaved={() => announce("recordings.toast.expectedBySaved")}
        onError={(error) => fail(error, "recordings.errors.expectedByFailed")}
      />

      {/* The two named slots come from `slots` — the server's UNFILTERED
          projection of the current row per kind. Deriving them from `data`
          would let a search box or a facet empty the operator's PRIMARY
          surface, which is a different thing from filtering the history. */}
      {RECORDING_KINDS.map((slotKind) => (
        <KindSlot
          key={slotKind}
          eventId={eventId}
          kind={slotKind}
          row={
            list.slots.find((candidate) => candidate.kind === slotKind) ?? null
          }
          onDone={announce}
          onError={fail}
        />
      ))}

      {/* 014 EARS-22 — the full history through the ONE admin list composition
          every other list mounts: instant search and facets, removable chips,
          one «Сбросить всё», a server-backed pager. `headingLevel={2}` because
          the event detail already owns the page's <h1>. */}
      <div className="border-t-2 border-border pt-6">
        <AdminDataList<RecordingAdminDetail, RecordingStatus>
          headingLevel={2}
          title={t("recordings.history.title")}
          description={t("recordings.history.description")}
          statuses={RECORDING_STATUSES}
          statusLabels={statusLabels}
          includeRetiredLabel={t("recordings.history.includeRetired")}
          searchLabel={t("recordings.history.searchLabel")}
          searchPlaceholder={t("recordings.history.searchPlaceholder")}
          extraFilters={kindFilter}
          extraApplied={kindApplied}
          caption={t("recordings.history.caption")}
          record={{
            header: t("recordings.history.columns.kind"),
            width: "18%",
            title: (row) => (
              <span data-testid={`recording-row-${row.id}`}>
                {t(`recordings.kinds.${row.kind}`)}
              </span>
            ),
            context: (row) => statusLabels[row.status],
            label: (row) => t(`recordings.kinds.${row.kind}`),
          }}
          columns={historyColumns}
          rows={list.data}
          getRowKey={(row) => row.id}
          total={list.total}
          isLoading={query.isFetching}
          error={query.isError ? t("recordings.errors.loadFailed") : null}
          query={listQuery}
          onQueryChange={setListQuery}
          emptyTitle={t("recordings.history.empty")}
          emptyDescription={t("recordings.history.emptyDescription")}
          testId="recordings-history"
        />
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
              // `useForm` captures its `defaultValues` ONCE, at mount, and this
              // instance survives every re-render of the slot — including the
              // `row: null → row` switch after an attach and each subsequent
              // correction. Keying it to the row identity AND its version remounts
              // the dialog whenever the stored source changes, so «Изменить»
              // always opens on what is stored now rather than on the empty (or
              // pre-edit) values the first mount captured.
              key={`${row.id}:${row.version}`}
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
              // Its own key, so retiring the last row (row → null) cannot leave
              // the previous holder's values sitting in the attach form.
              key="empty"
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
            <RecordingSourceFieldSet
              control={form.control}
              names={{
                provider: "provider",
                embedRef: "embedRef",
                posterRef: "posterRef",
                durationSecText: "durationSecText",
              }}
              fields="full"
              provider={form.watch("provider")}
              idPrefix={testId}
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
  // Validated against the SAME calendar-checked SSOT schema the API enforces, so
  // an impossible day («2026-13-45», pasted past the date control) is refused in
  // RU under the field instead of coming back as the server's generic
  // «проверьте поля»: the operator can only fix what the message names.
  const form = useForm<RecordingExpectedByFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      RecordingExpectedByFormSchema as unknown as z.ZodType<
        RecordingExpectedByFields,
        RecordingExpectedByFields
      >,
      "recordings.validation",
    ),
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
          // Through `handleSubmit`, not `getValues`: the save must run the same
          // guard the API does, and a refused day has to STOP here rather than
          // travel to the server and come back as a generic failure banner.
          onClick={form.handleSubmit((values) => {
            save(values.expectedBy.length === 0 ? null : values.expectedBy);
          })}
        >
          {t("recordings.action.saveExpectedBy")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="recording-expected-by-clear"
          onClick={() => {
            // Clearing is always legal — an empty box IS «no promise» — so it
            // must not stay blocked by a refusal the operator just erased.
            form.clearErrors("expectedBy");
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
