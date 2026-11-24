"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button, Input, NativeSelect } from "@ds/design-system";
import { FormActions } from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { FeedSourceNetworkSchema, type FeedSourceNetwork } from "@ds/schemas";
import {
  feedSourceAddressFieldError,
  feedSourceAddressLabel,
} from "@/lib/feed-source-address";

export interface FeedSourceFormFields {
  platform: FeedSourceNetwork;
  address: string;
}

/**
 * The «Добавить источник» / «Изменить адрес» form (048 EARS-21, EARS-38). Two
 * fields on add — the platform among the connected networks («Telegram»,
 * «VK») and the address, named for the platform («Адрес канала» /
 * «Адрес сообщества») with its own example; the edit changes the address of
 * the stored platform only.
 *
 * The address is checked here with the SAME per-platform normalizer the API
 * applies, so an address of another form or an invite link is refused at
 * the field before any request; what only the server knows (the address is
 * already listed) comes back as a `VALIDATION_FAILED` on `address` and is
 * marked on the same field (`addressRefusal`). The typed value stays in the
 * input either way — the form is never reset by a refusal.
 */
export function FeedSourceForm({
  mode,
  platform: storedPlatform = "telegram",
  defaultAddress = "",
  submitLabel,
  submitting,
  addressRefusal,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  mode: "create" | "edit";
  /** The stored source's platform (edit); a new source starts on Telegram. */
  platform?: FeedSourceNetwork;
  /** The stored name, shown as `t.me/<имя>` / `vk.com/<имя>` in the edit field. */
  defaultAddress?: string;
  submitLabel: string;
  submitting?: boolean;
  /** The server's sentence for `address` from the last refusal, if any. */
  addressRefusal?: string | null;
  onSubmit: (values: FeedSourceFormFields) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const t = useTranslations();
  const form = useForm<FeedSourceFormFields>({
    mode: "onSubmit",
    defaultValues: {
      platform: storedPlatform,
      address: defaultAddress
        ? feedSourceAddressLabel(storedPlatform, defaultAddress)
        : "",
    },
  });
  const platform =
    useWatch({ control: form.control, name: "platform" }) ?? storedPlatform;

  useEffect(() => {
    if (addressRefusal) {
      form.setError("address", { type: "server", message: addressRefusal });
    }
  }, [addressRefusal, form]);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6"
        data-testid="feed-source-form"
        noValidate
        onSubmit={form.handleSubmit((fields) =>
          onSubmit({
            platform: fields.platform,
            address: fields.address.trim(),
          }),
        )}
      >
        {mode === "create" ? (
          <FormField
            control={form.control}
            name="platform"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="feed-source-platform">
                  {t("feedSources.fields.platform")}
                </FormLabel>
                <FormControl>
                  <NativeSelect
                    id="feed-source-platform"
                    data-testid="feed-source-platform"
                    {...field}
                  >
                    {FeedSourceNetworkSchema.options.map((value) => (
                      <option key={value} value={value}>
                        {t(`feedSources.platforms.${value}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="address"
          rules={{
            validate: (value, fields) =>
              feedSourceAddressFieldError(fields.platform, value),
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="feed-source-address">
                {t(`feedSources.fields.address.${platform}`)}
              </FormLabel>
              <FormControl>
                <Input
                  id="feed-source-address"
                  data-testid="feed-source-address"
                  autoComplete="off"
                  spellCheck={false}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {t(`feedSources.fields.addressHint.${platform}`)}
              </FormMessage>
            </FormItem>
          )}
        />
        <FormActions>
          {onCancel && cancelLabel ? (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onCancel}
              data-testid="feed-source-cancel"
            >
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-feed-source"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
