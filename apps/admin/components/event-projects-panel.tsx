"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Input, Switch } from "@ds/design-system";
import type {
  CreateEventProjectRequest,
  EventProjectAdminDetail,
  EventProjectAdminList,
  ProjectAdminList,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { eventProjectsUrl } from "@/providers/data-provider";
import { LifecycleImpactDialog } from "@/components/lifecycle-impact-dialog";

/**
 * The event↔project relationship editor (012 EARS-6, 012-design §5.1/§7; #1288).
 *
 * ONE component serves BOTH directions because §5.1 serves both from one filtered
 * route: on the event detail it is the «Проекты» tab and it AUTHORS links; on the
 * project detail it is the «События» read view. The read side is deliberately not
 * a second, subtly-different list — a link is the same fact from either end, and
 * the only difference is which endpoint the operator is standing on.
 *
 * AUTHORING LIVES ON THE EVENT SIDE ONLY (§5.1). A project is a long-lived
 * container an event is added to, so the act reads «добавить проект к этому
 * эфиру»; offering the mirror control on the project detail would give one fact
 * two authoring homes and two places for it to drift.
 *
 * NO DELETE (EARS-14). Retire/restore move the SAME row through the §3.1
 * confirmation gate; a retired link stays listed behind its toggle, exactly as a
 * retired recording does.
 */
export function EventProjectsPanel({
  mode,
  entityId,
}: {
  /** Which endpoint the operator is standing on — it decides the list filter. */
  mode: "event" | "project";
  entityId: string;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const listUrl = eventProjectsUrl.list({
    ...(mode === "event" ? { eventId: entityId } : { projectId: entityId }),
    includeRetired: true,
  });
  const { result, query } = useCustom<EventProjectAdminList>({
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

  const list = result?.data;
  if (!list) {
    return (
      <Alert variant="danger" data-testid="event-projects-error">
        {t("eventProjects.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");

  return (
    <div className="flex flex-col gap-6" data-testid="event-projects-panel">
      <p className="text-sm text-muted-foreground">
        {t(`eventProjects.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="event-projects-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="event-projects-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      {mode === "event" ? (
        <LinkForm
          eventId={entityId}
          linkedProjectIds={list.data.map((row) => row.projectId)}
          onLinked={() => announce("eventProjects.toast.linked")}
          onError={(error) => fail(error, "eventProjects.errors.linkFailed")}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`eventProjects.activeTitle.${mode}`)}
        </h3>
        {active.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="event-projects-empty"
          >
            {t(`eventProjects.empty.${mode}`)}
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
          id="event-projects-show-retired"
          data-testid="event-projects-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("eventProjects.showRetired")}
        </Switch>
        {showRetired ? (
          <div className="flex flex-col gap-3" data-testid="event-projects-retired">
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("eventProjects.retiredEmpty")}
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
        {t("eventProjects.noDeleteNote")}
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
  row: EventProjectAdminDetail;
  mode: "event" | "project";
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  // The operator is standing on one endpoint, so the row names the OTHER one:
  // repeating the event's own title on the event detail would carry no
  // information and push the useful half off a narrow viewport.
  const title = mode === "event" ? row.projectTitle : row.eventTitle;
  const slug = mode === "event" ? row.projectSlug : row.eventSlug;
  const transition = row.status === "active" ? "retire" : "restore";

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`event-project-row-${row.id}`}
    >
      <span
        className="text-sm font-bold text-foreground"
        data-testid={`event-project-title-${row.id}`}
      >
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{slug}</span>
      <Badge variant="label" data-testid={`event-project-status-${row.id}`}>
        {t(`eventProjects.statuses.${row.status}`)}
      </Badge>
      <LifecycleImpactDialog
        // `useCustom` inside the dialog caches per URL, and a confirmed
        // transition changes what the NEXT preview would say. Keying on the row
        // version remounts the dialog after every transition, so the second
        // opening can never render the first one's affected list.
        key={`${row.id}:${row.version}`}
        transition={transition}
        impactUrl={eventProjectsUrl.impact(row.id, transition)}
        confirmUrl={eventProjectsUrl.transition(row.id, transition)}
        version={row.version}
        triggerLabel={t(`eventProjects.action.${transition}`)}
        testId={`event-project-${transition}-${row.id}`}
        namespace="eventProjects"
        onConfirmed={onDone}
        onError={onError}
      />
    </div>
  );
}

/**
 * The add-link control (§7): a searchable project selector, never a free-text id.
 *
 * The picker is the shared list-shell search plus a native select narrowed
 * SERVER-SIDE by `?q=` — the same selector ruling #1289 landed on. The admin
 * project list already excludes retired rows by default, so a retired project is
 * simply not offerable (§7); an already-linked one is filtered out here, because
 * a choice that can only ever come back 409 is not a choice.
 */
function LinkForm({
  eventId,
  linkedProjectIds,
  onLinked,
  onError,
}: {
  eventId: string;
  linkedProjectIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const { mutate, mutation } = useCustomMutation();

  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (search.trim().length > 0) query.set("q", search.trim());
  const { result } = useCustom<ProjectAdminList>({
    url: `/v1/admin/projects?${query.toString()}`,
    method: "get",
  });

  const options = (result?.data.data ?? []).filter(
    (project) => !linkedProjectIds.includes(project.id),
  );

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="event-project-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("eventProjects.linkTitle")}
      </h3>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="event-project-link-search"
        >
          {t("eventProjects.fields.search")}
        </label>
        <Input
          id="event-project-link-search"
          data-testid="event-project-link-search"
          value={search}
          placeholder={t("eventProjects.fields.searchPlaceholder")}
          onChange={(event) => {
            setSearch(event.target.value);
            // The narrowed list may no longer contain the held choice, and a
            // hidden selection is exactly how an operator links the wrong row.
            setProjectId("");
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="event-project-link-select"
        >
          {t("eventProjects.fields.project")}
        </label>
        <TokenSelect
          id="event-project-link-select"
          data-testid="event-project-link-select"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">{t("eventProjects.fields.projectPlaceholder")}</option>
          {options.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </TokenSelect>
        {options.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="event-project-link-no-options"
          >
            {t("eventProjects.fields.noOptions")}
          </p>
        ) : null}
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="event-project-link-submit"
          loading={mutation.isPending}
          disabled={projectId.length === 0}
          onClick={() => {
            const body: CreateEventProjectRequest = { eventId, projectId };
            mutate(
              { url: eventProjectsUrl.collection(), method: "post", values: body },
              {
                onSuccess: () => {
                  setProjectId("");
                  onLinked();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("eventProjects.action.link")}
        </Button>
      </div>
    </section>
  );
}
