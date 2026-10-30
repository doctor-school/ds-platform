"use client";

import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  Alert,
  Badge,
  Button,
  Input,
  NativeSelect,
  Textarea,
} from "@ds/design-system";
import { FormActions } from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  PROJECT_RESULT_DESCRIPTION_MAX,
  PROJECT_RESULTS_MAX,
  type ProjectOutputKindAdminList,
  type ProjectOutputKindRef,
  type ProjectResults,
  type ReplaceProjectResultsRequestInput,
} from "@ds/schemas";
import {
  ProjectResultRowFormSchema,
  type ProjectResultRowFormFields,
} from "@/lib/form-schemas";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import {
  projectOutputKindsUrl,
  projectsUrl,
  type TaxonomyHttpError,
} from "@/providers/data-provider";

const ResultsFormSchema = z.object({
  results: z.array(ProjectResultRowFormSchema).max(PROJECT_RESULTS_MAX),
});

interface ResultsFormFields {
  results: ProjectResultRowFormFields[];
}

const EMPTY_ROW: ProjectResultRowFormFields = {
  outputKindId: "",
  title: "",
  description: "",
  storefrontUrl: "",
};

/** The row fields a server refusal can address (`results.<i>.<field>`). */
const ROW_FIELDS = ["outputKindId", "title", "description", "storefrontUrl"];

/**
 * The «Результаты» tab (030 EARS-2; `project-results` of 030-design §Admin):
 * the project's results as ordered repeatable rows — «Вид» (a select of the
 * active output kinds), «Название», «Описание», «Ссылка на doctor.school» —
 * with move up / down, remove and «Добавить результат», saved as ONE set
 * (`PUT …/results`) under the project's `If-Match` version. The order on
 * screen is the order on the project page.
 *
 * A row may hold a kind that was retired after it was chosen: the API keeps
 * such a result, so the row keeps it too — offered only on that row as
 * «<title> (вид снят)» and marked with the «Вид снят» badge. A new choice is
 * always an active kind.
 *
 * Saving moves the PROJECT's version, so the host re-reads the project
 * (`onSaved`) and the next edit on any tab asserts the version the server holds.
 */
export function ProjectResultsPanel({
  projectId,
  onSaved,
}: {
  projectId: string;
  /** Re-read the project: its version moved with the results. */
  onSaved: () => void;
}) {
  const t = useTranslations();
  const { result: stored, query: storedQuery } = useCustom<ProjectResults>({
    url: projectsUrl.results(projectId),
    method: "get",
  });
  const { result: kindsResult, query: kindsQuery } =
    useCustom<ProjectOutputKindAdminList>({
      url: projectOutputKindsUrl.collection("active"),
      method: "get",
    });

  const results = stored.data?.data;
  const version = stored.data?.version;

  if (storedQuery.isLoading || kindsQuery.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    );
  }
  if (storedQuery.isError || !results || typeof version !== "number") {
    return (
      <Alert variant="danger" data-testid="results-load-error">
        {t("projects.results.loadFailed")}
      </Alert>
    );
  }
  if (kindsQuery.isError) {
    return (
      <Alert variant="danger" data-testid="results-kinds-error">
        {t("projects.results.kindsLoadFailed")}
      </Alert>
    );
  }

  const activeKinds: ProjectOutputKindRef[] = kindsResult.data?.data ?? [];
  // The kinds the stored set holds — a retired one stays selectable on its row.
  const heldKinds = new Map(results.map((r) => [r.outputKind.id, r.outputKind]));

  return (
    <ResultsEditor
      // A fresh editor per stored version: after a save the rows are the
      // server's, not the draft the operator typed.
      key={version}
      projectId={projectId}
      version={version}
      initial={results.map((r) => ({
        outputKindId: r.outputKind.id,
        title: r.title,
        description: r.description ?? "",
        storefrontUrl: r.storefrontUrl ?? "",
      }))}
      activeKinds={activeKinds}
      heldKinds={heldKinds}
      onSaved={() => {
        void storedQuery.refetch();
        onSaved();
      }}
    />
  );
}

