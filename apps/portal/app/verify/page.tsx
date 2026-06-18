"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";

import {
  VerifyRequestSchema,
  type LoginRequest,
  type RegisterRequest,
  type VerifyRequest,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { REQUIRED_CONSENT } from "@/lib/consent";
import {
  peekPendingRegistration,
  takePendingRegistration,
} from "@/lib/pending-registration";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Form, FormField } from "@ds/design-system/form";
import {
  AuthCard,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";

/** The registration verification code is a FIXED 6 characters (Zitadel default) —
 * and ALPHANUMERIC (the email code is not digits-only). The slotted `<OtpField>`
 * inside `<OtpFocusScreen>` accepts letters (no digit-only filter). */
const VERIFY_OTP_LENGTH = 6;

/*
 * Post-registration surface (#131, EARS-3; reframed #207, EARS-24; rebuilt on
 * `@ds/design-system` for #237). The BFF returns the IDENTICAL
 * `pending_verification` for a brand-new and an already-registered email (EARS-16),
 * so this screen CANNOT know which visitor it is showing — and must NEVER branch on
 * account existence. It is therefore framed as a single, existence-agnostic "check
 * your email" view with two co-equal affordances:
 *   (a) enter the email code  — the new registrant's path, now the reusable
 *       `<OtpFocusScreen>` (masked destination + resend/cooldown + auto-submit +
 *       post-verify auto-login, #175/#194/#227);
 *   (b) Войти / Сбросить пароль — prominent actions for the already-registered
 *       owner, whose correct path is ALSO delivered privately by the EARS-23
 *       account-exists notice email.
 * The per-case routing happens in the inbox or by the user's own choice, never by
 * the form disclosing existence. All copy is from the EARS-21 message catalog.
 *
 * Registration verification is email-only (#202). Validates with
 * `VerifyRequestSchema`, submits same-origin to `/v1/auth/verify`.
 *
 * Auto-login on success (#175): the verify API proves channel ownership (EARS-3)
 * but mints NO session. `/register` stashed the entered password in a volatile
 * in-memory store; on a successful verify we read it back (and wipe it) and replay
 * the REAL EARS-5 password login (`POST /v1/auth/login` → EARS-8 cookie), then land
 * on `/account`. The session therefore still comes from the password login, NOT
 * `/auth/verify`. With no held password (deep-link / reload) we route to `/login`.
 *
 * Auto-submit (#175): the registration code is a FIXED 6 characters, so the
 * focus-screen's native `onComplete` fires the submit the moment the last digit
 * lands; the in-flight guard prevents a double-submit on a race.
 *
 * Resend (#227): re-issues the verification email by re-POSTing `/register` with the
 * held (non-consumed) credential — the BFF re-sends the same EARS-16 ack. Only
 * possible within the in-flight SPA session (the password lives in memory); a
 * deep-link without a held credential is the degraded flow the (b) section guides.
 *
 * `useSearchParams` requires a Suspense boundary in the App Router, so the card is
 * split out and wrapped below; the branded shell stays outside the boundary.
 */

export default function VerifyPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <VerifyCard />
      </Suspense>
    </AuthShell>
  );
}

