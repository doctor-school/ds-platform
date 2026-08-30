"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useCustom, useCustomMutation, useList, useOne } from "@refinedev/core";
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
  ADMIN_LIST_PAGE_SIZE_MAX,
  type CreateEventExpertRequest,
  type EventAdminDetail,
  type EventExpertAdminList,
  type EventExpertAdminListItem,
  type ExpertAdminDetail,
  type ExpertAdminListItem,
  type UpdateEventExpertRequest,
} from "@ds/schemas";
import {
  EventExpertFormSchema,
  type EventExpertFormFields,
} from "@/lib/form-schemas";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { eventExpertsUrl } from "@/providers/data-provider";
import { RelationshipEndpointPicker } from "@/components/relationship-endpoint-picker";

/**
 * The 012 EARS-7 event↔expert link editor (#1289), embedded from either endpoint.
 *
 * PLACEMENT comes from 012-design §7: «the admin owns four resource
 * lists/details/forms plus relationship editors EMBEDDED IN THE EXISTING 007
 * EVENT FORM and the endpoint details». It is not a fifth top-level resource
 * list: the same panel authors «who speaks at this event» from the event or
 * expert currently in context. It extends the tab composition the Stage-A owner
 * pick settled (#1282, option B).
 *
 * NO DELETE, anywhere (012-design §5.1). Retire frees the slot in the merged
 * speaker projection and keeps the row addressable; restore brings it back. The
 * panel says that in plain RU rather than leaving the operator to guess whether
 * «отозвать» destroys anything.
 *
 * THE ENDPOINTS ARE NOT PATCHABLE. Re-pointing a link at another expert or event
 * would rewrite a row the audit ledger already attributes, so the edit dialog
 * renders the expert as a FACT and offers only role + slot; changing the expert
 * is a retire plus a new link, and the copy says so.
 *
 * Every write rides the provider's `custom` path, which owns the EARS-16/17
 * protocol headers: a fresh `Idempotency-Key` per call, and `If-Match` built from
 * the `version` this panel rendered the row from. A stale version comes back as
 * 412 and is SHOWN («связь изменилась в другом окне») — never applied blindly.
 */
