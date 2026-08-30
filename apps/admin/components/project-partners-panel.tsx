"use client";

import { useState } from "react";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Input, Switch } from "@ds/design-system";
import type {
  CreateProjectPartnerRequest,
  PartnerAdminList,
  ProjectPartnerAdminDetail,
  ProjectPartnerAdminList,
  UpdateProjectPartnerRequest,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import { RelationshipEndpointPicker } from "@/components/relationship-endpoint-picker";
import {
  canClaimInvariantSeat,
  relationshipRowActionState,
  retryRelationshipOccupancy,
} from "@/lib/relationship-authoring-state";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { useRelationshipOccupancy } from "@/lib/use-relationship-occupancy";
import type { TaxonomyHttpError } from "@/providers/data-provider";
import { projectPartnersUrl } from "@/providers/data-provider";

/**
 * The project↔partner relationship editor (012 EARS-10, 012-design §5.1/§7; #1292).
 *
 * ONE component serves BOTH directions, like the sibling panels: on the project
 * detail and the partner detail it AUTHORS through the same relationship command.
 * The endpoint page only decides which side is fixed and which side is selected.
 *
 * `isPrimary` IS AN ATTRIBUTE, NOT A COMMAND. At most one ACTIVE row per project
 * may carry it (partial unique index), and the panel deliberately does NOT offer
 * a «сделать основным» that silently demotes the incumbent: the operator clears
 * the current primary and sets the successor as two visible acts, each its own
 * audited edit. Attempting the second one first is refused with 409 and the panel
 * says which partner is in the way rather than showing a generic failure.
 *
 * That is the same reasoning as the curator seat on the expert panel with one
 * difference the spec draws: a published project MUST have a curator, so an
 * atomic replace exists there; a project need not have a primary partner at all,
 * so clearing first leaves a legal state and no atomic path is needed.
 *
 * NO DELETE (EARS-14). Retire/restore move the SAME row. A retired row KEEPS its
 * `isPrimary` flag (the partial unique excludes retired rows), so restoring one
 * while another partner is primary is refused — the panel's copy warns about it
 * instead of leaving the operator to discover it at the 409.
 */
export function ProjectPartnersPanel({
  mode,
  entityId,
}: {
  /** Which endpoint the operator is standing on — it decides the list filter. */
  mode: "project" | "partner";
  entityId: string;
}) {
  const t = useTranslations();
  const [showRetired, setShowRetired] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const listUrl = projectPartnersUrl.list({
    ...(mode === "project" ? { projectId: entityId } : { partnerId: entityId }),
    includeRetired: true,
  });
  const { query } = useCustom<ProjectPartnerAdminList>({
    url: listUrl,
    method: "get",
  });
  const primaryOccupancy = useRelationshipOccupancy<ProjectPartnerAdminDetail>(
    projectPartnersUrl.list({
      ...(mode === "project" ? { projectId: entityId } : {}),
      isPrimary: true,
      status: "active",
      pageSize: 1,
    }),
    mode === "project",
  );

  function announce(toastKey: string) {
    setErrorKey(null);
    setNoticeKey(toastKey);
    void query.refetch();
    if (mode === "project") void primaryOccupancy.refetch();
  }

  function fail(error: unknown, fallbackKey: string) {
    setNoticeKey(null);
    setErrorKey(taxonomyErrorKey(error, fallbackKey));
  }

  // The primary-flag mutations resolve their own key (see `primaryErrorKey`), so
  // they need a path that does NOT re-enter the shared table — running a resolved
  // key back through `taxonomyErrorKey` would re-map the ambiguous code and undo
  // exactly the disambiguation that was just made.
  function failWithKey(key: string) {
    setNoticeKey(null);
    setErrorKey(key);
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
      <Alert variant="danger" data-testid="project-partners-error">
        {t("projectPartners.errors.loadFailed")}
      </Alert>
    );
  }

  const active = list.data.filter((row) => row.status === "active");
  const retired = list.data.filter((row) => row.status === "retired");
  const primary = primaryOccupancy.incumbent;
  const primaryTaken = primary !== null;

  return (
    <div className="flex flex-col gap-6" data-testid="project-partners-panel">
      <p className="text-sm text-muted-foreground">
        {t(`projectPartners.description.${mode}`)}
      </p>

      {errorKey ? (
        <Alert variant="danger" data-testid="project-partners-command-error">
          {t(errorKey)}
        </Alert>
      ) : noticeKey ? (
        <Alert variant="success" data-testid="project-partners-notice">
          {t(noticeKey)}
        </Alert>
      ) : null}

      {mode === "project" ? (
        <LinkForm
          projectId={entityId}
          linkedPartnerIds={list.data.map((row) => row.partnerId)}
          primaryTaken={primaryTaken}
          occupancyLoading={primaryOccupancy.isFetching}
          occupancyError={primaryOccupancy.isError}
          onRetryOccupancy={() =>
            retryRelationshipOccupancy(primaryOccupancy.refetch)
          }
          onLinked={() => announce("projectPartners.toast.linked")}
          onError={(error) => fail(error, "projectPartners.errors.linkFailed")}
        />
      ) : (
        <ReverseLinkForm
          partnerId={entityId}
          linkedProjectIds={list.data.map((row) => row.projectId)}
          onLinked={() => announce("projectPartners.toast.linked")}
          onError={(error) => fail(error, "projectPartners.errors.linkFailed")}
        />
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-foreground">
          {t(`projectPartners.activeTitle.${mode}`)}
        </h3>
        {active.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-partners-empty"
          >
            {t(`projectPartners.empty.${mode}`)}
          </p>
        ) : (
          active.map((row) => (
            <LinkRow
              key={row.id}
              row={row}
              mode={mode}
              incumbentId={mode === "project" ? (primary?.id ?? null) : null}
              occupancyLoading={
                mode === "project" && primaryOccupancy.isFetching
              }
              occupancyError={mode === "project" && primaryOccupancy.isError}
              onDone={announce}
              onError={fail}
              onErrorKey={failWithKey}
            />
          ))
        )}
      </section>

      <div className="flex flex-col gap-3 border-t-2 border-border pt-6">
        {/* The DS Switch wraps its own <label>, so the visible text is its child —
            a sibling <label htmlFor> would name the control twice. */}
        <Switch
          id="project-partners-show-retired"
          data-testid="project-partners-show-retired"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
        >
          {t("projectPartners.showRetired")}
        </Switch>
        {showRetired ? (
          <div
            className="flex flex-col gap-3"
            data-testid="project-partners-retired"
          >
            {retired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projectPartners.retiredEmpty")}
              </p>
            ) : (
              retired.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  mode={mode}
                  incumbentId={
                    mode === "project" ? (primary?.id ?? null) : null
                  }
                  occupancyLoading={
                    mode === "project" && primaryOccupancy.isFetching
                  }
                  occupancyError={
                    mode === "project" && primaryOccupancy.isError
                  }
                  onDone={announce}
                  onError={fail}
                  onErrorKey={failWithKey}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {t("projectPartners.noDeleteNote")}
      </p>
    </div>
  );
}

type DoneHandler = (toastKey: string) => void;
type ErrorHandler = (error: unknown, fallbackKey: string) => void;

/**
 * `RELATIONSHIP_CONFLICT` means «пара уже есть» on a link and «основной уже
 * назначен» on a primary-flag edit — the same code, two different fixes. Which
 * one it is depends on the ACTION, so the primary mutations resolve it here
 * rather than in the shared table, which cannot see what was sent.
 */
function primaryErrorKey(error: unknown): string {
  return (error as TaxonomyHttpError | undefined)?.errorCode ===
    "RELATIONSHIP_CONFLICT"
    ? "projectPartners.errors.primaryTaken"
    : taxonomyErrorKey(error, "projectPartners.errors.primaryFailed");
}

/** One relationship — the opposite endpoint, its primary flag, its transitions. */
function LinkRow({
  row,
  mode,
  incumbentId,
  occupancyLoading,
  occupancyError,
  onDone,
  onError,
  onErrorKey,
}: {
  row: ProjectPartnerAdminDetail;
  mode: "project" | "partner";
  incumbentId: string | null;
  occupancyLoading: boolean;
  occupancyError: boolean;
  onDone: DoneHandler;
  onError: ErrorHandler;
  /** Takes an ALREADY-resolved catalogue key (the primary-flag disambiguation). */
  onErrorKey: (key: string) => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const rowOccupancy = useRelationshipOccupancy<ProjectPartnerAdminDetail>(
    projectPartnersUrl.list({
      projectId: row.projectId,
      isPrimary: true,
      status: "active",
      pageSize: 1,
    }),
    mode === "partner",
  );
  const effectiveIncumbentId =
    mode === "partner" ? rowOccupancy.incumbent?.id : incumbentId;
  const effectiveLoading =
    mode === "partner" ? rowOccupancy.isFetching : occupancyLoading;
  const effectiveError =
    mode === "partner" ? rowOccupancy.isError : occupancyError;
  const rowActionState = relationshipRowActionState({
    isLoading: effectiveLoading,
    isError: effectiveError,
    incumbentRelationId: effectiveIncumbentId ?? null,
    candidateRelationId: row.id,
  });
  const rowConstraintId = `project-partner-row-occupancy-${row.id}`;
  // The operator is standing on one endpoint, so the row names the OTHER one.
  const title = mode === "project" ? row.partnerTitle : row.projectTitle;
  const slug = mode === "project" ? row.partnerSlug : row.projectSlug;
  const transition = row.status === "active" ? "retire" : "restore";
  const claimsPrimaryFlag =
    (row.status === "active" && !row.isPrimary) ||
    (row.status === "retired" && row.isPrimary);

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-2 border-border p-3"
      data-testid={`project-partner-row-${row.id}`}
    >
      <span
        className="text-sm font-bold text-foreground"
        data-testid={`project-partner-title-${row.id}`}
      >
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{slug}</span>
      {row.isPrimary ? (
        <Badge
          variant="label"
          data-testid={`project-partner-primary-${row.id}`}
        >
          {t("projectPartners.primaryBadge")}
        </Badge>
      ) : null}
      <Badge variant="label" data-testid={`project-partner-status-${row.id}`}>
        {t(`projectPartners.statuses.${row.status}`)}
      </Badge>

      {row.status === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid={`project-partner-primary-toggle-${row.id}`}
          loading={mutation.isPending}
          aria-describedby={
            claimsPrimaryFlag && rowActionState.kind !== "available"
              ? rowConstraintId
              : undefined
          }
          // Claiming an occupied flag can only come back 409, so the control is
          // disabled and the panel's copy names the incumbent instead.
          disabled={claimsPrimaryFlag && rowActionState.actionDisabled}
          onClick={() => {
            const body: UpdateProjectPartnerRequest = {
              isPrimary: !row.isPrimary,
            };
            mutate(
              {
                url: projectPartnersUrl.row(row.id),
                method: "patch",
                values: body,
                meta: { version: row.version },
              },
              {
                onSuccess: () => {
                  if (mode === "partner") void rowOccupancy.refetch();
                  onDone(
                    row.isPrimary
                      ? "projectPartners.toast.primaryCleared"
                      : "projectPartners.toast.primarySet",
                  );
                },
                onError: (error) => onErrorKey(primaryErrorKey(error)),
              },
            );
          }}
        >
          {t(
            row.isPrimary
              ? "projectPartners.action.clearPrimary"
              : "projectPartners.action.setPrimary",
          )}
        </Button>
      ) : null}

      {claimsPrimaryFlag && rowActionState.kind === "loading" ? (
        <p
          id={rowConstraintId}
          className="text-sm text-muted-foreground"
          data-testid={`project-partner-row-occupancy-loading-${row.id}`}
        >
          {t("projectPartners.fields.rowOccupancyLoading")}
        </p>
      ) : claimsPrimaryFlag && rowActionState.kind === "error" ? (
        <Alert
          id={rowConstraintId}
          variant="danger"
          data-testid={`project-partner-row-occupancy-error-${row.id}`}
        >
          <div className="flex flex-col gap-2">
            <span>{t("projectPartners.fields.rowOccupancyError")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`project-partner-row-occupancy-retry-${row.id}`}
              onClick={() => retryRelationshipOccupancy(rowOccupancy.refetch)}
            >
              {t("common.retry")}
            </Button>
          </div>
        </Alert>
      ) : claimsPrimaryFlag && rowActionState.kind === "occupied" ? (
        <p
          id={rowConstraintId}
          className="text-sm text-muted-foreground"
          data-testid={`project-partner-row-primary-taken-${row.id}`}
        >
          {t("projectPartners.fields.primaryTakenHint")}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid={`project-partner-${transition}-${row.id}`}
        loading={mutation.isPending}
        aria-describedby={
          transition === "restore" &&
          claimsPrimaryFlag &&
          rowActionState.kind !== "available"
            ? rowConstraintId
            : undefined
        }
        disabled={
          transition === "restore" &&
          claimsPrimaryFlag &&
          rowActionState.actionDisabled
        }
        onClick={() =>
          mutate(
            {
              url: projectPartnersUrl.command(row.id, transition),
              method: "post",
              values: {},
              meta: { version: row.version },
            },
            {
              onSuccess: () => onDone(`projectPartners.toast.${transition}d`),
              onError: (error) =>
                onError(
                  error,
                  transition === "restore" && row.isPrimary
                    ? "projectPartners.errors.primaryTaken"
                    : "projectPartners.errors.transitionFailed",
                ),
            },
          )
        }
      >
        {t(`projectPartners.action.${transition}`)}
      </Button>
    </div>
  );
}

/** Reverse authoring fixes the partner endpoint and selects an existing project. */
function ReverseLinkForm({
  partnerId,
  linkedProjectIds,
  onLinked,
  onError,
}: {
  partnerId: string;
  linkedProjectIds: string[];
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [projectId, setProjectId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  const selectedProjectOccupancy =
    useRelationshipOccupancy<ProjectPartnerAdminDetail>(
      projectPartnersUrl.list({
        projectId,
        isPrimary: true,
        status: "active",
        pageSize: 1,
      }),
      projectId.length > 0,
    );
  const constraintLoading = selectedProjectOccupancy.isFetching;
  const constraintError = selectedProjectOccupancy.isError;
  const primaryTaken = !canClaimInvariantSeat(
    selectedProjectOccupancy.incumbent?.id ?? null,
  );

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="project-partner-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("projectPartners.linkProjectTitle")}
      </h3>
      <RelationshipEndpointPicker
        endpoint="project"
        excludedIds={linkedProjectIds}
        value={projectId}
        onChange={(nextProjectId) => {
          setProjectId(nextProjectId);
          setIsPrimary(false);
        }}
        testIdPrefix="project-partner-link"
        copy={{
          search: t("projectPartners.fields.projectSearch"),
          searchPlaceholder: t(
            "projectPartners.fields.projectSearchPlaceholder",
          ),
          select: t("projectPartners.fields.project"),
          selectPlaceholder: t("projectPartners.fields.projectPlaceholder"),
          noOptions: t("projectPartners.fields.noProjectOptions"),
        }}
      />
      {constraintLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="project-partner-link-project-loading"
        >
          {t("common.loading")}
        </p>
      ) : constraintError ? (
        <Alert
          variant="danger"
          data-testid="project-partner-link-project-error"
        >
          <div className="flex flex-col gap-2">
            <span>{t("projectPartners.errors.loadFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="project-partner-link-project-retry"
              onClick={() =>
                retryRelationshipOccupancy(selectedProjectOccupancy.refetch)
              }
            >
              {t("common.retry")}
            </Button>
          </div>
        </Alert>
      ) : projectId.length > 0 && primaryTaken ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="project-partner-link-primary-taken"
        >
          {t("projectPartners.fields.primaryTakenHint")}
        </p>
      ) : projectId.length > 0 ? (
        <Switch
          id="project-partner-link-primary"
          data-testid="project-partner-link-primary"
          checked={isPrimary}
          onChange={(event) => setIsPrimary(event.target.checked)}
        >
          {t("projectPartners.fields.isPrimary")}
        </Switch>
      ) : null}
      <div>
        <Button
          type="button"
          size="sm"
          data-testid="project-partner-link-submit"
          loading={mutation.isPending}
          disabled={
            projectId.length === 0 || constraintLoading || constraintError
          }
          onClick={() => {
            const body: CreateProjectPartnerRequest = {
              projectId,
              partnerId,
              isPrimary,
            };
            mutate(
              {
                url: projectPartnersUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setProjectId("");
                  setIsPrimary(false);
                  onLinked();
                },
                onError,
              },
            );
          }}
        >
          {t("projectPartners.action.link")}
        </Button>
      </div>
    </section>
  );
}

/**
 * The add-link control (§7): a searchable partner selector plus the primary flag.
 *
 * `isPrimary` is offered on the CREATE because listing the sponsor of a new
 * project is one act in the operator's head; it is withheld while the flag is
 * already taken, because a create that asks for an occupied flag is refused
 * whole — the link would not be made either.
 */
function LinkForm({
  projectId,
  linkedPartnerIds,
  primaryTaken,
  occupancyLoading,
  occupancyError,
  onRetryOccupancy,
  onLinked,
  onError,
}: {
  projectId: string;
  linkedPartnerIds: string[];
  primaryTaken: boolean;
  occupancyLoading: boolean;
  occupancyError: boolean;
  onRetryOccupancy: () => void;
  onLinked: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const { mutate, mutation } = useCustomMutation();

  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (search.trim().length > 0) query.set("q", search.trim());
  const { query: partnersQuery } = useCustom<PartnerAdminList>({
    url: `/v1/admin/partners?${query.toString()}`,
    method: "get",
  });

  const options = (partnersQuery.data?.data.data ?? []).filter(
    (partner) => !linkedPartnerIds.includes(partner.id),
  );

  return (
    <section
      className="flex flex-col gap-3 border-2 border-border p-4"
      data-testid="project-partner-link-form"
    >
      <h3 className="text-base font-extrabold text-foreground">
        {t("projectPartners.linkTitle")}
      </h3>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-partner-link-search"
        >
          {t("projectPartners.fields.search")}
        </label>
        <Input
          id="project-partner-link-search"
          data-testid="project-partner-link-search"
          value={search}
          placeholder={t("projectPartners.fields.searchPlaceholder")}
          onChange={(event) => {
            setSearch(event.target.value);
            // The narrowed list may no longer contain the held choice, and a
            // hidden selection is exactly how an operator links the wrong row.
            setPartnerId("");
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor="project-partner-link-select"
        >
          {t("projectPartners.fields.partner")}
        </label>
        <TokenSelect
          id="project-partner-link-select"
          data-testid="project-partner-link-select"
          value={partnerId}
          onChange={(event) => setPartnerId(event.target.value)}
        >
          <option value="">
            {t("projectPartners.fields.partnerPlaceholder")}
          </option>
          {options.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.title}
            </option>
          ))}
        </TokenSelect>
        {options.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-partner-link-no-options"
          >
            {t("projectPartners.fields.noOptions")}
          </p>
        ) : null}
      </div>

      {primaryTaken ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="project-partner-link-primary-taken"
        >
          {t("projectPartners.fields.primaryTakenHint")}
        </p>
      ) : !occupancyLoading && !occupancyError ? (
        <Switch
          id="project-partner-link-primary"
          data-testid="project-partner-link-primary"
          checked={isPrimary}
          onChange={(event) => setIsPrimary(event.target.checked)}
        >
          {t("projectPartners.fields.isPrimary")}
        </Switch>
      ) : null}
      {occupancyLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : null}
      {occupancyError ? (
        <Alert
          variant="danger"
          data-testid="project-partner-link-primary-error"
        >
          <div className="flex flex-col gap-2">
            <span>{t("projectPartners.errors.loadFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="project-partner-link-primary-retry"
              onClick={onRetryOccupancy}
            >
              {t("common.retry")}
            </Button>
          </div>
        </Alert>
      ) : null}

      <div>
        <Button
          type="button"
          size="sm"
          data-testid="project-partner-link-submit"
          loading={mutation.isPending}
          disabled={
            partnerId.length === 0 || occupancyLoading || occupancyError
          }
          onClick={() => {
            const body: CreateProjectPartnerRequest = {
              projectId,
              partnerId,
              isPrimary: primaryTaken ? false : isPrimary,
            };
            mutate(
              {
                url: projectPartnersUrl.collection(),
                method: "post",
                values: body,
              },
              {
                onSuccess: () => {
                  setPartnerId("");
                  setIsPrimary(false);
                  onLinked();
                },
                onError: (error) => onError(error),
              },
            );
          }}
        >
          {t("projectPartners.action.link")}
        </Button>
      </div>
    </section>
  );
}
