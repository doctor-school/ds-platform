"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Authenticated } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
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
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@ds/design-system";
import { DataTable, FilterBar, FormSection } from "@ds/design-system/blocks";
import {
  ImportSpeakerMigrationReviewsRequestSchema,
  SPEAKER_MIGRATION_CLASSIFICATIONS,
  SPEAKER_MIGRATION_DISPOSITIONS,
  type SpeakerMigrationReviewItem,
  type SpeakerMigrationState,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  SpeakerMigrationErrorNote,
  SpeakerMigrationSuccessNote,
  readHttpError,
  type MigrationErrorState,
} from "@/components/speaker-migration-error-note";
import { SpeakerMigrationReviewDialog } from "@/components/speaker-migration-review-dialog";
import {
  closeSpeakerMigrationSource,
  fetchSpeakerMigrationReviews,
  fetchSpeakerMigrationState,
  importSpeakerMigrationReviews,
  recordSpeakerMigrationRelease,
} from "@/providers/data-provider";

const PAGE_SIZE = 25;
/** The API's own SHA shape — refused locally so a typo never costs a round trip. */
const RELEASE_SHA = /^[0-9a-f]{40}$/;
// blocks-adopted: DataTable + FilterBar + Pagination + EmptyState (official shadcn, MIT); Combobox (Kibo UI, MIT); FormSection + Dialog/AlertDialog/Tabs/Checkbox/Textarea (approved @ds/design-system blocks/primitives from #1605). No new visual class.

type SpeakerMigrationClassification =
  (typeof SPEAKER_MIGRATION_CLASSIFICATIONS)[number];
type SpeakerMigrationDisposition =
  (typeof SPEAKER_MIGRATION_DISPOSITIONS)[number];

/**
 * 012 EARS-24 — the provenance-safe speaker-migration console.
 *
 * Not a CRUD list: a THREE-STAGE, one-shot cutover the operator walks in order —
 * import the owner-reviewed classification artifact, resolve every retained
 * source row by hand, record the phase-aware release, close the source. The page
 * therefore renders each stage only while it is actually available, and the state
 * panel (`speaker-migration-state`) is the single readout that says which stage
 * the database is in — the phase alone cannot, because a database that never ran
 * the migration also reads `review_open`.
 *
 * Two properties are structural rather than stylistic. Provenance is READ-ONLY:
 * every source field is rendered as text, never as an input, so nothing on this
 * page can rewrite what the legacy row said. And no name is ever matched,
 * suggested, ranked or prefilled anywhere — the reviewed artifact is the only
 * classification input, and the operator's own choice is the only resolution.
 */
