"use client";

import { useTranslations } from "next-intl";
import type { Control, FieldValues, Path } from "react-hook-form";
import { Input } from "@ds/design-system";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { STREAM_PROVIDERS, type StreamProvider } from "@ds/schemas";
import { TokenSelect } from "@/components/fields";

/**
 * The recording SOURCE fields — provider, embed reference, and (for the hosts
 * that author them) poster and duration — as one component (014 EARS-1 / EARS-24).
 *
 * It exists because two surfaces author the same triple: the «Записи» panel's
 * attach/edit dialog, and (since #1741) the create-event form when «Это архивный
 * эфир» is checked. Those are two hosts of ONE capability, so the fields are
 * extracted rather than copied — a forked second block would let the per-provider
 * hint and the reference shape drift apart between the dialog an operator uses
 * after the эфир and the form they use to author one that predates the platform
 * (AGENTS.md §6 — reuse before invention).
 *
 * `fields` says WHICH of them a host renders. `"source"` is provider + embed
 * reference only — what the create-event form asks for, after the owner refused
 * a poster typed as a storage key and a duration typed by hand («это должна
 * быть загрузка файла… почему мы не можем сами определить длительность?», Stage
 * B 2026-09-03): both become a file upload and a metadata read in #1611
 * (EARS-20), which also reworks the dialog. Until then `"full"` keeps the
 * dialog exactly as it is — one component, two hosts, no forked JSX.
 *
 * The host owns everything around the triple: the RHF form itself, where the
 * values live in it (`names`), the id/testid prefix, and — for the event form —
 * the recording `kind` box, which is a property of the ROW rather than of its
 * source (the dialog is opened per kind and so has no box for it at all).
 */
export interface RecordingSourceFieldNames<T extends FieldValues> {
  provider: Path<T>;
  embedRef: Path<T>;
  /** Required by `fields: "full"` hosts only — absent from a `"source"` form. */
  posterRef?: Path<T>;
  /** Required by `fields: "full"` hosts only — absent from a `"source"` form. */
  durationSecText?: Path<T>;
}

export function RecordingSourceFieldSet<T extends FieldValues>({
  control,
  names,
  provider,
  idPrefix,
  fields = "full",
}: {
  control: Control<T>;
  names: RecordingSourceFieldNames<T>;
  /**
   * The provider currently selected in the host form. Passed in rather than
   * watched here: the reference shape differs per provider (#1134) and the hint
   * must track the live selection, which is the host's form state to read.
   */
  provider: StreamProvider;
  /** Prefix for every `id` / `data-testid` — the host's stable handle set. */
  idPrefix: string;
  /**
   * `"source"` — provider + embed reference; `"full"` — plus poster and
   * duration. Defaulted to `"full"` so the attach dialog reads unchanged.
   */
  fields?: "source" | "full";
}) {
  const t = useTranslations();

  return (
    <>
      <FormField
        control={control}
        name={names.provider}
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={`${idPrefix}-provider`}>
              {t("recordings.fields.provider")}
            </FormLabel>
            <FormControl>
              <TokenSelect
                id={`${idPrefix}-provider`}
                data-testid={`${idPrefix}-provider`}
                {...field}
              >
                {STREAM_PROVIDERS.map((option) => (
                  <option key={option} value={option}>
                    {t(`events.providers.${option}`)}
                  </option>
                ))}
              </TokenSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={names.embedRef}
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={`${idPrefix}-embed-ref`}>
              {t("recordings.fields.embedRef")}
            </FormLabel>
            <FormControl>
              <Input
                id={`${idPrefix}-embed-ref`}
                data-testid={`${idPrefix}-embed-ref`}
                {...field}
              />
            </FormControl>
            {/* The reference shape differs per provider (#1134) — the hint
                tracks the selected one, exactly as the stream form does. */}
            <FormMessage>
              {t(`events.fields.embedRefHint.${provider}`)}
            </FormMessage>
          </FormItem>
        )}
      />
      {fields === "full" ? (
        <>
          <FormField
            control={control}
            name={names.posterRef!}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={`${idPrefix}-poster-ref`}>
                  {t("recordings.fields.posterRef")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={`${idPrefix}-poster-ref`}
                    data-testid={`${idPrefix}-poster-ref`}
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("recordings.fields.posterRefHint")}
                </FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={names.durationSecText!}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={`${idPrefix}-duration`}>
                  {t("recordings.fields.durationSec")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={`${idPrefix}-duration`}
                    data-testid={`${idPrefix}-duration`}
                    inputMode="numeric"
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("recordings.fields.durationSecHint")}
                </FormMessage>
              </FormItem>
            )}
          />
        </>
      ) : null}
    </>
  );
}
