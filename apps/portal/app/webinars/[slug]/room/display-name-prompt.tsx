"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";

import { SetDisplayNameRequestSchema, type SetDisplayNameRequest } from "@ds/schemas";

import { Button } from "@ds/design-system/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { Input } from "@ds/design-system/input";

import { setDisplayName } from "@/lib/display-name-client";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * 006 EARS-14 / EARS-16 — the just-in-time «Имя и фамилия» prompt shown ONCE on a
 * gated doctor's first room entry when no display name is set. The server page
 * ({@link RoomPage}) renders this as a PRE-RENDER step INSTEAD of the room (the
 * room is not composed until a name exists), so the doctor is prompted exactly
 * once — once persisted the read returns a name and the prompt never reappears.
 *
 * Validation reuses the `@ds/schemas` SSOT ({@link SetDisplayNameRequestSchema} —
 * trim + non-empty + max 100), localized through {@link useLocalizedResolver}, so
 * an empty/whitespace-only value is rejected with truthful RU copy before submit
 * and identically server-side. On a valid submit the trimmed name is PUT via
 * {@link setDisplayName}; then `router.refresh()` re-runs the server page, which
 * now reads a non-null name and renders the room (the header avatar = its
 * initials). The name is shown to every participant in the live chat (EARS-16) —
 * the prompt copy discloses this up front («Ваше имя будут видеть участники чата
 * эфира»). All copy resolves through the message catalog.
 */
export function DisplayNamePrompt() {
  const t = useTranslations("room");
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<SetDisplayNameRequest>({
    mode: "onTouched",
    resolver: useLocalizedResolver(SetDisplayNameRequestSchema),
    defaultValues: { displayName: "" },
  });

  async function onSubmit(values: SetDisplayNameRequest) {
    setError(null);
    try {
      await setDisplayName(values.displayName);
      // Re-run the server page so it re-reads the now-set name and composes the
      // room (the header avatar renders its initials) — no optimistic client swap.
      startRefresh(() => router.refresh());
    } catch {
      setError(t("displayNamePrompt.error"));
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4"
      data-testid="display-name-prompt"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">
            {t("displayNamePrompt.title")}
          </CardTitle>
          <CardDescription>
            {t("displayNamePrompt.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("displayNamePrompt.label")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        autoFocus
                        placeholder={t("displayNamePrompt.placeholder")}
                        data-testid="display-name-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormError>{error}</FormError>
              <Button
                type="submit"
                className="w-full"
                loading={form.formState.isSubmitting || isRefreshing}
                data-testid="display-name-submit"
              >
                {t("displayNamePrompt.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
