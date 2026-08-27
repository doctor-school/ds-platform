"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Input, Switch } from "@ds/design-system";
import type {
  CreateEventTopicRequest,
  EventTopicAdminDetail,
  EventTopicAdminList,
  TopicAdminList,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { eventTopicsUrl } from "@/providers/data-provider";
import { LifecycleImpactDialog } from "@/components/lifecycle-impact-dialog";

/**
 * The event↔topic relationship editor (012 EARS-11, 012-design §5.1/§7; #1293).
 *
 * ONE component serves BOTH directions because §5.1 serves both from one filtered
 * route: on the event detail it is the «Темы» tab and it AUTHORS links; on a topic
 * detail it is the «Эфиры» read view. The read side is deliberately not a second,
 * subtly-different list — a link is the same fact from either end, and the only
 * difference is which endpoint the operator is standing on.
 *
 * AUTHORING LIVES ON THE EVENT SIDE ONLY (§5.1). A topic is a long-lived
 * classifier an event is filed under, so the act reads «отнести эфир к теме»;
 * offering the mirror control on the topic detail would give one fact two
 * authoring homes and two places for it to drift.
 *
 * EXISTING TOPICS ONLY (EARS-11). The picker offers rows the topics catalogue
 * already holds — there is no inline creation here, because a topic invented
 * mid-link would enter the taxonomy without ever passing the topic form.
 *
 * NO DELETE (EARS-14). Retire/restore move the SAME row through the §3.1
 * confirmation gate; a retired link stays listed behind its toggle, exactly as a
 * retired recording does.
 */
export function EventTopicsPanel({
  mode,
  entityId,
}: {
  /** Which endpoint the operator is standing on — it decides the list filter. */
  mode: "event" | "topic";
  entityId: string;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const listUrl = eventTopicsUrl.list({
    ...(mode === "event" ? { eventId: entityId } : { topicId: entityId }),
    includeRetired: true,
  });
  const { query } = useCustom<EventTopicAdminList>({
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
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  // The QUERY is the source of presence, not `result`: Refine's `result.data`
  // substitutes a frozen `{}` when the query has no answer, so a check against it
  // reads "loaded" for a failed read and then trips over `list.data`.
  const list = query.data?.data;
  if (!list) {
    return (
      <Alert variant="danger" data-testid="event-topics-error">
        {t("eventTopics.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");

  return (
    <div className="flex flex-col gap-6" data-testid="event-topics-panel">
      <p className="text-sm text-muted-foreground">
        {t(`eventTopics.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="event-topics-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="event-topics-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      {mode === "event" ? (
        <LinkForm
          eventId={entityId}
          linkedTopicIds={list.data.map((row) => row.topicId)}
          onLinked={() => announce("eventTopics.toast.linked")}
          onError={(error) => fail(error, "eventTopics.errors.linkFailed")}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`eventTopics.activeTitle.${mode}`)}
        </h3>
        {active.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="event-topics-empty"
          >
            {t(`eventTopics.empty.${mode}`)}
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
          id="event-topics-show-retired"
          data-testid="event-topics-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("eventTopics.showRetired")}
        </Switch>
        {showRetired ? (
          <div className="flex flex-col gap-3" data-testid="event-topics-retired">
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("eventTopics.retiredEmpty")}
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
        {t("eventTopics.noDeleteNote")}
      </p>
    </div>
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
  row: EventTopicAdminDetail;
  mode: "event" | "topic";
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  // The operator is standing on one endpoint, so the row names the OTHER one:
  // repeating the event's own title on the event detail would carry no
  // information and push the useful half off a narrow viewport.
  const title = mode === "event" ? row.topicTitle : row.eventTitle;
  const slug = mode === "event" ? row.topicSlug : row.eventSlug;
  const transition = row.status === "active" ? "retire" : "restore";

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`event-topic-row-${row.id}`}
    >
      <span
        className="text-sm font-bold text-foreground"
        data-testid={`event-topic-title-${row.id}`}
      >
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{slug}</span>
      <Badge variant="label" data-testid={`event-topic-status-${row.id}`}>
        {t(`eventTopics.statuses.${row.status}`)}
      </Badge>
      <LifecycleImpactDialog
        // `useCustom` inside the dialog caches per URL, and a confirmed
        // transition changes what the NEXT preview would say. Keying on the row
        // version remounts the dialog after every transition, so the second
        // opening can never render the first one's affected list.
        key={`${row.id}:${row.version}`}
        transition={transition}
        impactUrl={eventTopicsUrl.impact(row.id, transition)}
        confirmUrl={eventTopicsUrl.transition(row.id, transition)}
        version={row.version}
        triggerLabel={t(`eventTopics.action.${transition}`)}
        testId={`event-topic-${transition}-${row.id}`}
        namespace="eventTopics"
        onConfirmed={onDone}
        onError={onError}
      />
    </div>
  );
}

/**
 * The add-link control (§7): a searchable topic selector, never a free-text id.
 *
 * The picker is the shared list-shell search plus a native select narrowed
 * SERVER-SIDE by `?q=` — the same selector ruling #1289 landed on. The admin
 * topic list already excludes retired rows by default, so a retired topic is
 * simply not offerable (EARS-11 «existing non-retired topics only»); an
 * already-linked one is filtered out here, because a choice that can only ever
 * come back 409 is not a choice.
 */
function LinkForm({
  eventId,
  linkedTopicIds,
  onLinked,
  onError,
}: {
  eventId: string;
  linkedTopicIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [topicId, setTopicId] = useState("");
  const { mutate, mutation } = useCustomMutation();

  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (search.trim().length > 0) query.set("q", search.trim());
  const { query: topicsQuery } = useCustom<TopicAdminList>({
    url: `/v1/admin/topics?${query.toString()}`,
    method: "get",
  });

  const options = (topicsQuery.data?.data.data ?? []).filter(
    (topic) => !linkedTopicIds.includes(topic.id),
  );

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="event-topic-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("eventTopics.linkTitle")}
      </h3>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="event-topic-link-search"
        >
          {t("eventTopics.fields.search")}
        </label>
        <Input
          id="event-topic-link-search"
          data-testid="event-topic-link-search"
          value={search}
          placeholder={t("eventTopics.fields.searchPlaceholder")}
          onChange={(event) => {
            setSearch(event.target.value);
            // The narrowed list may no longer contain the held choice, and a
            // hidden selection is exactly how an operator links the wrong row.
            setTopicId("");
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="event-topic-link-select"
        >
          {t("eventTopics.fields.topic")}
        </label>
        <TokenSelect
          id="event-topic-link-select"
          data-testid="event-topic-link-select"
          value={topicId}
          onChange={(event) => setTopicId(event.target.value)}
        >
          <option value="">{t("eventTopics.fields.topicPlaceholder")}</option>
          {options.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </TokenSelect>
        {options.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="event-topic-link-no-options"
          >
            {t("eventTopics.fields.noOptions")}
          </p>
        ) : null}
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="event-topic-link-submit"
          loading={mutation.isPending}
          disabled={topicId.length === 0}
          onClick={() => {
            const body: CreateEventTopicRequest = { eventId, topicId };
            mutate(
              { url: eventTopicsUrl.collection(), method: "post", values: body },
              {
                onSuccess: () => {
                  setTopicId("");
                  onLinked();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("eventTopics.action.link")}
        </Button>
      </div>
    </section>
  );
}
