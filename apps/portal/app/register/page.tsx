"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";

import { type RegisterRequest } from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { BotProtectionField } from "@/components/bot-protection";
import { EmailField, PasswordField } from "@ds/design-system/fields";
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
import { Link as DsLink } from "@ds/design-system/link";
import { AuthCard } from "@ds/design-system/blocks";
import { Form, FormField } from "@ds/design-system/form";

/*
 * Registration surface (#131, EARS-1). Email-primary (#202): registration is
 * email + password only — Zitadel cannot create a login-capable human without an
 * email, so the dual-identifier email/phone toggle was removed (phone is a future
 * post-registration secondary identifier; it stays on /login, OTP-login, /reset).
 *
 * Validates with a portal resolver built from the field primitives (#200, see
 * `registerFormSchema`), submits same-origin to `/v1/auth/register`, and on the
 * `pending_verification` ack routes to `/verify?email=…` carrying the email so the
 * registrant can submit the code Zitadel mailed. Consent is captured here
 * (EARS-20) — the BFF refuses an empty array — using the canonical ToS pair.
 */

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("register");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // #200/#202: validate with the email-only portal resolver built from the field
  // primitives, NOT the loose `RegisterRequestSchema`. Its `password` is the
  // message-less `NewPasswordFieldSchema`, whose issues the localized resolver maps
  // to the RU `passwordComplexity` copy (the request schema's baked-in English would
  // outrank the error map in zod v4). The submitted body still goes through
  // `authClient.register(...)` and the API still enforces the full
  // `RegisterRequestSchema` (email required + consent).
  const form = useForm<RegisterRequest>({
    // `onTouched` (#200 defect 2): validate on blur and re-validate on change, so a
    // malformed email/password is surfaced before the user clicks submit.
    mode: "onTouched",
    resolver: useLocalizedResolver(registerFormSchema()),
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
    try {
      await authClient.register({
        email: values.email,
        password: values.password,
        consent: REQUIRED_CONSENT.slice(),
        ...(captchaToken ? { captchaToken } : {}),
      } as RegisterRequest);
      // Hand the entered credential to the verify step IN MEMORY ONLY (#175):
      // module-scoped state survives this SPA `router.push` so `/verify` can
      // replay the EARS-5 password login on success and land the user signed-in
      // on `/account` — but it never touches the URL or any persisted store, and
      // a hard reload of `/verify` drops it (then falls back to `/login`). The
      // email is NOT secret and still rides the query; only the password is held
      // in memory.
      setPendingRegistration({
        identifier: values.email,
        password: values.password,
      });
      // Carry the email into verification (registration is email-only, #202).
      router.push(`/verify?email=${encodeURIComponent(values.email)}`);
    } catch (err) {
      // EARS-16: identical ack for new vs already-registered — the auth OUTCOME
      // stays the generic ack; only 429/5xx/network get a specific message.
      setError(authErrorMessage(err, te, te("registerFailed")));
    }
  }

  return (
    <AuthShell>
      <AuthCard
        icon={<UserPlus className="text-primary" aria-hidden />}
        title={t("title")}
        description={t("description")}
        footer={
          <DsLink asChild>
            <Link href="/login">{t("haveAccount")}</Link>
          </DsLink>
        }
      >
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <EmailField
                  field={field}
                  label={tc("email")}
                  placeholder={tc("emailPlaceholder")}
                />
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <PasswordField
                  field={field}
                  purpose="new"
                  label={tc("password")}
                  policyHint={tc("passwordPolicy")}
                />
              )}
            />

            <p className="text-xs text-muted-foreground">{t("consent")}</p>

            <BotProtectionField onToken={setCaptchaToken} />
            {error && (
              <p role="alert" className="text-xs text-destructive">
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
      </AuthCard>
    </AuthShell>
  );
}
