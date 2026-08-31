"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Switch } from "@ds/design-system";
import { Combobox } from "@ds/design-system/blocks";
import type {
  CreateEventDirectionRequest,
  EventDirectionAdminDetail,
  EventDirectionAdminList,
} from "@ds/schemas";
import { RelationshipEndpointPicker } from "@/components/relationship-endpoint-picker";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { eventDirectionsUrl } from "@/providers/data-provider";
import { LifecycleImpactDialog } from "@/components/lifecycle-impact-dialog";
import { useRelationshipCombobox } from "@/lib/use-relationship-combobox";

/**
 * The event↔direction relationship editor (012 EARS-11, 012-design §5.1/§7; #1293).
 *
 * ONE component serves BOTH directions because §5.1 serves both from one filtered
 * route and AUTHORS through that same command from both endpoint details. The
 * only difference is which endpoint is fixed and which one the operator selects.
 *
 * EXISTING DIRECTIONS ONLY (EARS-11). The picker offers rows the directions catalogue
 * already holds — there is no inline creation here, because a direction invented
 * mid-link would enter the taxonomy without ever passing the direction form.
 *
 * NO DELETE (EARS-14). Retire/restore move the SAME row through the §3.1
 * confirmation gate; a retired link stays listed behind its toggle, exactly as a
 * retired recording does.
 */
