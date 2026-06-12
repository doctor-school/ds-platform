"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";

import { type RegisterRequest } from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { EmailField, PasswordField, PhoneField } from "@/components/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { REQUIRED_CONSENT } from "@/lib/consent";
import {
  clearPendingRegistration,
  setPendingRegistration,
} from "@/lib/pending-registration";
import { registerFormSchema } from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import { Form, FormField } from "@ds/design-system/form";

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
  const te = useTranslations("errors");
  const [channel, setChannel] = useState<Channel>("email");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // #200: validate with a channel-specific portal resolver built from the field
  // primitives, NOT the loose `RegisterRequestSchema`. Two reasons: (1) the request
  // schema keeps both identifiers optional behind a dual-identifier `.refine`, which
  // cannot flag a malformed value in the ONE channel the user is editing; (2) its
  // `password` is the message-carrying `NewPasswordSchema`, whose baked-in English
  // outranks the localized error map in zod v4 and leaked onto the field — the
  // channel schema uses the message-less `NewPasswordFieldSchema` so a weak password
  // renders the RU `passwordComplexity` copy. Rebuilt per channel (memoized) so the
  // channel toggle re-validates against the right identifier shape, like the OTP-login
  // form. The submitted body still goes through `authClient.register(...)` and the API
  // still enforces the full `RegisterRequestSchema` (dual-identifier refine + consent).
  const resolverSchema = useMemo(() => registerFormSchema(channel), [channel]);
  const form = useForm<RegisterRequest>({
    // `onTouched` (#200 defect 2): validate on blur and re-validate on change, so a
    // malformed email/phone/password is surfaced before the user clicks submit.
    mode: "onTouched",
    resolver: useLocalizedResolver(resolverSchema),
    defaultValues: {
      email: "",
      password: "",
      consent: REQUIRED_CONSENT.slice(),
    },
  });

  async function onSubmit(values: RegisterRequest) {
    setError(null);
    // Drop any password held from a prior (e.g. failed-then-retried) registration
    // before we re-stash, so the single in-memory slot never carries a stale
    // credential into this attempt (#175 — explicit single-slot replace).
    clearPendingRegistration();
    // Send exactly one identifier field (the schema's dual-identifier invariant).
    const identifier =
      channel === "email" ? { email: values.email } : { phone: values.phone };
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
              {/* One identifier channel at a time (the schema's exactly-one
                  refine). Each uses its semantic primitive, so the validation +
                  (for phone) the E.164 mask are baked in — the phone box now masks
                  `8…`→`+7…` like the OTP-sms box, so a domestic number no longer
                  fails the `E164` shape for want of a manual `+7`. */}
              {channel === "email" ? (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => <EmailField field={field} />}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => <PhoneField field={field} />}
                />
              )}

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <PasswordField field={field} purpose="new" />
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
