"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Alert, Button, Input } from "@ds/design-system";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  type ConfigureStreamRequest,
  type EventAdminDetail,
  STREAM_PROVIDERS,
} from "@ds/schemas";
import { TokenSelect } from "@/components/fields";
import {
  StreamConfigFormSchema,
  type StreamConfigFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * Stream-config form (EARS-3) — the operator picks the provider EXPLICITLY from
 * the closed enum `rutube | youtube` (never URL-sniffing) + an embed reference.
 * The choices are the `@ds/schemas` `STREAM_PROVIDERS` SSOT the api validates
 * against, so an unknown provider can't even be selected here. Client-side
 * validation (#665) is derived from the same `ConfigureStreamRequestSchema` SSOT
 * via {@link StreamConfigFormSchema}: `embedRef` is required and must be a
 * provider-scoped id, NOT a URL — a pasted share link is refused inline with an RU
 * message (EARS-10) before the round-trip. Writes via `PUT /v1/admin/events/:id/
 * stream` through the Refine custom mutation. Stock DS controls (EARS-11).
 */
export function StreamConfigForm({
  detail,
  onConfigured,
}: {
  detail: EventAdminDetail;
  onConfigured: () => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const form = useForm<StreamConfigFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      StreamConfigFormSchema as unknown as z.ZodType<
        StreamConfigFields,
        StreamConfigFields
      >,
    ),
    defaultValues: {
      provider: detail.streamConfig?.provider ?? STREAM_PROVIDERS[0],
      embedRef: detail.streamConfig?.embedRef ?? "",
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(values: StreamConfigFields) {
    setError(null);
    setOk(false);
    const body: ConfigureStreamRequest = {
      provider: values.provider,
      embedRef: values.embedRef.trim(),
    };
    mutate(
      {
        url: `/v1/admin/events/${detail.id}/stream`,
        method: "put",
        values: body,
      },
      {
        onSuccess: () => {
          setOk(true);
          onConfigured();
        },
        onError: () => setError(t("events.errors.streamFailed")),
      },
    );
  }

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        data-testid="stream-form"
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        {error ? (
          <Alert variant="danger" data-testid="stream-error">
            {error}
          </Alert>
        ) : null}
        {ok ? (
          <Alert variant="success" data-testid="stream-ok">
            {t("events.toast.streamConfigured")}
          </Alert>
        ) : null}
        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="provider">{t("events.fields.provider")}</FormLabel>
              <FormControl>
                <TokenSelect id="provider" data-testid="provider" {...field}>
                  {STREAM_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {t(`events.providers.${p}`)}
                    </option>
                  ))}
                </TokenSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="embedRef"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="embedRef">{t("events.fields.embedRef")}</FormLabel>
              <FormControl>
                <Input id="embedRef" data-testid="embed-ref" {...field} />
              </FormControl>
              <FormMessage>{t("events.fields.embedRefHint")}</FormMessage>
            </FormItem>
          )}
        />
        <div>
          <Button type="submit" loading={mutation.isPending} data-testid="save-stream">
            {t("events.action.configureStream")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
