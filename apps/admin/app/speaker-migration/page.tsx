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
  NativeSelect,
} from "@ds/design-system";
import { DataTable, FilterBar } from "@ds/design-system/blocks";
import {
  SPEAKER_MIGRATION_CLASSIFICATIONS,
  SPEAKER_MIGRATION_DISPOSITIONS,
  type SpeakerMigrationReviewItem,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { SpeakerMigrationReviewDialog } from "@/components/speaker-migration-review-dialog";
import {
  cutoverSpeakerMigration,
  fetchSpeakerMigrationReviews,
} from "@/providers/data-provider";

const PAGE_SIZE = 25;
// blocks-adopted: DataTable + FilterBar + Pagination + EmptyState (official shadcn, MIT); Combobox (Kibo UI, MIT); FormSection + Dialog/Tabs (approved @ds/design-system blocks/primitives from #1605).
type SpeakerMigrationClassification =
  (typeof SPEAKER_MIGRATION_CLASSIFICATIONS)[number];
type SpeakerMigrationDisposition =
  (typeof SPEAKER_MIGRATION_DISPOSITIONS)[number];

export default function SpeakerMigrationPage() {
  const t = useTranslations("speakerMigration");
  const [rows, setRows] = useState<SpeakerMigrationReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [classification, setClassification] =
    useState<SpeakerMigrationClassification | "">("");
  const [disposition, setDisposition] =
    useState<SpeakerMigrationDisposition | "">("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<SpeakerMigrationReviewItem | null>(
    null,
  );
  const [cutoverLoading, setCutoverLoading] = useState(false);
  const [cutoverError, setCutoverError] = useState<string | null>(null);
  const [cutoverResult, setCutoverResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await fetchSpeakerMigrationReviews({
        page,
        pageSize: PAGE_SIZE,
        ...(classification ? { classification } : {}),
        ...(disposition ? { disposition } : {}),
      });
      setRows(result.data);
      setTotal(result.total);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [classification, disposition, page]);

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
    existing_expert: t("dispositions.existingExpert"),
    created_expert: t("dispositions.createdExpert"),
    content_removed: t("dispositions.contentRemoved"),
  };
  const isFiltered = Boolean(classification || disposition);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
      ...(disposition
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
    ],
    [classification, classificationLabels, disposition, dispositionLabels],
  );

  async function cutover() {
    setCutoverLoading(true);
    setCutoverError(null);
    try {
      const result = await cutoverSpeakerMigration();
      setCutoverResult(
        t("cutover.success", {
          resolved: result.resolved,
          removed: result.contentRemoved,
        }),
      );
      await load();
    } catch {
      setCutoverError(t("cutover.unresolved"));
    } finally {
      setCutoverLoading(false);
    }
  }

  return (
    <Authenticated key="speaker-migration" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-extrabold text-foreground">
                {t("title")}
              </h1>
              <p className="max-w-prose text-sm text-muted-foreground">
                {t("description")}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  data-testid="speaker-migration-cutover"
                  disabled={cutoverLoading || Boolean(cutoverResult)}
                >
                  {t("cutover.action")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("cutover.title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("cutover.description")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="speaker-migration-cutover-confirm"
                    onClick={() => void cutover()}
                  >
                    {t("cutover.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {cutoverError ? (
            <div
              role="alert"
              data-testid="speaker-migration-cutover-error"
              className="border-2 border-destructive bg-destructive-tint p-3 text-sm text-destructive-text"
            >
              {cutoverError}
            </div>
          ) : null}
          {cutoverResult ? (
            <div
              role="status"
              data-testid="speaker-migration-cutover-success"
              className="border-2 border-success bg-success-tint p-3 text-sm text-success-text"
            >
              {cutoverResult}
            </div>
          ) : null}

          <div data-testid="speaker-migration-filters">
            <FilterBar
              applyMode="instant"
              label={t("filters.label")}
              applied={applied}
              appliedLabel={t("filters.applied")}
              removeFilterLabel={t("filters.remove")}
              resetLabel={t("filters.reset")}
              onResetAll={() => {
                setClassification("");
                setDisposition("");
                setPage(1);
              }}
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
            </FilterBar>
          </div>

          {rows.length > 0 && rows.every((row) => row.disposition !== "unresolved") ? (
            <p
              data-testid="speaker-migration-resolved-empty"
              className="text-sm text-success-text"
            >
              {t("resolvedPage")}
            </p>
          ) : null}

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
                    <Button type="button" variant="outline" onClick={() => void load()}>
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
                    <span className="sr-only" data-testid="source-classification">
                      {classificationLabels[row.originalClassification]}
                    </span>
                    <span className="sr-only" data-testid="source-disposition">
                      {dispositionLabels[row.disposition]}
                    </span>
                    {row.disposition === "unresolved" ? (
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
                context: (row) => t("table.provenance", {
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
                          date: new Date(row.reviewedAt).toLocaleString("ru-RU"),
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
                    onClick={() => {
                      setClassification("");
                      setDisposition("");
                      setPage(1);
                    }}
                  >
                    {t("filters.reset")}
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