export function EventExpertsPanel({
  mode,
  entityId,
}: {
  mode: "event" | "expert";
  entityId: string;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  // One read for both halves of the surface: the retired rows are not a separate
  // resource, they are the same list without the default filter, and fetching
  // them only when the toggle flips would make «показать отозванные» a spinner
  // instead of a reveal.
  const { result, query } = useCustom<EventExpertAdminList>({
    url: eventExpertsUrl.collection({
      ...(mode === "event" ? { eventId: entityId } : { expertId: entityId }),
      includeRetired: true,
      pageSize: ADMIN_LIST_PAGE_SIZE_MAX,
    }),
    method: "get",
  });

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

  const list = result?.data;
  if (!list) {
    return (
      <Alert variant="danger" data-testid="event-experts-error">
        {t("eventExperts.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");

  return (
    <div className="flex flex-col gap-6" data-testid="event-experts-panel">
      <p className="text-sm text-muted-foreground">
        {t(`eventExperts.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="event-experts-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="event-experts-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      <div>
        <LinkDialog
          key={`add:${list.total}`}
          mode={mode}
          entityId={entityId}
          linkedEventIds={list.data.map((row) => row.eventId)}
          row={null}
          onDone={announce}
          onError={fail}
        />
      </div>

      {active.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="event-experts-empty"
        >
          {t(`eventExperts.empty.${mode}`)}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="event-experts-active">
          {active.map((row) => (
            <LinkRow
              key={row.id}
              mode={mode}
              entityId={entityId}
              row={row}
              onDone={announce}
              onError={fail}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t-2 border-border pt-6">
        {/* The DS Switch wraps its own <label>, so the visible text is its
            child — a sibling <label htmlFor> would name the control twice. */}
        <Switch
          id="event-experts-show-retired"
          data-testid="event-experts-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("eventExperts.showRetired")}
        </Switch>
        {showRetired ? (
          <div
            className="flex flex-col gap-3"
            data-testid="event-experts-retired"
          >
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("eventExperts.retiredEmpty")}
              </p>
            ) : (
              retired.map((row) => (
                <LinkRow
                  key={row.id}
                  mode={mode}
                  entityId={entityId}
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
        {t("eventExperts.noDeleteNote")}
      </p>
    </div>
  );
}

type DoneHandler = (toastKey: string) => void;
type ErrorHandler = (error: unknown, fallbackKey: string) => void;

/**
 * One link — the expert, the authored role, the slot it holds in the merged
 * speaker projection, its legacy-match state, and the actions its CURRENT status
 * allows (retire on an active row, restore on a retired one; never both).
 */
function LinkRow({
  mode,
  entityId,
  row,
  onDone,
  onError,
}: {
  mode: "event" | "expert";
  entityId: string;
  row: EventExpertAdminListItem;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const retiredRow = row.status === "retired";

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid={`event-expert-row-${row.id}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {mode === "event" ? (
            <ExpertName expertId={row.expertId} />
          ) : (
            <EventName eventId={row.eventId} />
          )}
        </h3>
        <Badge variant="label" data-testid={`event-expert-status-${row.id}`}>
          {t(`eventExperts.statuses.${row.status}`)}
        </Badge>
        <Badge variant="label" data-testid={`event-expert-legacy-${row.id}`}>
          {row.legacySpeakerId
            ? t("eventExperts.legacy.matched")
            : t("eventExperts.legacy.unmatched")}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Fact label={t("eventExperts.columns.role")}>
          {/* A null role means §2.4's editorial removal cleared it (#1306); the
              row still exists and still holds its slot, so it renders labelled
              rather than blank. */}
          <span data-testid={`event-expert-role-${row.id}`}>
            {row.role ?? t("common.notSet")}
          </span>
        </Fact>
        <Fact label={t("eventExperts.columns.position")}>
          <span data-testid={`event-expert-position-${row.id}`}>
            {String(row.position)}
          </span>
        </Fact>
      </dl>

      <div className="flex flex-wrap gap-2">
        {retiredRow ? null : (
          <LinkDialog
            // `useForm` captures its `defaultValues` ONCE, at mount. Keying the
            // dialog to the row identity AND its version remounts it after every
            // saved edit, so «Изменить» always opens on what is stored NOW.
            key={`${row.id}:${row.version}`}
            mode={mode}
            entityId={entityId}
            linkedEventIds={[]}
            row={row}
            onDone={onDone}
            onError={onError}
          />
        )}
        <CommandButton
          row={row}
          command={retiredRow ? "restore" : "retire"}
          onDone={onDone}
          onError={onError}
        />
        {row.legacySpeakerId && !retiredRow ? (
          <UnmatchButton row={row} onDone={onDone} onError={onError} />
        ) : null}
      </div>
    </section>
  );
}

/**
 * The expert's name, resolved per rendered row.
 *
 * The join list item carries `expertId` and no name (012-design §5.1 — the join
 * projection is the join's own columns), and an id is not something an operator
 * can recognise. Resolving here rather than pre-loading an expert index is what
 * keeps it CORRECT at any roster size: exactly the handful of experts actually
 * linked to this event are fetched, instead of one bounded page that would
 * silently fail to name anyone past its last row.
 */
function ExpertName({ expertId }: { expertId: string }) {
  const t = useTranslations();
  const { result, query } = useOne<ExpertAdminDetail>({
    resource: "experts",
    id: expertId,
  });

  if (query.isLoading) return <>{t("common.loading")}</>;
  if (!result) return <>{t("eventExperts.unknownExpert")}</>;
  // A null name means the expert was editorially removed (#1306, §2.4).
  return <>{result.name ?? t("experts.removedName")}</>;
}

/** Resolve the opposite event endpoint when the panel is mounted on an expert. */
function EventName({ eventId }: { eventId: string }) {
  const t = useTranslations();
  const { result, query } = useOne<EventAdminDetail>({
    resource: "events",
    id: eventId,
  });

  if (query.isLoading) return <>{t("common.loading")}</>;
  if (!result) return <>{t("eventExperts.unknownEvent")}</>;
  return <>{result.title}</>;
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
 * Retire or restore, behind a modal that must be ANSWERED.
 *
 * `AlertDialog`, not `Dialog`: retire pulls an expert out of the speaker list
 * every doctor sees on the event page and frees their slot; restore puts them
 * back and can be refused when the slot was taken meanwhile. Neither is a
 * walk-away action. The refusal is shown by keeping the modal's owner mounted —
 * the panel banner — rather than swallowed on close.
 */
function CommandButton({
  row,
  command,
  onDone,
  onError,
}: {
  row: EventExpertAdminListItem;
  command: "retire" | "restore";
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  const testId = `event-expert-${row.id}-${command}`;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId}>
          {t(`eventExperts.action.${command}`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid={`${testId}-confirm`}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`eventExperts.confirm.${command}Title`)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`eventExperts.confirm.${command}Body`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testId}-submit`}
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              mutate(
                {
                  url: eventExpertsUrl.command(row.id, command),
                  method: "post",
                  values: {},
                  meta: { version: row.version },
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    onDone(
                      command === "retire"
                        ? "eventExperts.toast.retired"
                        : "eventExperts.toast.restored",
                    );
                  },
                  onError: (error) => {
                    setOpen(false);
                    onError(error, "eventExperts.errors.commandFailed");
                  },
                },
              );
            }}
          >
            {t(`eventExperts.action.${command}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Drop the explicit legacy-speaker match (`legacySpeakerId: null`).
 *
 * An explicit `null` is the documented UNMATCH — distinguishable from omission,
 * which means «unchanged» (012-design §5.1). It is a visible editorial act: the
 * suppressed legacy speaker row becomes visible on the event page again, which
 * is why it confirms rather than firing from a bare click.
 */
function UnmatchButton({
  row,
  onDone,
  onError,
}: {
  row: EventExpertAdminListItem;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  const testId = `event-expert-${row.id}-unmatch`;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId}>
          {t("eventExperts.legacy.unmatch")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid={`${testId}-confirm`}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("eventExperts.legacy.unmatchTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("eventExperts.legacy.unmatchBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testId}-submit`}
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              const body: UpdateEventExpertRequest = { legacySpeakerId: null };
              mutate(
                {
                  url: eventExpertsUrl.row(row.id),
                  method: "patch",
                  values: body,
                  meta: { version: row.version },
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    onDone("eventExperts.toast.unmatched");
                  },
                  onError: (error) => {
                    setOpen(false);
                    onError(error, "eventExperts.errors.updateFailed");
                  },
                },
              );
            }}
          >
            {t("eventExperts.legacy.unmatch")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Create a link (no row) or edit one (row present) — one form, because both
 * author the same pair of editorial values.
 *
 * `Dialog`, not `AlertDialog`: a half-filled form the operator changes their mind
 * about is exactly the walk-away case.
 */
function LinkDialog({
  mode,
  entityId,
  linkedEventIds,
  row,
  onDone,
  onError,
}: {
  mode: "event" | "expert";
  entityId: string;
  linkedEventIds: string[];
  row: EventExpertAdminListItem | null;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const { mutate, mutation } = useCustomMutation();
  const form = useForm<EventExpertFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      EventExpertFormSchema as unknown as z.ZodType<
        EventExpertFormFields,
        EventExpertFormFields
      >,
      "eventExperts.validation",
    ),
    defaultValues: {
      expertId: row?.expertId ?? (mode === "expert" ? entityId : ""),
      role: row?.role ?? "",
      positionText: row ? String(row.position) : "",
    },
  });

  function submit(values: EventExpertFormFields) {
    const position = Number(values.positionText.trim());
    if (row) {
      const body: UpdateEventExpertRequest = {
        role: values.role.trim(),
        position,
      };
      mutate(
        {
          url: eventExpertsUrl.row(row.id),
          method: "patch",
          values: body,
          meta: { version: row.version },
        },
        {
          onSuccess: () => {
            setOpen(false);
            onDone("eventExperts.toast.updated");
          },
          onError: (error) => {
            setOpen(false);
            onError(error, "eventExperts.errors.updateFailed");
          },
        },
      );
      return;
    }

    // `legacySpeakerId` is deliberately absent, not empty: omitting it creates an
    // UNPAIRED link, which is a different outcome, not a degraded one. Choosing a
    // legacy speaker needs an admin read of the event's retained speaker rows,
    // which no route exposes yet (#1306 owns that surface) — so the panel never
    // offers a box that could only be filled with a hand-typed UUID.
    const body: CreateEventExpertRequest = {
      eventId: mode === "event" ? entityId : selectedEventId,
      expertId: mode === "expert" ? entityId : values.expertId,
      role: values.role.trim(),
      position,
    };
    mutate(
      { url: eventExpertsUrl.collection(), method: "post", values: body },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
          onDone("eventExperts.toast.added");
        },
        onError: (error) => {
          setOpen(false);
          onError(error, "eventExperts.errors.addFailed");
        },
      },
    );
  }

  const triggerLabel = row
    ? t("eventExperts.edit")
    : t(`eventExperts.add.${mode}`);
  const testId = row ? `event-expert-edit-${row.id}` : "event-expert-add";

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
              ? t("eventExperts.editTitle")
              : t(`eventExperts.addTitle.${mode}`)}
          </DialogTitle>
          <DialogDescription>
            {row
              ? t("eventExperts.editDescription")
              : t(`eventExperts.addDescription.${mode}`)}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            data-testid={`${testId}-form`}
            noValidate
            onSubmit={form.handleSubmit(submit)}
          >
            {row ? (
              // The endpoints are not patchable, so on an edit the expert is a
              // FACT, not a control: a disabled dropdown would invite an operator
              // to try, and the honest answer — «retire and link again» — is what
              // the dialog description says instead.
              <Fact
                label={t(
                  mode === "event"
                    ? "eventExperts.fields.expert"
                    : "eventExperts.fields.event",
                )}
              >
                <span data-testid={`${testId}-endpoint`}>
                  {mode === "event" ? (
                    <ExpertName expertId={row.expertId} />
                  ) : (
                    <EventName eventId={row.eventId} />
                  )}
                </span>
              </Fact>
            ) : mode === "event" ? (
              <ExpertPicker
                value={form.watch("expertId")}
                onChange={(next) =>
                  form.setValue("expertId", next, { shouldValidate: true })
                }
              />
            ) : (
              <RelationshipEndpointPicker
                endpoint="event"
                excludedIds={linkedEventIds}
                value={selectedEventId}
                onChange={setSelectedEventId}
                testIdPrefix="event-expert-event"
                copy={{
                  search: t("eventExperts.eventSearchLabel"),
                  searchPlaceholder: t("eventExperts.eventSearchPlaceholder"),
                  select: t("eventExperts.fields.event"),
                  selectPlaceholder: t("eventExperts.eventPlaceholder"),
                  noOptions: t("eventExperts.eventsEmpty"),
                }}
              />
            )}
            {row ? null : (
              <FormField
                control={form.control}
                name="expertId"
                render={() => (
                  <FormItem>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-role`}>
                    {t("eventExperts.fields.role")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={`${testId}-role`}
                      data-testid={`${testId}-role`}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage>{t("eventExperts.fields.roleHint")}</FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="positionText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${testId}-position`}>
                    {t("eventExperts.fields.position")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={`${testId}-position`}
                      data-testid={`${testId}-position`}
                      inputMode="numeric"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage>
                    {t("eventExperts.fields.positionHint")}
                  </FormMessage>
                </FormItem>
              )}
            />

            <p className="text-sm text-muted-foreground">
              {t("eventExperts.legacy.hint")}
            </p>

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
                disabled={
                  !row && mode === "expert" && selectedEventId.length === 0
                }
                data-testid={`${testId}-submit`}
              >
                {row
                  ? t("eventExperts.action.save")
                  : t("eventExperts.action.add")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Choose the expert to link: a SERVER-narrowed search box over the roster plus
 * the DS `NativeSelect` holding the result.
 *
 * The search runs on the api (`GET /v1/admin/experts?q=`), not over a page held
 * in the browser: an expert roster grows without bound, and a dropdown listing
 * only the first page would silently make the rest of the roster unlinkable.
 * `includeRetired` stays false — 012-design §7: «selectors exclude retired
 * rows» — while the detail routes can still open a retired expert for restore.
 *
 * Composed from two existing DS primitives (the same search-box-plus-select pair
 * the shared admin list shell mounts), so no new interactive element class is
 * introduced and every hover/focus/invalid state is the primitives' own.
 */
function ExpertPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const { result, query } = useList<ExpertAdminListItem>({
    resource: "experts",
    pagination: { currentPage: 1, pageSize: 50 },
    filters: [
      { field: "q", operator: "contains", value: search },
      { field: "includeRetired", operator: "eq", value: false },
    ],
  });

  const options = (result.data ?? []) as ExpertAdminListItem[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-expert-search">
          {t("eventExperts.expertSearchLabel")}
        </Label>
        <Input
          id="event-expert-search"
          data-testid="event-expert-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("eventExperts.expertSearchHint")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-expert-select">
          {t("eventExperts.fields.expert")}
        </Label>
        <NativeSelect
          id="event-expert-select"
          data-testid="event-expert-select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("common.notSet")}</option>
          {options.map((expert) => (
            <option key={expert.id} value={expert.id}>
              {expert.name ?? t("experts.removedName")}
            </option>
          ))}
        </NativeSelect>
        {query.isError ? (
          <p
            className="text-xs text-destructive"
            data-testid="event-expert-select-error"
          >
            {t("eventExperts.errors.expertsLoadFailed")}
          </p>
        ) : !query.isLoading && options.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="event-expert-select-empty"
          >
            {t("eventExperts.expertsEmpty")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
