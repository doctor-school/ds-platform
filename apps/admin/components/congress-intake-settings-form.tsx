"use client";

import { useState } from "react";
import { useForm, type Control } from "react-hook-form";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
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
import type {
  CongressIntakeSettings,
  CongressSubmissionKind,
} from "@ds/schemas";
import {
  INTAKE_KIND_ORDER,
  formatIntakeDay,
  intakeFormFields,
  intakeRefusals,
  intakeRequest,
  type IntakeFieldPath,
  type IntakeFormFields,
} from "@/lib/congress-intake-settings";
import type { TaxonomyHttpError } from "@/providers/data-provider";
import { congressIntakeSettingsUrl } from "@/providers/data-provider";

/**
 * 046 EARS-2 / EARS-3 (#2432) — the congress intake settings of one event, on
 * the owner-approved admin form pattern (`StreamConfigForm`: DS `Form` +
 * `FormField` rows in `Card`s, one `Alert` for the outcome, one submit through
 * the Refine custom mutation). Stage A route «а» (#2432): no canvas.
 *
 * Validation is the server's: the PUT body goes as entered and each refusal
 * comes back on the field its issue names (`intakeRefusals`), so the rules live
 * once, in `CongressIntakeSettingsRequestSchema`. Dates are Moscow calendar days
 * (EARS-3): a set last day reads back as «До {дата} включительно».
 */
export function CongressIntakeSettingsForm({
  settings,
}: {
  settings: CongressIntakeSettings;
}) {
  const t = useTranslations("congressIntake");
  const { mutate, mutation } = useCustomMutation<CongressIntakeSettings>();
  const form = useForm<IntakeFormFields>({
    defaultValues: intakeFormFields(settings),
  });
  const [configured, setConfigured] = useState(settings.configured);
  const [outcome, setOutcome] = useState<"saved" | "refused" | "failed" | null>(
    null,
  );

  function submit(values: IntakeFormFields) {
    setOutcome(null);
    form.clearErrors();
    mutate(
      {
        url: congressIntakeSettingsUrl(settings.eventId),
        method: "put",
        values: intakeRequest(values),
      },
      {
        onSuccess: ({ data }) => {
          // The saved settings are the new baseline of the form.
          form.reset(intakeFormFields(data));
          setConfigured(data.configured);
          setOutcome("saved");
        },
        onError: (error) => {
          const refusals =
            (error as TaxonomyHttpError).statusCode === 400
              ? intakeRefusals((error as TaxonomyHttpError).fieldErrors)
              : [];
          if (refusals.length === 0) {
            setOutcome("failed");
            return;
          }
          refusals.forEach(({ field, reason }, index) =>
            form.setError(
              field,
              { type: "server", message: t(`refusals.${reason}`) },
              { shouldFocus: index === 0 },
            ),
          );
          setOutcome("refused");
        },
      },
    );
  }

  const revisionLastDay = form.watch("revisionLastDay");

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6"
        data-testid="congress-intake-form"
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        {!configured ? (
          <Alert variant="info" data-testid="congress-intake-defaults">
            {t("notConfigured")}
          </Alert>
        ) : null}
        {outcome === "saved" ? (
          <Alert variant="success" data-testid="congress-intake-saved">
            {t("saved")}
          </Alert>
        ) : null}
        {outcome === "refused" ? (
          <Alert variant="danger" data-testid="congress-intake-refused">
            {t("errors.saveRefused")}
          </Alert>
        ) : null}
        {outcome === "failed" ? (
          <Alert variant="danger" data-testid="congress-intake-failed">
            {t("errors.saveFailed")}
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.general")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="registrationUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="registrationUrl">
                      {t("fields.registrationUrl")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="registrationUrl"
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        data-testid="intake-registrationUrl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage>{t("fields.registrationUrlHint")}</FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="firstAuthorCounts"
                render={({ field: { value, onChange, ...field } }) => (
                  <FormItem>
                    <FormControl>
                      <Switch
                        id="firstAuthorCounts"
                        data-testid="intake-firstAuthorCounts"
                        checked={value}
                        onChange={(event) => onChange(event.target.checked)}
                        {...field}
                      >
                        {t("fields.firstAuthorCounts")}
                      </Switch>
                    </FormControl>
                    <FormMessage>
                      {t("fields.firstAuthorCountsHint")}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="revisionLastDay"
                render={({ field }) => (
                  <FormItem className="sm:max-w-xs">
                    <FormLabel htmlFor="revisionLastDay">
                      {t("fields.revisionLastDay")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="revisionLastDay"
                        type="date"
                        data-testid="intake-revisionLastDay"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage>
                      {revisionLastDay
                        ? t("fields.revisionLastDaySet", {
                            date: formatIntakeDay(revisionLastDay),
                          })
                        : t("fields.revisionLastDayHint")}
                    </FormMessage>
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {INTAKE_KIND_ORDER.map((kind) => (
          <KindCard key={kind} kind={kind} control={form.control} />
        ))}

        <div>
          <Button
            type="submit"
            loading={mutation.isPending}
            data-testid="intake-save"
          >
            {t("save")}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** One kind's window and limits — the same four fields for each kind. */
function KindCard({
  kind,
  control,
}: {
  kind: CongressSubmissionKind;
  control: Control<IntakeFormFields>;
}) {
  const t = useTranslations("congressIntake");
  const id = (name: string) => `${kind}-${name}`;
  const path = (name: string) => `kinds.${kind}.${name}` as IntakeFieldPath;

  return (
    <Card data-testid={`intake-kind-${kind}`}>
      <CardHeader>
        <CardTitle>{t(`kinds.${kind}`)}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={control}
            name={path("opensOn")}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={id("opensOn")}>
                  {t("fields.opensOn")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={id("opensOn")}
                    type="date"
                    data-testid={`intake-${kind}-opensOn`}
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("fields.opensOnHint")}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={path("lastDay")}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={id("lastDay")}>
                  {t("fields.lastDay")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={id("lastDay")}
                    type="date"
                    data-testid={`intake-${kind}-lastDay`}
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {field.value
                    ? t("fields.lastDaySet", {
                        date: formatIntakeDay(field.value),
                      })
                    : t("fields.lastDayHint")}
                </FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={path("submitLimit")}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={id("submitLimit")}>
                  {t("fields.submitLimit")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={id("submitLimit")}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    data-testid={`intake-${kind}-submitLimit`}
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("fields.submitLimitHint")}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={path("maxAgeYears")}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={id("maxAgeYears")}>
                  {t("fields.maxAgeYears")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={id("maxAgeYears")}
                    type="number"
                    inputMode="numeric"
                    min={18}
                    max={99}
                    step={1}
                    data-testid={`intake-${kind}-maxAgeYears`}
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("fields.maxAgeYearsHint")}</FormMessage>
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
