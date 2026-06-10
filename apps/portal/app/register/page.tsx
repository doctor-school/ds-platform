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
import { REQUIRED_CONSENT } from "@/lib/consent";
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
    // Send exactly one identifier field (the schema's dual-identifier invariant).
    const identifier =
      channel === "email"
        ? { email: values.email }
        : { phone: values.phone };
    try {
      await authClient.register({
        ...identifier,
        password: values.password,
        consent: REQUIRED_CONSENT.slice(),
        ...(captchaToken ? { captchaToken } : {}),
      } as RegisterRequest);
      // Carry the identifier into verification (the BFF infers the channel).
      const q =
        channel === "email"
          ? `email=${encodeURIComponent(values.email ?? "")}`
          : `phone=${encodeURIComponent(values.phone ?? "")}`;
      router.push(`/verify?${q}`);
    } catch {
      // EARS-16: identical ack for new vs already-registered — generic on error.
      setError(te("registerFailed"));
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
