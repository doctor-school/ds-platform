"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button, Input } from "@ds/design-system";
import {
  type ConfigureStreamRequest,
  type EventAdminDetail,
  STREAM_PROVIDERS,
} from "@ds/schemas";
import { Field, TokenSelect } from "@/components/fields";

/**
 * Stream-config form (EARS-3) — the operator picks the provider EXPLICITLY from
 * the closed enum `rutube | youtube` (never URL-sniffing) + an embed reference.
 * The choices are the `@ds/schemas` `STREAM_PROVIDERS` SSOT the api validates
 * against, so an unknown provider can't even be selected here, and the api rejects
 * one at the boundary regardless (EARS-3). Writes via `PUT /v1/admin/events/:id/
 * stream` through the Refine custom mutation. Stock DS controls (EARS-11), RU copy
 * (EARS-10).
 */
export function StreamConfigForm({
  detail,
  onConfigured,
}: {
  detail: EventAdminDetail;
  onConfigured: () => void;
}) {
  const t = useTranslations();
  const { mutate, isLoading } = useCustomMutation();
  const [provider, setProvider] = useState(
    detail.streamConfig?.provider ?? STREAM_PROVIDERS[0],
  );
  const [embedRef, setEmbedRef] = useState(detail.streamConfig?.embedRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="stream-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setOk(false);
        const body: ConfigureStreamRequest = { provider, embedRef };
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
      }}
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
      <Field label={t("events.fields.provider")} htmlFor="provider">
        <TokenSelect
          id="provider"
          data-testid="provider"
          value={provider}
          onChange={(e) =>
            setProvider(e.target.value as (typeof STREAM_PROVIDERS)[number])
          }
        >
          {STREAM_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(`events.providers.${p}`)}
            </option>
          ))}
        </TokenSelect>
      </Field>
      <Field
        label={t("events.fields.embedRef")}
        htmlFor="embedRef"
        hint={t("events.fields.embedRefHint")}
      >
        <Input
          id="embedRef"
          data-testid="embed-ref"
          value={embedRef}
          onChange={(e) => setEmbedRef(e.target.value)}
          required
        />
      </Field>
      <div>
        <Button type="submit" loading={isLoading} data-testid="save-stream">
          {t("events.action.configureStream")}
        </Button>
      </div>
    </form>
  );
}
