"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Switch } from "@ds/design-system";
import { Combobox } from "@ds/design-system/blocks";
import type {
  CreateProjectExpertRequest,
  ProjectExpertAdminDetail,
  ProjectExpertAdminList,
  ProjectExpertRole,
  ReplaceProjectCuratorRequest,
  UpdateProjectExpertRequest,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import { RelationshipEndpointPicker } from "@/components/relationship-endpoint-picker";
import {
  canClaimInvariantSeat,
  relationshipRowActionState,
  retryRelationshipOccupancy,
} from "@/lib/relationship-authoring-state";
import {
  taxonomyErrorKey,
  type TaxonomyErrorContext,
} from "@/lib/taxonomy-errors";
import { useRelationshipOccupancy } from "@/lib/use-relationship-occupancy";
import { projectExpertsUrl } from "@/providers/data-provider";
import { useRelationshipCombobox } from "@/lib/use-relationship-combobox";

/**
 * The project↔expert relationship editor (012 EARS-9, 012-design §5.1/§7; #1291).
 *
 * ONE component serves BOTH directions, like `EventProjectsPanel`: on the project
 * detail and the expert detail it AUTHORS through the same relationship command.
 * A link is the same fact from either end, so there is one panel and one state
 * machine rather than a second reverse implementation.
 *
 * THE CURATOR SEAT IS NOT AN ORDINARY FIELD (§3.2). A published project must have
 * exactly one active curator, enforced by an immediate partial unique index, so
 * this panel offers TWO different controls and they are not interchangeable:
 *
 *  - the per-row role switch is the ordinary edit — it works while the seat is
 *    free (or the project is unpublished) and is refused with
 *    `PUBLISHED_PROJECT_REQUIRES_CURATOR` when it would empty or double the seat;
 *  - «Заменить куратора» is the atomic path — one request that demotes the
 *    incumbent and promotes the candidate inside one transaction, carrying the
 *    PROJECT's `If-Match`, because the invariant belongs to the project.
 *
 * Offering only the row switch would make the operator perform an illegal
 * intermediate state (zero curators, or two) to get from one curator to another;
 * offering only the replace action would make appointing the FIRST curator of an
 * unpublished project needlessly ceremonial. Both exist, and the copy says which
 * is which.
 *
 * NO DELETE (EARS-14). Retire/restore move the SAME row; a retired link stays
 * listed behind its toggle.
 */
export function ProjectExpertsPanel({
  mode,
  entityId,
  projectVersion,
}: {
  /** Which endpoint the operator is standing on — it decides the list filter. */
  mode: "project" | "expert";
  entityId: string;
  /**
   * The project's own version, required in `project` mode: `replace-curator`
   * preconditions on the PROJECT, so the panel cannot synthesise it from a row.
   */
  projectVersion?: number;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const listUrl = projectExpertsUrl.list({
    ...(mode === "project" ? { projectId: entityId } : { expertId: entityId }),
    includeRetired: true,
  });
  const { query } = useCustom<ProjectExpertAdminList>({
    url: listUrl,
    method: "get",
  });
  const curatorOccupancy = useRelationshipOccupancy<ProjectExpertAdminDetail>(
    projectExpertsUrl.list({
      ...(mode === "project" ? { projectId: entityId } : {}),
      role: "curator",
      status: "active",
      pageSize: 1,
    }),
    mode === "project",
  );

  function announce(toastKey: string) {
    setErrorKey(null);
    setNoticeKey(toastKey);
    void query.refetch();
    if (mode === "project") void curatorOccupancy.refetch();
  }

  function fail(
    error: unknown,
    fallbackKey: string,
    context?: TaxonomyErrorContext,
  ) {
    setNoticeKey(null);
    setErrorKey(taxonomyErrorKey(error, fallbackKey, context));
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
      <Alert variant="danger" data-testid="project-experts-error">
        {t("projectExperts.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");
  const curator = curatorOccupancy.incumbent;

  return (
    <div className="flex flex-col gap-6" data-testid="project-experts-panel">
      <p className="text-sm text-muted-foreground">
        {t(`projectExperts.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="project-experts-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="project-experts-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      {mode === "project" ? (
        <LinkForm
          projectId={entityId}
          linkedExpertIds={list.data.map((row) => row.expertId)}
          seatTaken={curator !== null}
          occupancyLoading={curatorOccupancy.isFetching}
          occupancyError={curatorOccupancy.isError}
          onRetryOccupancy={() =>
            retryRelationshipOccupancy(curatorOccupancy.refetch)
          }
          onLinked={() => announce("projectExperts.toast.linked")}
          onError={(error) => fail(error, "projectExperts.errors.linkFailed")}
        />
      ) : (
        <ReverseLinkForm
          expertId={entityId}
          linkedProjectIds={list.data.map((row) => row.projectId)}
          onLinked={() => announce("projectExperts.toast.linked")}
          onError={(error) => fail(error, "projectExperts.errors.linkFailed")}
        />
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`projectExperts.activeTitle.${mode}`)}
        </h3>
        {active.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-experts-empty"
          >
            {t(`projectExperts.empty.${mode}`)}
          </p>
        ) : (
          active.map((row) => (
            <LinkRow
              key={row.id}
              row={row}
              mode={mode}
              incumbentId={mode === "project" ? (curator?.id ?? null) : null}
              occupancyLoading={
                mode === "project" && curatorOccupancy.isFetching
              }
              occupancyError={mode === "project" && curatorOccupancy.isError}
              onDone={announce}
              onError={fail}
            />
          ))
        )}
      </section>

      {mode === "project" ? (
        <ReplaceCuratorForm
          projectId={entityId}
          projectVersion={projectVersion}
          incumbent={curator}
          candidates={active.filter((row) => row.role === "member")}
          onReplaced={() => announce("projectExperts.toast.curatorReplaced")}
          onError={(error) =>
            fail(error, "projectExperts.errors.replaceCuratorFailed")
          }
        />
      ) : null}

      <div className="flex flex-col gap-3 border-t-2 border-border pt-6">
        {/* The DS Switch wraps its own <label>, so the visible text is its child —
            a sibling <label htmlFor> would name the control twice. */}
        <Switch
          id="project-experts-show-retired"
          data-testid="project-experts-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("projectExperts.showRetired")}
        </Switch>
        {showRetired ? (
          <div
            className="flex flex-col gap-3"
            data-testid="project-experts-retired"
          >
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projectExperts.retiredEmpty")}
              </p>
            ) : (
              retired.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  mode={mode}
                  incumbentId={
                    mode === "project" ? (curator?.id ?? null) : null
                  }
                  occupancyLoading={
                    mode === "project" && curatorOccupancy.isFetching
                  }
                  occupancyError={
                    mode === "project" && curatorOccupancy.isError
                  }
                  onDone={announce}
                  onError={fail}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {t("projectExperts.noDeleteNote")}
      </p>
    </div>
  );
}

type DoneHandler = (toastKey: string) => void;
type ErrorHandler = (
  error: unknown,
  fallbackKey: string,
  context?: TaxonomyErrorContext,
) => void;

/** One relationship — the opposite endpoint, its role, and its transitions. */
function LinkRow({
  row,
  mode,
  incumbentId,
  occupancyLoading,
  occupancyError,
  onDone,
  onError,
}: {
  row: ProjectExpertAdminDetail;
  mode: "project" | "expert";
  incumbentId: string | null;
  occupancyLoading: boolean;
  occupancyError: boolean;
  onDone: DoneHandler;
  onError: ErrorHandler;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const rowOccupancy = useRelationshipOccupancy<ProjectExpertAdminDetail>(
    projectExpertsUrl.list({
      projectId: row.projectId,
      role: "curator",
      status: "active",
      pageSize: 1,
    }),
    mode === "expert",
  );
  const effectiveIncumbentId =
    mode === "expert" ? rowOccupancy.incumbent?.id : incumbentId;
  const effectiveLoading =
    mode === "expert" ? rowOccupancy.isFetching : occupancyLoading;
  const effectiveError =
    mode === "expert" ? rowOccupancy.isError : occupancyError;
  // The operator is standing on one endpoint, so the row names the OTHER one.
  // `expertName` is nullable because §2.4's editorial removal nulls it on a
  // retained row; the fixed RU label is rendered here rather than stored as a
  // sentinel string in the API.
  const title =
    mode === "project"
      ? (row.expertName ?? t("projectExperts.removedExpert"))
      : row.projectTitle;
  const slug = mode === "project" ? row.expertSlug : row.projectSlug;
  const transition = row.status === "active" ? "retire" : "restore";
  const nextRole: ProjectExpertRole =
    row.role === "curator" ? "member" : "curator";
  const claimsCuratorSeat =
    (row.status === "active" && nextRole === "curator") ||
    (row.status === "retired" && row.role === "curator");
  const rowActionState = relationshipRowActionState({
    isLoading: effectiveLoading,
    isError: effectiveError,
    incumbentRelationId: effectiveIncumbentId ?? null,
    candidateRelationId: row.id,
  });
  const rowConstraintId = `project-expert-row-occupancy-${row.id}`;

  function send(
    url: string,
    values: unknown,
    toastKey: string,
    fallback: string,
    context?: TaxonomyErrorContext,
  ) {
    mutate(
      {
        url,
        method: "post",
        values: values ?? {},
        meta: { version: row.version },
      },
      {
        onSuccess: () => onDone(toastKey),
        onError: (error) => onError(error, fallback, context),
      },
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`project-expert-row-${row.id}`}
    >
      <span
        className="text-sm font-bold text-foreground"
        data-testid={`project-expert-title-${row.id}`}
      >
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{slug}</span>
      <Badge variant="label" data-testid={`project-expert-role-${row.id}`}>
        {t(`projectExperts.roles.${row.role}`)}
      </Badge>
      <Badge variant="label" data-testid={`project-expert-status-${row.id}`}>
        {t(`projectExperts.statuses.${row.status}`)}
      </Badge>

      {row.status === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid={`project-expert-role-${nextRole}-${row.id}`}
          loading={mutation.isPending}
          aria-describedby={
            claimsCuratorSeat && rowActionState.kind !== "available"
              ? rowConstraintId
              : undefined
          }
          // Promoting a second curator can only ever come back 409; the atomic
          // replace control below is the way through, so the button says so
          // instead of offering a guaranteed refusal.
          disabled={claimsCuratorSeat && rowActionState.actionDisabled}
          onClick={() => {
            const body: UpdateProjectExpertRequest = { role: nextRole };
            mutate(
              {
                url: projectExpertsUrl.row(row.id),
                method: "patch",
                values: body,
                meta: { version: row.version },
              },
              {
                onSuccess: () => {
                  if (mode === "expert") void rowOccupancy.refetch();
                  onDone(`projectExperts.toast.role.${nextRole}`);
                },
                onError: (error) =>
                  onError(error, "projectExperts.errors.roleFailed"),
              },
            );
          }}
        >
          {t(`projectExperts.action.role.${nextRole}`)}
        </Button>
      ) : null}

      {claimsCuratorSeat && rowActionState.kind === "loading" ? (
        <p
          id={rowConstraintId}
          className="text-sm text-muted-foreground"
          data-testid={`project-expert-row-occupancy-loading-${row.id}`}
        >
          {t("projectExperts.fields.rowOccupancyLoading")}
        </p>
      ) : claimsCuratorSeat && rowActionState.kind === "error" ? (
        <Alert
          id={rowConstraintId}
          variant="danger"
          data-testid={`project-expert-row-occupancy-error-${row.id}`}
        >
          <div className="flex flex-col gap-2">
            <span>{t("projectExperts.fields.rowOccupancyError")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`project-expert-row-occupancy-retry-${row.id}`}
              onClick={() => retryRelationshipOccupancy(rowOccupancy.refetch)}
            >
              {t("common.retry")}
            </Button>
          </div>
        </Alert>
      ) : claimsCuratorSeat && rowActionState.kind === "occupied" ? (
        <p
          id={rowConstraintId}
          className="text-sm text-muted-foreground"
          data-testid={`project-expert-row-seat-taken-${row.id}`}
        >
          {t("projectExperts.fields.reverseSeatTakenHint")}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid={`project-expert-${transition}-${row.id}`}
        loading={mutation.isPending}
        aria-describedby={
          transition === "restore" &&
          claimsCuratorSeat &&
          rowActionState.kind !== "available"
            ? rowConstraintId
            : undefined
        }
        disabled={
          transition === "restore" &&
          claimsCuratorSeat &&
          rowActionState.actionDisabled
        }
        onClick={() =>
          send(
            projectExpertsUrl.command(row.id, transition),
            {},
            `projectExperts.toast.${transition}d`,
            "projectExperts.errors.transitionFailed",
            transition === "restore" && row.role === "curator"
              ? { action: "restore-curator" }
              : undefined,
          )
        }
      >
        {t(`projectExperts.action.${transition}`)}
      </Button>
    </div>
  );
}

/** Reverse authoring fixes the expert endpoint and selects an existing project. */
function ReverseLinkForm({
  expertId,
  linkedProjectIds,
  onLinked,
  onError,
}: {
  expertId: string;
  linkedProjectIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<ProjectExpertRole>("member");
  const { mutate, mutation } = useCustomMutation();
  const selectedProjectOccupancy =
    useRelationshipOccupancy<ProjectExpertAdminDetail>(
      projectExpertsUrl.list({
        projectId,
        role: "curator",
        status: "active",
        pageSize: 1,
      }),
      projectId.length > 0,
    );
  const constraintLoading = selectedProjectOccupancy.isFetching;
  const constraintError = selectedProjectOccupancy.isError;
  const seatTaken = !canClaimInvariantSeat(
    selectedProjectOccupancy.incumbent?.id ?? null,
  );

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="project-expert-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("projectExperts.linkProjectTitle")}
      </h3>
      <RelationshipEndpointPicker
        endpoint="project"
        excludedIds={linkedProjectIds}
        value={projectId}
        onChange={(nextProjectId) => {
          setProjectId(nextProjectId);
          setRole("member");
        }}
        testIdPrefix="project-expert-link"
        copy={{
          search: t("projectExperts.fields.projectSearch"),
          searchPlaceholder: t(
            "projectExperts.fields.projectSearchPlaceholder",
          ),
          select: t("projectExperts.fields.project"),
          selectPlaceholder: t("projectExperts.fields.projectPlaceholder"),
          noOptions: t("projectExperts.fields.noProjectOptions"),
        }}
      />
      {constraintLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="project-expert-link-project-loading"
        >
          {t("common.loading")}
        </p>
      ) : constraintError ? (
        <Alert variant="danger" data-testid="project-expert-link-project-error">
          <div className="flex flex-col gap-2">
            <span>{t("projectExperts.errors.loadFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="project-expert-link-project-retry"
              onClick={() =>
                retryRelationshipOccupancy(selectedProjectOccupancy.refetch)
              }
            >
              {t("common.retry")}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-expert-link-role"
        >
          {t("projectExperts.fields.role")}
        </label>
        <TokenSelect
          id="project-expert-link-role"
          data-testid="project-expert-link-role"
          value={role}
          disabled={
            projectId.length === 0 || constraintLoading || constraintError
          }
          onChange={(event) => setRole(event.target.value as ProjectExpertRole)}
        >
          <option value="member">{t("projectExperts.roles.member")}</option>
          {!seatTaken ? (
            <option value="curator">{t("projectExperts.roles.curator")}</option>
          ) : null}
        </TokenSelect>
        {seatTaken ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-expert-link-seat-taken"
          >
            {t("projectExperts.fields.reverseSeatTakenHint")}
          </p>
        ) : null}
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          data-testid="project-expert-link-submit"
          loading={mutation.isPending}
          disabled={
            projectId.length === 0 || constraintLoading || constraintError
          }
          onClick={() => {
            const body: CreateProjectExpertRequest = {
              projectId,
              expertId,
              role,
            };
            mutate(
              {
                url: projectExpertsUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setProjectId("");
                  setRole("member");
                  onLinked();
                },
                onError,
              },
            );
          }}
        >
          {t("projectExperts.action.link")}
        </Button>
      </div>
    </section>
  );
}

/**
 * The add-link control (§7): a searchable expert selector plus the role.
 *
 * The picker is the shared list-shell search plus a native select narrowed
 * SERVER-SIDE by `?q=`, the same selector ruling #1289 landed on. An
 * already-linked expert is filtered out here, because a choice that can only
 * ever come back 409 is not a choice — and `curator` is not offerable while the
 * seat is taken, for the same reason.
 */
function LinkForm({
  projectId,
  linkedExpertIds,
  seatTaken,
  occupancyLoading,
  occupancyError,
  onRetryOccupancy,
  onLinked,
  onError,
}: {
  projectId: string;
  linkedExpertIds: string[];
  seatTaken: boolean;
  occupancyLoading: boolean;
  occupancyError: boolean;
  onRetryOccupancy: () => void;
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [expertId, setExpertId] = useState("");
  const [role, setRole] = useState<ProjectExpertRole>("member");
  const { mutate, mutation } = useCustomMutation();

  const picker = useRelationshipCombobox({
    resource: "experts",
    excludedIds: linkedExpertIds,
    value: expertId,
    removedLabel: t("experts.removedName"),
  });

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="project-expert-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("projectExperts.linkTitle")}
      </h3>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-expert-link-combobox"
        >
          {t("projectExperts.fields.expert")}
        </label>
        <Combobox
          id="project-expert-link-combobox"
          options={picker.options}
          value={expertId || null}
          onValueChange={(next) => {
            picker.select(next);
            setExpertId(next);
          }}
          onSearchChange={picker.search}
          onLoadMore={picker.loadMore}
          hasMore={picker.hasMore}
          loadingMore={picker.loadingMore}
          loadMoreError={picker.loadMoreError}
          loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
          loadingMoreLabel={t("relationshipEndpointPicker.loadingMore")}
          loadMoreErrorLabel={t("relationshipEndpointPicker.retryLoadMore")}
          placeholder={t("projectExperts.fields.expertPlaceholder")}
          searchLabel={t("projectExperts.fields.search")}
          searchPlaceholder={t("projectExperts.fields.searchPlaceholder")}
          emptyLabel={
            picker.isLoading
              ? t("common.loading")
              : picker.isError
                ? t("relationshipEndpointPicker.loadFailed")
                : t("projectExperts.fields.noOptions")
          }
          showSearch
          aria-label={t("projectExperts.fields.expert")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-expert-link-role"
        >
          {t("projectExperts.fields.role")}
        </label>
        <TokenSelect
          id="project-expert-link-role"
          data-testid="project-expert-link-role"
          value={role}
          disabled={occupancyLoading || occupancyError}
          onChange={(event) => setRole(event.target.value as ProjectExpertRole)}
        >
          <option value="member">{t("projectExperts.roles.member")}</option>
          <option value="curator" disabled={seatTaken}>
            {t("projectExperts.roles.curator")}
          </option>
        </TokenSelect>
        {seatTaken ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-expert-link-seat-taken"
          >
            {t("projectExperts.fields.seatTakenHint")}
          </p>
        ) : null}
        {occupancyLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : null}
        {occupancyError ? (
          <Alert variant="danger" data-testid="project-expert-link-seat-error">
            <div className="flex flex-col gap-2">
              <span>{t("projectExperts.errors.loadFailed")}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="project-expert-link-seat-retry"
                onClick={onRetryOccupancy}
              >
                {t("common.retry")}
              </Button>
            </div>
          </Alert>
        ) : null}
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="project-expert-link-submit"
          loading={mutation.isPending}
          disabled={expertId.length === 0 || occupancyLoading || occupancyError}
          onClick={() => {
            const body: CreateProjectExpertRequest = {
              projectId,
              expertId,
              role,
            };
            mutate(
              {
                url: projectExpertsUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setExpertId("");
                  setRole("member");
                  onLinked();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("projectExperts.action.link")}
        </Button>
      </div>
    </section>
  );
}

/**
 * «Заменить куратора» (§3.2 / §5.1) — the atomic seat move.
 *
 * Only rows that are ALREADY linked and active are offerable: the request moves
 * the seat, it does not also enrol a stranger, and an operator who wants an
 * outsider as curator links them as `member` first (one visible act each, both
 * auditable) instead of one control that quietly does two things.
 *
 * The control is hidden entirely when there is no incumbent — with a free seat
 * the ordinary per-row promotion is the honest act, and a «замена» that replaces
 * nothing would read as if something were being displaced.
 */
function ReplaceCuratorForm({
  projectId,
  projectVersion,
  incumbent,
  candidates,
  onReplaced,
  onError,
}: {
  projectId: string;
  projectVersion?: number;
  incumbent: ProjectExpertAdminDetail | null;
  candidates: ProjectExpertAdminDetail[];
  onReplaced: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [expertId, setExpertId] = useState("");
  const { mutate, mutation } = useCustomMutation();

  if (!incumbent) return null;

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="project-curator-replace-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("projectExperts.replaceTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("projectExperts.replaceDescription", {
          name: incumbent.expertName ?? t("projectExperts.removedExpert"),
        })}
      </p>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-curator-replace-select"
        >
          {t("projectExperts.fields.newCurator")}
        </label>
        <TokenSelect
          id="project-curator-replace-select"
          data-testid="project-curator-replace-select"
          value={expertId}
          onChange={(event) => setExpertId(event.target.value)}
        >
          <option value="">
            {t("projectExperts.fields.newCuratorPlaceholder")}
          </option>
          {candidates.map((row) => (
            <option key={row.id} value={row.expertId}>
              {row.expertName ?? t("projectExperts.removedExpert")}
            </option>
          ))}
        </TokenSelect>
        {candidates.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-curator-replace-no-options"
          >
            {t("projectExperts.fields.noCandidates")}
          </p>
        ) : null}
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="project-curator-replace-submit"
          loading={mutation.isPending}
          disabled={expertId.length === 0 || projectVersion === undefined}
          onClick={() => {
            const body: ReplaceProjectCuratorRequest = { expertId };
            mutate(
              {
                url: projectExpertsUrl.replaceCurator(projectId),
                method: "post",
                values: body,
                // The PROJECT's version, not a relation's: the precondition
                // guards the invariant, and the invariant belongs to the project.
                meta: { version: projectVersion },
              },
              {
                onSuccess: () => {
                  setExpertId("");
                  onReplaced();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("projectExperts.action.replaceCurator")}
        </Button>
      </div>
    </section>
  );
}