function VerifyCard() {
  const router = useRouter();
  const t = useTranslations("verify");
  const ta = useTranslations("auth");
  const te = useTranslations("errors");
  const params = useSearchParams();
  const email = params.get("email") ?? undefined;
  const [error, setError] = useState<string | null>(null);

  const form = useForm<VerifyRequest>({
    resolver: useLocalizedResolver(VerifyRequestSchema),
    // Seed the email from the query (registration is email-only, #202); the field
    // is not user-editable here — they only type the code.
    defaultValues: { email, code: "" },
  });

  async function onSubmit(values: VerifyRequest) {
    setError(null);
    const identifier = email ?? "";
    try {
      await authClient.verify(values);
      // EARS-3 verify proved channel ownership but mints no session. Consume the
      // in-memory password handed over from `/register` (cleared atomically by
      // takePendingRegistration, on this success OR the catch below) and replay
      // the real EARS-5 password login so the user lands signed-in on /account.
      const held = takePendingRegistration(identifier);
      if (held) {
        await authClient.login({
          identifier: held.identifier,
          password: held.password,
        } as LoginRequest);
        // The BFF set the `__Host-` cookie (EARS-8); replace so verify is not in
        // the back-stack.
        router.replace("/account");
        return;
      }
      // No held credential (deep-link / reload / abandoned) — fall back to the
      // manual sign-in round-trip.
      router.push("/login");
    } catch (err) {
      // EARS-16: the verify/auth outcome stays generic; only 429/5xx/network
      // surface a specific message.
      setError(authErrorMessage(err, te, te("verifyFailed")));
    }
  }

  // Auto-submit when the fixed-length OTP completes. Guard against a double network
  // call if `onComplete` and a manual button click race, or if `onComplete`
  // re-fires: skip while a submit is already in flight.
  const submit = form.handleSubmit(onSubmit);
  const onComplete = useCallback(() => {
    if (form.formState.isSubmitting) return;
    void submit();
  }, [form.formState.isSubmitting, submit]);

  // #227 resend: re-issue the verification email with the HELD (non-consumed)
  // credential. The block owns the cooldown; this only fires the network call.
  async function onResend() {
    setError(null);
    const held = email ? peekPendingRegistration(email) : null;
    if (!held) {
      // No in-flight credential (hard reload / deep-link) — the email cannot be
      // re-issued without the password; the (b) existing-account section is the
      // path here.
      setError(te("otpSendFailed"));
      return;
    }
    try {
      await authClient.register({
        email: held.identifier,
        password: held.password,
        consent: REQUIRED_CONSENT.slice(),
      } as RegisterRequest);
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpSendFailed")));
    }
  }

  const sentTo = email ? maskDestination(email) : t("fallbackIdentifier");

  return (
    <AuthCard
      title={t("title")}
      description={t.rich("description", {
        identifier: email ?? t("fallbackIdentifier"),
        strong: (chunks) => <strong>{chunks}</strong>,
      })}
      icon={<MailCheck className="text-primary" aria-hidden />}
      contentClassName="space-y-8"
    >
      {/* (a) New-registrant path — the reusable OTP focus-screen (masked
          destination + resend/cooldown + auto-submit + post-verify auto-login). A
          co-equal affordance, not the only one. No channel to change, so the
          focus-screen omits change-method. */}
      <section aria-label={t("newAccountHeading")}>
        <Form {...form}>
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <OtpFocusScreen
                field={field}
                length={VERIFY_OTP_LENGTH}
                variant="slotted"
                title={t("newAccountHeading")}
                sentToLabel={ta("sentTo", { destination: sentTo })}
                codeLabel={t("codeLabel")}
                submitLabel={t("submit")}
                resendLabel={ta("resend")}
                resendCountdownLabel={(s) =>
                  ta("resendCountdown", { seconds: s })
                }
                cooldownSeconds={30}
                isSubmitting={form.formState.isSubmitting}
                onComplete={onComplete}
                onSubmit={submit}
                onResend={onResend}
                error={error}
                submitTestId="verify-submit"
                resendTestId="verify-resend"
              />
            )}
          />
        </Form>
      </section>

      {/* (b) Already-registered owner's path — prominent, co-equal sign-in / reset
          actions (NOT a footnote link). The screen never branches on account
          existence; the owner's path is also reinforced out-of-band by the EARS-23
          notice email. */}
      <section
        className="space-y-3 border-t pt-6"
        aria-label={t("existingAccountHeading")}
      >
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("existingAccountHeading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("existingAccountHint")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="secondary" className="flex-1">
            <Link href="/login" data-testid="verify-go-to-login">
              {t("goToSignIn")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/reset" data-testid="verify-go-to-reset">
              {t("goToReset")}
            </Link>
          </Button>
        </div>
      </section>
    </AuthCard>
  );
}
