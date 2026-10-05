"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Checkbox, Input } from "@ds/design-system";
import { FormActions, FormSection } from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  EVENT_PARTICIPATION_FORMATS,
  type EventKindAdminDetail,
  type EventParticipationFormat,
} from "@ds/schemas";
import {
  EventKindFormSchema,
  type EventKindFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The event-kind authoring form (012 EARS-25, #2509) — the Directions form
 * («Как «Направления»», the owner's look decision) plus one section: the
 * participation formats the kind allows, a non-empty checkbox group over the
 * closed format list. There is no slug (server-derived, frozen on first
 * publish) and no storefront field: the storefront is the event's audience
 * alone (LD-12), so a kind cannot carry one.
 *
 * Narrowing the formats is the server's call: while an event of the kind
 * carries a removed format the save is refused, and the page renders that
 * refusal with the named events. The form itself never guesses.
 */
export interface EventKindFormValues {
  title: string;
  allowedFormats: EventParticipationFormat[];
}

function defaults(detail?: EventKindAdminDetail): EventKindFormFields {
  return {
    title: detail?.title ?? "",
    allowedFormats: detail ? [...detail.allowedFormats] : [],
  };
}

export function EventKindForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: EventKindAdminDetail;
  submitLabel: string;
  onSubmit: (values: EventKindFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<EventKindFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      EventKindFormSchema as unknown as z.ZodType<
        EventKindFormFields,
        EventKindFormFields
      >,
      "eventKinds.validation",
    ),
    defaultValues: defaults(detail),
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6 border-2 border-hairline bg-card p-6"
        data-testid="event-kind-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          // Kept in the closed list's order, whatever order the boxes were ticked.
          onSubmit({
            title: fields.title,
            allowedFormats: EVENT_PARTICIPATION_FORMATS.filter((format) =>
              fields.allowedFormats.includes(format),
            ),
          });
        })}
      >
        <FormSection
          legend={t("eventKinds.sections.main")}
          description={t("eventKinds.sections.mainDescription")}
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="title">
                  {t("eventKinds.fields.title")}
                </FormLabel>
                <FormControl>
                  <Input id="title" data-testid="event-kind-title" {...field} />
                </FormControl>
                <FormMessage>{t("eventKinds.fields.titleHint")}</FormMessage>
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection
          legend={t("eventKinds.sections.formats")}
          description={t("eventKinds.sections.formatsDescription")}
        >
          <FormField
            control={form.control}
            name="allowedFormats"
            render={({ field }) => (
              <FormItem>
                <div
                  className="flex flex-col gap-3"
                  data-testid="event-kind-formats"
                >
                  {EVENT_PARTICIPATION_FORMATS.map((format) => (
                    <Checkbox
                      key={format}
                      id={`allowed-format-${format}`}
                      data-testid={`event-kind-format-${format}`}
                      name={field.name}
                      checked={field.value.includes(format)}
                      onBlur={field.onBlur}
                      onChange={(e) =>
                        field.onChange(
                          e.target.checked
                            ? [...field.value, format]
                            : field.value.filter((f) => f !== format),
                        )
                      }
                    >
                      {t(`events.participationFormats.${format}`)}
                    </Checkbox>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-event-kind"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