export default function SpeakerMigrationPage() {
  const t = useTranslations("speakerMigration");

  const [migration, setMigration] = useState<SpeakerMigrationState | null>(null);
  const [rows, setRows] = useState<SpeakerMigrationReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [unresolvedTotal, setUnresolvedTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [classification, setClassification] =
    useState<SpeakerMigrationClassification | "">("");
  const [disposition, setDisposition] =
    useState<SpeakerMigrationDisposition | "">("");
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<SpeakerMigrationReviewItem | null>(
    null,
  );

  const [artifact, setArtifact] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<MigrationErrorState | null>(
    null,
  );
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const [releaseSha, setReleaseSha] = useState("");
  const [releaseOrdinal, setReleaseOrdinal] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<MigrationErrorState | null>(
    null,
  );
  const [releaseSuccess, setReleaseSuccess] = useState<string | null>(null);

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<MigrationErrorState | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);

  // Resolved rows are OUT of the default view: the queue is a worklist, and the
  // audit record of what was already decided is one checkbox away, read-only.
  const effectiveDisposition: SpeakerMigrationDisposition | "" = showResolved
    ? disposition
    : "unresolved";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [nextState, list, unresolved, all] = await Promise.all([
        fetchSpeakerMigrationState(),
        fetchSpeakerMigrationReviews({
          page,
          pageSize: PAGE_SIZE,
          ...(classification ? { classification } : {}),
          ...(effectiveDisposition
            ? { disposition: effectiveDisposition }
            : {}),
        }),
        // The state SSOT carries the cutover, not the counts, so «сколько
        // осталось» is a bounded count query rather than a derived guess from
        // the page in hand — which would be wrong on every page but the last.
        fetchSpeakerMigrationReviews({
          page: 1,
          pageSize: 1,
          disposition: "unresolved",
        }),
        fetchSpeakerMigrationReviews({ page: 1, pageSize: 1 }),
      ]);
      setMigration(nextState);
      setRows(list.data);
      setTotal(list.total);
      setUnresolvedTotal(unresolved.total);
      setTotalAll(all.total);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [classification, effectiveDisposition, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const classificationLabels: Record<SpeakerMigrationClassification, string> = {
    unmatched: t("classifications.unmatched"),
    ambiguous: t("classifications.ambiguous"),
    duplicate: t("classifications.duplicate"),
  };
  const dispositionLabels: Record<SpeakerMigrationDisposition, string> = {
    unresolved: t("dispositions.unresolved"),
    existing_expert: t("dispositions.existing_expert"),
    created_expert: t("dispositions.created_expert"),
    content_removed: t("dispositions.content_removed"),
  };

  const phase = migration?.phase ?? "review_open";
  const isClosed = phase === "source_closed";
  const isImported = Boolean(migration?.sourceImportCompletedAt);
  const canImport = Boolean(migration) && !isClosed && !isImported;
  const canOperate = Boolean(migration) && !isClosed;

  const isFiltered = Boolean(classification || disposition || showResolved);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setClassification("");
    setDisposition("");
    setShowResolved(false);
    setPage(1);
  }

  const applied = useMemo(
    () => [
      ...(classification
        ? [
            {
              id: "classification",
              label: classificationLabels[classification],
              onRemove: () => {
                setClassification("");
                setPage(1);
              },
            },
          ]
        : []),
      ...(showResolved && disposition
        ? [
            {
              id: "disposition",
              label: dispositionLabels[disposition],
              onRemove: () => {
                setDisposition("");
                setPage(1);
              },
            },
          ]
        : []),
      ...(showResolved
        ? [
            {
              id: "show-resolved",
              label: t("filters.showResolved"),
              onRemove: () => {
                setShowResolved(false);
                setDisposition("");
                setPage(1);
              },
            },
          ]
        : []),
    ],
    [
      classification,
      classificationLabels,
      disposition,
      dispositionLabels,
      showResolved,
      t,
    ],
  );

  /**
   * The API reports artifact defects per row (`missing`/`repeated`/`extra
   * source <uuid>`); the UUID is the only thing the operator can act on, so it
   * is carried through verbatim rather than summarised into a count.
   */
  function formatIssue(issue: { path: string; message: string }): string {
    const match = /^(missing|repeated|extra) source (.+)$/.exec(issue.message);
    if (!match) return issue.message;
    const id = match[2]!;
    if (match[1] === "missing") return t("import.issues.missing", { id });
    if (match[1] === "repeated") return t("import.issues.repeated", { id });
    return t("import.issues.extra", { id });
  }

  async function runImport() {
    setImportSuccess(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact);
    } catch {
      setImportError({ code: "VALIDATION_FAILED", text: t("import.notJson") });
      return;
    }
    const check = ImportSpeakerMigrationReviewsRequestSchema.safeParse(parsed);
    if (!check.success) {
      setImportError({ code: "VALIDATION_FAILED", text: t("import.notJson") });
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const result = await importSpeakerMigrationReviews(check.data);
      setImportSuccess(t("import.success", result));
      setArtifact("");
      await load();
    } catch (caught) {
      const { errorCode, fieldErrors } = readHttpError(caught);
      const text =
        errorCode === "VALIDATION_FAILED"
          ? t("import.errors.VALIDATION_FAILED")
          : errorCode === "SPEAKER_MIGRATION_SOURCE_IMMUTABLE"
            ? t("import.errors.SPEAKER_MIGRATION_SOURCE_IMMUTABLE")
            : t("import.errors.default");
      setImportError({
        code: errorCode ?? null,
        text,
        issues: (fieldErrors ?? []).map(formatIssue),
      });
    } finally {
      setImporting(false);
    }
  }

  async function runRelease() {
    setReleaseSuccess(null);
    const ordinal = Number(releaseOrdinal);
    if (
      !RELEASE_SHA.test(releaseSha.trim()) ||
      !Number.isInteger(ordinal) ||
      ordinal < 1
    ) {
      setReleaseError({ code: "VALIDATION_FAILED", text: t("release.badSha") });
      return;
    }
    setReleasing(true);
    setReleaseError(null);
    try {
      await recordSpeakerMigrationRelease({
        releaseSha: releaseSha.trim(),
        releaseOrdinal: ordinal,
      });
      setReleaseSuccess(t("release.success"));
      await load();
    } catch (caught) {
      const { errorCode } = readHttpError(caught);
      const text =
        errorCode === "VALIDATION_FAILED"
          ? t("release.errors.VALIDATION_FAILED")
          : errorCode === "SPEAKER_MIGRATION_SOURCE_IMMUTABLE"
            ? t("release.errors.SPEAKER_MIGRATION_SOURCE_IMMUTABLE")
            : t("release.errors.default");
      setReleaseError({ code: errorCode ?? null, text });
    } finally {
      setReleasing(false);
    }
  }

  async function runClose() {
    setCloseSuccess(null);
    setClosing(true);
    setCloseError(null);
    try {
      const result = await closeSpeakerMigrationSource();
      setCloseSuccess(
        t("close.success", {
          resolved: result.resolvedSources,
          removed: result.contentRemoved,
          sha: result.minimumCompatibleReleaseSha,
          ordinal: result.minimumCompatibleReleaseOrdinal,
        }),
      );
      await load();
    } catch (caught) {
      const { errorCode } = readHttpError(caught);
      const text =
        errorCode === "PRECONDITION_REQUIRED"
          ? t("close.errors.PRECONDITION_REQUIRED")
          : errorCode === "RELATIONSHIP_CONFLICT"
            ? t("close.errors.RELATIONSHIP_CONFLICT")
            : errorCode === "SPEAKER_MIGRATION_SOURCE_IMMUTABLE"
              ? t("close.errors.SPEAKER_MIGRATION_SOURCE_IMMUTABLE")
              : t("close.errors.default");
      setCloseError({ code: errorCode ?? null, text });
    } finally {
      setClosing(false);
    }
  }

  return (
    <Authenticated key="speaker-migration" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-extrabold text-foreground">
              {t("title")}
            </h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>

          <section
            aria-label={t("state.label")}
            data-testid="speaker-migration-state"
            className="border-2 border-border bg-card p-4"
          >
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StateFact label={t("state.phase")} testId="state-phase">
                {isClosed
                  ? t("state.phases.source_closed")
                  : t("state.phases.review_open")}
              </StateFact>
              <StateFact label={t("state.import")} testId="state-import">
                {migration?.sourceImportCompletedAt
                  ? t("state.importDone", {
                      date: new Date(
                        migration.sourceImportCompletedAt,
                      ).toLocaleString("ru-RU"),
                    })
                  : t("state.importPending")}
              </StateFact>
              <StateFact label={t("state.total")} testId="state-total">
                {t("state.totalValue", { total: totalAll })}
              </StateFact>
              <StateFact label={t("state.unresolved")} testId="state-unresolved">
                {t("state.unresolvedValue", { count: unresolvedTotal })}
              </StateFact>
              <StateFact label={t("state.release")} testId="state-release">
                {migration?.phaseAwareReleaseSha &&
                migration.phaseAwareReleaseOrdinal !== null
                  ? t("state.releaseValue", {
                      sha: migration.phaseAwareReleaseSha,
                      ordinal: migration.phaseAwareReleaseOrdinal,
                    })
                  : t("state.releasePending")}
              </StateFact>
              <StateFact label={t("state.floor")} testId="state-floor">
                {migration?.minimumCompatibleReleaseSha &&
                migration.minimumCompatibleReleaseOrdinal !== null
                  ? t("state.floorValue", {
                      sha: migration.minimumCompatibleReleaseSha,
                      ordinal: migration.minimumCompatibleReleaseOrdinal,
                    })
                  : t("state.floorPending")}
              </StateFact>
            </dl>
          </section>

          {isClosed ? (
            <p
              data-testid="speaker-migration-closed-note"
              className="max-w-prose text-sm text-muted-foreground"
            >
              {t("closedNote")}
            </p>
          ) : null}

          {canImport ? (
            <section
              data-testid="speaker-migration-import"
              className="flex flex-col gap-3"
            >
              <FormSection
                legend={t("import.title")}
                description={t("import.description")}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-artifact">{t("import.label")}</Label>
                  <Textarea
                    id="import-artifact"
                    data-testid="import-artifact"
                    rows={6}
                    value={artifact}
                    placeholder={t("import.placeholder")}
                    onChange={(event) => setArtifact(event.target.value)}
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    data-testid="import-submit"
                    loading={importing}
                    onClick={() => void runImport()}
                  >
                    {t("import.submit")}
                  </Button>
                </div>
              </FormSection>
              {importError ? (
                <SpeakerMigrationErrorNote
                  testId="import-error"
                  state={importError}
                />
              ) : null}
            </section>
          ) : null}
          {importSuccess ? (
            <SpeakerMigrationSuccessNote testId="import-success">
              {importSuccess}
            </SpeakerMigrationSuccessNote>
          ) : null}

          <div data-testid="speaker-migration-filters">
            <FilterBar
              applyMode="instant"
              label={t("filters.label")}
              applied={applied}
              appliedLabel={t("filters.applied")}
              removeFilterLabel={t("filters.remove")}
              resetLabel={t("filters.reset")}
              onResetAll={resetFilters}
              resultCount={t("filters.count", { total })}
              isBusy={loading}
              busyLabel={t("loading")}
            >
              <NativeSelect
                aria-label={t("filters.classification")}
                value={classification}
                onChange={(event) => {
                  setClassification(
                    event.target.value as SpeakerMigrationClassification | "",
                  );
                  setPage(1);
                }}
              >
                <option value="">{t("filters.allClassifications")}</option>
                {SPEAKER_MIGRATION_CLASSIFICATIONS.map((value) => (
                  <option key={value} value={value}>
                    {classificationLabels[value]}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label={t("filters.disposition")}
                value={disposition}
                // While resolved rows are hidden the queue IS the unresolved
                // set: offering a disposition facet on top of it would let the
                // operator pick a combination that can only ever be empty.
                disabled={!showResolved}
                onChange={(event) => {
                  setDisposition(
                    event.target.value as SpeakerMigrationDisposition | "",
                  );
                  setPage(1);
                }}
              >
                <option value="">{t("filters.allDispositions")}</option>
                {SPEAKER_MIGRATION_DISPOSITIONS.map((value) => (
                  <option key={value} value={value}>
                    {dispositionLabels[value]}
                  </option>
                ))}
              </NativeSelect>
              <Checkbox
                data-testid="filters-show-resolved"
                checked={showResolved}
                onChange={(event) => {
                  setShowResolved(event.target.checked);
                  if (!event.target.checked) setDisposition("");
                  setPage(1);
                }}
              >
                {t("filters.showResolved")}
              </Checkbox>
            </FilterBar>
          </div>

          <div data-testid="speaker-migration-table">
            <div data-testid="speaker-migration-pagination">
              <DataTable<SpeakerMigrationReviewItem>
                caption={t("table.caption")}
                rows={rows}
                getRowKey={(row) => row.sourceId}
                isLoading={loading}
                error={
                  loadError ? (
                    <div role="alert" className="flex flex-col items-start gap-2">
                      <span>{t("errors.loadFailed")}</span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void load()}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  ) : undefined
                }
                isFiltered={isFiltered}
                record={{
                  header: t("table.source"),
                  width: "34%",
                  label: (row) => t("resolution.open", { name: row.sourceName }),
                  title: (row) => (
                    <span
                      className="flex flex-col items-start gap-2"
                      data-testid={`speaker-migration-row-${row.sourceId}`}
                    >
                      <span data-testid="source-name">{row.sourceName}</span>
                      <span className="sr-only" data-testid="source-event-id">
                        {row.eventId}
                      </span>
                      <span className="sr-only" data-testid="source-position">
                        {row.sourcePosition}
                      </span>
                      <span className="sr-only" data-testid="source-fingerprint">
                        {row.contentFingerprint}
                      </span>
                      <span
                        className="sr-only"
                        data-testid="source-classification"
                      >
                        {classificationLabels[row.originalClassification]}
                      </span>
                      <span className="sr-only" data-testid="source-disposition">
                        {dispositionLabels[row.disposition]}
                      </span>
                      {canOperate && row.disposition === "unresolved" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          data-testid="speaker-migration-resolve"
                          onClick={() => setSelected(row)}
                        >
                          {t("resolution.openAction")}
                        </Button>
                      ) : null}
                    </span>
                  ),
                  context: (row) =>
                    t("table.provenance", {
                      event: row.eventId,
                      position: row.sourcePosition,
                      regalia: row.sourceRegalia || t("notSet"),
                      fingerprint: row.contentFingerprint.slice(0, 12),
                    }),
                }}
                columns={[
                  {
                    key: "classification",
                    header: t("table.classification"),
                    render: (row) => (
                      <Badge variant="label">
                        {classificationLabels[row.originalClassification]}
                      </Badge>
                    ),
                  },
                  {
                    key: "disposition",
                    header: t("table.disposition"),
                    render: (row) => dispositionLabels[row.disposition],
                    fullValue: (row) => dispositionLabels[row.disposition],
                  },
                  {
                    key: "reviewed",
                    header: t("table.reviewed"),
                    render: (row) =>
                      row.reviewedAt
                        ? t("table.reviewer", {
                            reviewer: row.reviewerId ?? t("unknownReviewer"),
                            date: new Date(row.reviewedAt).toLocaleString(
                              "ru-RU",
                            ),
                          })
                        : t("table.notReviewed"),
                    overflow: "wrap",
                  },
                ]}
                emptyNoRecords={{
                  title: t("empty.title"),
                  description: t("empty.description"),
                }}
                emptyNoResults={{
                  title: t("noResults.title"),
                  description: t("noResults.description"),
                  action: (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetFilters}
                    >
                      {t("filters.resetFromEmpty")}
                    </Button>
                  ),
                }}
                pagination={{
                  page,
                  pageCount,
                  onPageChange: setPage,
                  navLabel: t("pagination.label"),
                  previousLabel: t("pagination.previous"),
                  nextLabel: t("pagination.next"),
                  pageLabel: (value) => t("pagination.page", { page: value }),
                  readout: t("pagination.readout", { page, pages: pageCount }),
                  isLoading: loading,
                }}
              />
            </div>
          </div>

          {canOperate ? (
            <section
              data-testid="speaker-migration-release"
              className="flex flex-col gap-3"
            >
              <FormSection
                legend={t("release.title")}
                description={t("release.description")}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="release-sha">{t("release.sha")}</Label>
                  <Input
                    id="release-sha"
                    data-testid="release-sha"
                    value={releaseSha}
                    onChange={(event) => setReleaseSha(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="release-ordinal">{t("release.ordinal")}</Label>
                  <Input
                    id="release-ordinal"
                    data-testid="release-ordinal"
                    type="number"
                    min={1}
                    value={releaseOrdinal}
                    onChange={(event) => setReleaseOrdinal(event.target.value)}
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    data-testid="release-submit"
                    loading={releasing}
                    onClick={() => void runRelease()}
                  >
                    {t("release.submit")}
                  </Button>
                </div>
              </FormSection>
              {releaseError ? (
                <SpeakerMigrationErrorNote
                  testId="release-error"
                  state={releaseError}
                />
              ) : null}
              {releaseSuccess ? (
                <SpeakerMigrationSuccessNote testId="release-success">
                  {releaseSuccess}
                </SpeakerMigrationSuccessNote>
              ) : null}
            </section>
          ) : null}

          {canOperate ? (
            <section className="flex flex-col gap-3">
              <FormSection
                legend={t("close.title")}
                description={t("close.description")}
              >
                <div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        data-testid="speaker-migration-close"
                        loading={closing}
                      >
                        {t("close.action")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("close.confirmTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("close.confirmDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="speaker-migration-close-confirm"
                          onClick={() => void runClose()}
                        >
                          {t("close.confirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </FormSection>
              {closeError ? (
                <SpeakerMigrationErrorNote
                  testId="speaker-migration-close-error"
                  state={closeError}
                />
              ) : null}
            </section>
          ) : null}
          {closeSuccess ? (
            <SpeakerMigrationSuccessNote testId="speaker-migration-close-success">
              {closeSuccess}
            </SpeakerMigrationSuccessNote>
          ) : null}
        </div>
        <SpeakerMigrationReviewDialog
          review={selected}
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onResolved={() => void load()}
        />
      </AppShell>
    </Authenticated>
  );
}

function StateFact({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
