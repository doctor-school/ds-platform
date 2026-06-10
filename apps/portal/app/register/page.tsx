"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";

import { RegisterRequestSchema, type RegisterRequest } from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { REQUIRED_CONSENT } from "@/lib/consent";
import {
  clearPendingRegistration,
  setPendingRegistration,
} from "@/lib/pending-registration";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Input } from "@ds/design-system/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";

/*
 * Registration surface (#131, EARS-1 email / EARS-2 phone). Validates with the
 * `@ds/schemas` `RegisterRequestSchema` (the dual-identifier refine + the #147
 * creation-password complexity baseline come for free), submits same-origin to
 * `/v1/auth/register`, and on the `pending_verification` ack routes to `/verify`
 * carrying the identifier so the registrant can submit the code Zitadel mailed.
 *
 * One identifier channel at a time (the schema's exactly-one refine): a toggle
 * picks email or phone and we send only that field. Consent is captured here
 * (EARS-20) — the BFF refuses an empty array — using the canonical ToS pair.
 */

type Channel = "email" | "phone";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("register");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [channel, setChannel] = useState<Channel>("email");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegisterRequest>({
    resolver: useLocalizedResolver(RegisterRequestSchema),
    defaultValues: { email: "", password: "", consent: REQUIRED_CONSENT.slice() },
  });

  async function onSubmit(values: RegisterRequest) {
    setError(null);
    // Drop any password held from a prior (e.g. failed-then-retried) registration
    // before we re-stash, so the single in-memory slot never carries a stale
    // credential into this attempt (#175 — explicit single-slot replace).
    clearPendingRegistration();
    // Send exactly one identifier field (the schema's dual-identifier invariant).
    const identifier =
      channel === "email"
        ? { email: values.email }
        : { phone: values.phone };
    const identifierValue =
      (channel === "email" ? values.email : values.phone) ?? "";
    try {
      await authClient.register({
        ...identifier,
        password: values.password,
        consent: REQUIRED_CONSENT.slice(),
        ...(captchaToken ? { captchaToken } : {}),
      } as RegisterRequest);
      // Hand the entered credential to the verify step IN MEMORY ONLY (#175):
      // module-scoped state survives this SPA `router.push` so `/verify` can
      // replay the EARS-5 password login on success and land the user signed-in
      // on `/account` — but it never touches the URL or any persisted store, and
      // a hard reload of `/verify` drops it (then falls back to `/login`). The
      // identifier is NOT secret and still rides the query as before; only the
      // password is held in memory.
      setPendingRegistration({
        channel,
        identifier: identifierValue,
        password: values.password,
      });
      // Carry the identifier into verification (the BFF infers the channel).
      const q =
        channel === "email"
          ? `email=${encodeURIComponent(identifierValue)}`
          : `phone=${encodeURIComponent(identifierValue)}`;
      router.push(`/verify?${q}`);
    } catch (err) {
      // EARS-16: identical ack for new vs already-registered — the auth OUTCOME
      // stays the generic ack; only 429/5xx/network get a specific message.
      setError(authErrorMessage(err, te, te("registerFailed")));
    }
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    // Clear the other identifier so the dual-identifier refine sees exactly one.
    form.reset({
      ...(next === "email" ? { email: "" } : { phone: "" }),
      password: form.getValues("password"),
      consent: REQUIRED_CONSENT.slice(),
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="text-primary" aria-hidden />
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="mb-4 flex gap-2"
            role="radiogroup"
            aria-label={t("identifierGroupLabel")}
          >
            {(["email", "phone"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                variant={channel === c ? "default" : "outline"}
                size="sm"
                role="radio"
                aria-checked={channel === c}
                onClick={() => switchChannel(c)}
              >
                {c === "email" ? t("channelEmail") : t("channelPhone")}
              </Button>
            ))}
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              {channel === "email" ? (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tc("email")}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder={tc("emailPlaceholder")}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tc("phone")}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          autoComplete="tel"
                          placeholder={tc("phonePlaceholder")}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tc("password")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{tc("passwordPolicy")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <p className="text-xs text-muted-foreground">{t("consent")}</p>

              <BotProtectionField onToken={setCaptchaToken} />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
                data-testid="register-submit"
              >
                {t("submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="text-sm">
          <Link href="/login" className="underline">
            {t("haveAccount")}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
