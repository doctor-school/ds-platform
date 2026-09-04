"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";

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

import type { BrowserRoomApi } from "../client/room-api";
import type { RoomCopyStrings, RoomValidationCopy } from "../copy/room-copy";

/**
 * 006 EARS-14 / EARS-16 — the just-in-time «Имя и фамилия» prompt shown ONCE on a
 * gated doctor's first room entry when no display name is set. The host's server
 * page renders this as a PRE-RENDER step INSTEAD of the room (the room is not
 * composed until a name exists), so the doctor is prompted exactly once — once
 * persisted the read returns a name and the prompt never reappears.
 *
 * Validation reuses the `@ds/schemas` SSOT ({@link SetDisplayNameRequestSchema} —
 * trim + non-empty + max 100). D18: the room has no message catalogue of its own,
 * so the zod→RHF error map keys off the issue's structured CODE and SHAPE (never
 * its English text, which a `@ds/schemas` copy edit could change under us) and
 * resolves to the four INJECTED {@link RoomValidationCopy} strings — the same
 * mapping shape the Academy's own `translateIssue` uses. An empty/whitespace-only
 * value is therefore rejected with truthful host copy before submit and identically
 * server-side, and a >100-char name shows its OWN message rather than degrading to
 * the generic fallback.
 *
 * On a valid submit the trimmed name is PUT through the injected
 * {@link BrowserRoomApi}; then `onSaved` lets the host re-run its server page (both
 * storefronts pass `router.refresh`), which now reads a non-null name and renders
 * the room — no optimistic client swap. The name is shown to every participant in
 * the live chat (EARS-17), which the prompt copy discloses up front.
 */

/** A zod v4 issue, narrowed to the fields the map branches on. */
export interface RoomZodIssueLike {
  code: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  path?: PropertyKey[];
  message?: string;
}

/**
 * D18 — map one structured zod issue of {@link SetDisplayNameRequestSchema} to the
 * host's injected validation copy. Exported for the drift guard: a new rule on the
 * schema that this map does not handle degrades to `fallback`, and the suite proves
 * the two rules that exist today do not.
 */
export function translateDisplayNameIssue(
  issue: RoomZodIssueLike,
  errors: RoomValidationCopy,
): string {
  const field = issue.path?.[issue.path.length - 1];

  switch (issue.code) {
    // A missing required field surfaces as invalid_type (undefined → string).
    case "invalid_type":
      return errors.required;

    case "too_small":
      // The trimmed non-empty rule (min 1) on the display name.
      return field === "displayName" ? errors.displayNameRequired : errors.required;

    case "too_big":
      // The max-100 bound — its own truthful copy, never the generic fallback.
      return field === "displayName" ? errors.displayNameTooLong : errors.fallback;

    default:
      return errors.fallback;
  }
}

export interface DisplayNamePromptProps {
  /** The prompt's own strings plus the D18 validation group. */
  copy: Pick<RoomCopyStrings, "displayNamePrompt" | "errors">;
  /** The room's ONE browser transport — `createBrowserRoomApi({ slug })`. */
  api: BrowserRoomApi;
  /** Fired after the name persisted; hosts pass `router.refresh`. */
  onSaved?: () => void;
}

export function DisplayNamePrompt({ copy, api, onSaved }: DisplayNamePromptProps) {
  const [error, setError] = useState<string | null>(null);
  // The host re-renders its server page on `onSaved`; until that lands the control
  // stays busy so a saved name is never followed by an idle-looking form.
  const [saved, setSaved] = useState(false);

  const resolver = useMemo(
    () =>
      zodResolver(SetDisplayNameRequestSchema, {
        error: (issue: RoomZodIssueLike) =>
          translateDisplayNameIssue(issue, copy.errors),
      }) as Resolver<SetDisplayNameRequest, unknown, SetDisplayNameRequest>,
    [copy.errors],
  );

  const form = useForm<SetDisplayNameRequest>({
    mode: "onTouched",
    resolver,
    defaultValues: { displayName: "" },
  });

  async function onSubmit(values: SetDisplayNameRequest) {
    setError(null);
    try {
      await api.setDisplayName(values.displayName);
      setSaved(true);
      onSaved?.();
    } catch {
      setError(copy.displayNamePrompt.error);
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
            {copy.displayNamePrompt.title}
          </CardTitle>
          <CardDescription>{copy.displayNamePrompt.description}</CardDescription>
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
                    <FormLabel>{copy.displayNamePrompt.label}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        autoFocus
                        placeholder={copy.displayNamePrompt.placeholder}
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
                loading={form.formState.isSubmitting || saved}
                data-testid="display-name-submit"
              >
                {copy.displayNamePrompt.submit}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