export function EventDirectionsPanel({
  mode,
  entityId,
}: {
  /** Which endpoint the operator is standing on — it decides the list filter. */
  mode: "event" | "direction";
  entityId: string;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const listUrl = eventDirectionsUrl.list({
    ...(mode === "event" ? { eventId: entityId } : { directionId: entityId }),
    includeRetired: true,
  });
  const { query } = useCustom<EventDirectionAdminList>({
    url: listUrl,
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

  // The QUERY is the source of presence, not `result`: Refine's `result.data`
  // substitutes a frozen `{}` when the query has no answer, so a check against it
  // reads "loaded" for a failed read and then trips over `list.data`.
  const list = query.data?.data;
  if (!list) {
    return (
      <Alert variant="danger" data-testid="event-directions-error">
        {t("eventDirections.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");

  return (
    <div className="flex flex-col gap-6" data-testid="event-directions-panel">
      <p className="text-sm text-muted-foreground">
        {t(`eventDirections.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="event-directions-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="event-directions-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      {mode === "event" ? (
        <LinkForm
          eventId={entityId}
          linkedDirectionIds={list.data.map((row) => row.directionId)}
          onLinked={() => announce("eventDirections.toast.linked")}
          onError={(error) => fail(error, "eventDirections.errors.linkFailed")}
        />
      ) : (
        <ReverseLinkForm
          directionId={entityId}
          linkedEventIds={list.data.map((row) => row.eventId)}
          onLinked={() => announce("eventDirections.toast.linked")}
          onError={(error) => fail(error, "eventDirections.errors.linkFailed")}
        />
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`eventDirections.activeTitle.${mode}`)}
        </h3>
        {active.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="event-directions-empty"
          >
            {t(`eventDirections.empty.${mode}`)}
          </p>
        ) : (
          active.map((row) => (
            <LinkRow
              key={row.id}
              row={row}
              mode={mode}
              onDone={announce}
              onError={fail}
            />
          ))
        )}
      </section>

      <div className="flex flex-col gap-3 border-t-2 border-border pt-6">
        {/* The DS Switch wraps its own <label>, so the visible text is its child —
            a sibling <label htmlFor> would name the control twice. */}
        <Switch
          id="event-directions-show-retired"
          data-testid="event-directions-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("eventDirections.showRetired")}
        </Switch>
        {showRetired ? (
          <div
            className="flex flex-col gap-3"
            data-testid="event-directions-retired"
          >
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("eventDirections.retiredEmpty")}
              </p>
            ) : (
              retired.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  mode={mode}
                  onDone={announce}
                  onError={fail}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {t("eventDirections.noDeleteNote")}
      </p>
    </div>
  );
}

/** Reverse authoring fixes the direction endpoint and selects an existing event. */
function ReverseLinkForm({
  directionId,
  linkedEventIds,
  onLinked,
  onError,
}: {
  directionId: string;
  linkedEventIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [eventId, setEventId] = useState("");
  const { mutate, mutation } = useCustomMutation();

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="event-direction-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("eventDirections.linkEventTitle")}
      </h3>
      <RelationshipEndpointPicker
        endpoint="event"
        excludedIds={linkedEventIds}
        value={eventId}
        onChange={setEventId}
        testIdPrefix="event-direction-link"
        copy={{
          search: t("eventDirections.fields.eventSearch"),
          searchPlaceholder: t("eventDirections.fields.eventSearchPlaceholder"),
          select: t("eventDirections.fields.event"),
          selectPlaceholder: t("eventDirections.fields.eventPlaceholder"),
          noOptions: t("eventDirections.fields.noEventOptions"),
        }}
      />
      <div>
        <Button
          type="button"
          size="sm"
          data-testid="event-direction-link-submit"
          loading={mutation.isPending}
          disabled={eventId.length === 0}
          onClick={() => {
            const body: CreateEventDirectionRequest = { eventId, directionId };
            mutate(
              {
                url: eventDirectionsUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setEventId("");
                  onLinked();
                },
                onError,
              },
            );
          }}
        >
          {t("eventDirections.action.link")}
        </Button>
      </div>
    </section>
  );
}

type DoneHandler = (toastKey: string) => void;
type ErrorHandler = (error: unknown, fallbackKey: string) => void;

/** One relationship — the opposite endpoint, its state, and its §3.1 transition. */
function LinkRow({
  row,
  mode,
  onDone,
  onError,
}: {
  row: EventDirectionAdminDetail;
  mode: "event" | "direction";
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  // The operator is standing on one endpoint, so the row names the OTHER one:
  // repeating the event's own title on the event detail would carry no
  // information and push the useful half off a narrow viewport.
  const title = mode === "event" ? row.directionTitle : row.eventTitle;
  const slug = mode === "event" ? row.directionSlug : row.eventSlug;
  const transition = row.status === "active" ? "retire" : "restore";

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`event-direction-row-${row.id}`}
    >
      <span
        className="text-sm font-bold text-foreground"
        data-testid={`event-direction-title-${row.id}`}
      >
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{slug}</span>
      <Badge variant="label" data-testid={`event-direction-status-${row.id}`}>
        {t(`eventDirections.statuses.${row.status}`)}
      </Badge>
      <LifecycleImpactDialog
        // `useCustom` inside the dialog caches per URL, and a confirmed
        // transition changes what the NEXT preview would say. Keying on the row
        // version remounts the dialog after every transition, so the second
        // opening can never render the first one's affected list.
        key={`${row.id}:${row.version}`}
        transition={transition}
        impactUrl={eventDirectionsUrl.impact(row.id, transition)}
        confirmUrl={eventDirectionsUrl.transition(row.id, transition)}
        version={row.version}
        triggerLabel={t(`eventDirections.action.${transition}`)}
        testId={`event-direction-${transition}-${row.id}`}
        namespace="eventDirections"
        onConfirmed={onDone}
        onError={onError}
      />
    </div>
  );
}

/**
 * The add-link control (§7): a searchable direction selector, never a free-text id.
 *
 * The picker is the shared list-shell search plus a native select narrowed
 * SERVER-SIDE by `?q=` — the same selector ruling #1289 landed on. The admin
 * direction list already excludes retired rows by default, so a retired direction is
 * simply not offerable (EARS-11 «existing non-retired directions only»); an
 * already-linked one is filtered out here, because a choice that can only ever
 * come back 409 is not a choice.
 */
function LinkForm({
  eventId,
  linkedDirectionIds,
  onLinked,
  onError,
}: {
  eventId: string;
  linkedDirectionIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [directionId, setDirectionId] = useState("");
  const { mutate, mutation } = useCustomMutation();
  const picker = useRelationshipCombobox({
    resource: "directions",
    excludedIds: linkedDirectionIds,
    value: directionId,
  });

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="event-direction-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("eventDirections.linkTitle")}
      </h3>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="event-direction-link-combobox"
        >
          {t("eventDirections.fields.direction")}
        </label>
        <Combobox
          id="event-direction-link-combobox"
          options={picker.options}
          value={directionId || null}
          onValueChange={(next) => {
            picker.select(next);
            setDirectionId(next);
          }}
          onSearchChange={picker.search}
          onLoadMore={picker.loadMore}
          hasMore={picker.hasMore}
          loadingMore={picker.loadingMore}
          loadMoreError={picker.loadMoreError}
          loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
          loadingMoreLabel={t("relationshipEndpointPicker.loadingMore")}
          loadMoreErrorLabel={t("relationshipEndpointPicker.retryLoadMore")}
          placeholder={t("eventDirections.fields.directionPlaceholder")}
          searchLabel={t("eventDirections.fields.search")}
          searchPlaceholder={t("eventDirections.fields.searchPlaceholder")}
          emptyLabel={
            picker.isLoading
              ? t("common.loading")
              : picker.isError
                ? t("relationshipEndpointPicker.loadFailed")
                : t("eventDirections.fields.noOptions")
          }
          showSearch
          aria-label={t("eventDirections.fields.direction")}
        />
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="event-direction-link-submit"
          loading={mutation.isPending}
          disabled={directionId.length === 0}
          onClick={() => {
            const body: CreateEventDirectionRequest = { eventId, directionId };
            mutate(
              {
                url: eventDirectionsUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setDirectionId("");
                  onLinked();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("eventDirections.action.link")}
        </Button>
      </div>
    </section>
  );
}