function ResultsEditor({
  projectId,
  version,
  initial,
  activeKinds,
  heldKinds,
  onSaved,
}: {
  projectId: string;
  version: number;
  initial: ProjectResultRowFormFields[];
  activeKinds: ProjectOutputKindRef[];
  heldKinds: Map<string, ProjectOutputKindRef>;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const form = useForm<ResultsFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      ResultsFormSchema as unknown as z.ZodType<
        ResultsFormFields,
        ResultsFormFields
      >,
      "projects.validation",
    ),
    defaultValues: { results: initial },
  });
  const rows = useFieldArray({ control: form.control, name: "results" });
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState<TaxonomyHttpError | null>(null);

  const activeIds = useMemo(
    () => new Set(activeKinds.map((k) => k.id)),
    [activeKinds],
  );

  // A server refusal addressed to a row field is marked ON that field.
  useEffect(() => {
    if (refusal?.errorCode !== "VALIDATION_FAILED") return;
    for (const entry of refusal.fieldErrors ?? []) {
      const [root, index, field] = entry.path.split(".");
      if (root !== "results" || !field || !ROW_FIELDS.includes(field)) continue;
      const message =
        field === "outputKindId"
          ? t("projects.results.kindRefused")
          : field === "storefrontUrl"
            ? t("projects.results.urlRefused")
            : t("projects.results.rowRefused");
      form.setError(
        `results.${Number(index)}.${field as keyof ProjectResultRowFormFields}`,
        { type: "server", message },
      );
    }
  }, [refusal, form, t]);

  const values = form.watch("results");
  const atLimit = rows.fields.length >= PROJECT_RESULTS_MAX;

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="project-results-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          setErrorKey(null);
          setSaved(false);
          setRefusal(null);
          const body: ReplaceProjectResultsRequestInput = {
            results: fields.results.map((row) => ({
              outputKindId: row.outputKindId,
              title: row.title.trim(),
              description: row.description.trim() || null,
              storefrontUrl: row.storefrontUrl.trim() || null,
            })),
          };
          mutate(
            {
              url: projectsUrl.results(projectId),
              method: "put",
              values: body,
              meta: { version },
            },
            {
              onSuccess: () => {
                setSaved(true);
                onSaved();
              },
              onError: (error) => {
                const http = error as TaxonomyHttpError;
                setRefusal(http);
                setErrorKey(
                  http.errorCode === "PUBLISH_REQUIREMENTS_NOT_MET"
                    ? "projects.results.publishedNeedsOne"
                    : http.errorCode === "VALIDATION_FAILED"
                      ? "projects.results.saveFailed"
                      : taxonomyErrorKey(error, "projects.results.saveFailed"),
                );
              },
            },
          );
        })}
      >
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-foreground">
            {t("projects.results.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("projects.results.description")}
          </p>
        </div>

        {errorKey ? (
          <Alert variant="danger" data-testid="results-error">
            {t(errorKey)}
          </Alert>
        ) : saved ? (
          <Alert variant="success" data-testid="results-saved">
            {t("projects.results.saved")}
          </Alert>
        ) : null}

        {rows.fields.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="results-empty"
          >
            {t("projects.results.empty")}
          </p>
        ) : null}

        <ol className="flex flex-col gap-4" data-testid="results-rows">
          {rows.fields.map((row, index) => {
            // The retired kind this row was STORED with stays offered on it
            // (`row` keeps the row's stored values while the rows move), and
            // the badge marks the row while it still holds that kind.
            const storedKind = heldKinds.get(row.outputKindId);
            const retiredHeld =
              storedKind && !activeIds.has(storedKind.id) ? storedKind : null;
            const holdsRetired =
              retiredHeld !== null &&
              values[index]?.outputKindId === retiredHeld.id;
            const legend = t("projects.results.rowLegend", {
              number: index + 1,
            });
            return (
              <li
                key={row.id}
                className="flex flex-col gap-4 border-2 border-hairline bg-card p-4"
                data-testid={`result-row-${index}`}
              >
                <fieldset className="flex min-w-0 flex-col gap-4">
                  <legend className="mb-4 flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                    {legend}
                    {holdsRetired ? (
                      <Badge
                        variant="label"
                        data-testid={`result-kind-retired-${index}`}
                      >
                        {t("projects.results.kindRetired")}
                      </Badge>
                    ) : null}
                  </legend>

                  <FormField
                    control={form.control}
                    name={`results.${index}.outputKindId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor={`result-${index}-kind`}>
                          {t("projects.results.kind")}
                        </FormLabel>
                        <FormControl>
                          <NativeSelect
                            id={`result-${index}-kind`}
                            data-testid={`result-kind-${index}`}
                            {...field}
                          >
                            <option value="">
                              {t("projects.results.kindPlaceholder")}
                            </option>
                            {retiredHeld ? (
                              <option value={retiredHeld.id}>
                                {t("projects.results.kindRetiredOption", {
                                  title: retiredHeld.title,
                                })}
                              </option>
                            ) : null}
                            {activeKinds.map((kind) => (
                              <option key={kind.id} value={kind.id}>
                                {kind.title}
                              </option>
                            ))}
                          </NativeSelect>
                        </FormControl>
                        <FormMessage>
                          {holdsRetired
                            ? t("projects.results.kindRetiredHint")
                            : null}
                        </FormMessage>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`results.${index}.title`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor={`result-${index}-title`}>
                          {t("projects.results.resultTitle")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            id={`result-${index}-title`}
                            data-testid={`result-title-${index}`}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`results.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor={`result-${index}-description`}>
                          {t("projects.results.resultDescription")}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            id={`result-${index}-description`}
                            data-testid={`result-description-${index}`}
                            maxLength={PROJECT_RESULT_DESCRIPTION_MAX}
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage>
                          {t("projects.results.resultDescriptionHint")}
                        </FormMessage>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`results.${index}.storefrontUrl`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor={`result-${index}-url`}>
                          {t("projects.results.storefrontUrl")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            id={`result-${index}-url`}
                            type="url"
                            inputMode="url"
                            placeholder={t("projects.results.storefrontUrlPlaceholder")}
                            data-testid={`result-url-${index}`}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage>
                          {t("projects.results.storefrontUrlHint")}
                        </FormMessage>
                      </FormItem>
                    )}
                  />
                </fieldset>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={index === 0}
                    aria-label={`${t("projects.results.moveUp")}: ${legend}`}
                    data-testid={`result-up-${index}`}
                    onClick={() => rows.move(index, index - 1)}
                  >
                    {t("projects.results.moveUp")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={index === rows.fields.length - 1}
                    aria-label={`${t("projects.results.moveDown")}: ${legend}`}
                    data-testid={`result-down-${index}`}
                    onClick={() => rows.move(index, index + 1)}
                  >
                    {t("projects.results.moveDown")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`${t("projects.results.remove")}: ${legend}`}
                    data-testid={`result-remove-${index}`}
                    onClick={() => rows.remove(index)}
                  >
                    {t("projects.results.remove")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={atLimit}
            data-testid="result-add"
            onClick={() => rows.append({ ...EMPTY_ROW })}
          >
            {t("projects.results.add")}
          </Button>
          {atLimit ? (
            <p className="text-xs text-muted-foreground">
              {t("projects.results.limit")}
            </p>
          ) : null}
        </div>

        <FormActions>
          <Button
            type="submit"
            loading={mutation.isPending}
            data-testid="results-save"
          >
            {t("projects.results.save")}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
