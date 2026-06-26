"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";

import {
  VerifyRequestSchema,
  type LoginRequest,
  type VerifyRequest,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { BotProtectionField } from "@/components/bot-protection";
import { OtpField } from "@ds/design-system/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { takePendingRegistration } from "@/lib/pending-registration";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

import { Button } from "@ds/design-system/button";
import {
  AuthCard,
  maskDestination,
  useResendCountdown,
} from "@ds/design-system/blocks";
import { Form, FormField } from "@ds/design-system/form";

/** The registration verification code is a FIXED 6 characters (Zitadel default) —
 * and ALPHANUMERIC (the email code is not digits-only). `<OtpField>` uses its slotted
 * variant, which accepts letters (no digit-only filter); #211 also moved the 8-char
 * login OTP onto the same slotted look. */
const VERIFY_OTP_LENGTH = 6;

/**
 * Resend cooldown (#227/#267). Bumping the nonce restarts the live countdown (the
 * same `useResendCountdown` timer the `<OtpFocusScreen>` block uses) without a
 * remount, and clears the now-stale typed code — matching the proven `/login` pattern.
 */
const VERIFY_RESEND_COOLDOWN_SECONDS = 30;

/*
 * Post-registration surface (#131, EARS-3; reframed #207, EARS-24). The BFF
 * returns the IDENTICAL `pending_verification` for a brand-new and an
 * already-registered email (EARS-16), so this screen CANNOT know which visitor
 * it is showing — and must NEVER branch on account existence. It is therefore
 * framed as a single, existence-agnostic "check your email" view with two
 * co-equal affordances:
 *   (a) enter the email code  — the new registrant's path (unchanged auto-submit
 *       + post-verify auto-login, #175/#194);
 *   (b) Войти / Сбросить пароль — prominent actions for the already-registered
 *       owner, whose correct path is ALSO delivered privately by the EARS-23
 *       account-exists notice email.
 * The per-case routing happens in the inbox or by the user's own choice, never by
 * the form disclosing existence. All copy is from the EARS-21 message catalog.
 *
 * Registration verification is email-only (#202 — registration is email-primary).
 * Validates with `VerifyRequestSchema`, submits same-origin to `/v1/auth/verify`.
 *
 * Auto-login on success (#175): the verify API proves channel ownership (EARS-3)
 * but mints NO session. To carry the freshly-registered user straight in without
 * re-typing credentials, `/register` stashed the entered password in a volatile
 * in-memory store (never the URL / any persisted store — see
 * `lib/pending-registration.ts`). On a successful verify we read it back and
 * replay the REAL EARS-5 password login (`POST /v1/auth/login` → EARS-8 cookie),
 * then land on `/account`. The session therefore still comes from the password
 * login, NOT from `/auth/verify` — the API contract is unchanged. If no held
 * password is present (deep-link / reload / abandoned flow) we fall back to the
 * old behavior and route to `/login` for a manual sign-in.
 *
 * Auto-submit (#175): the registration code is a FIXED 6 characters, so the
 * design-system `InputOTP`'s native `onComplete` fires the submit the moment the
 * last digit lands — no manual click needed. The explicit button stays for
 * a11y/fallback, and an in-flight guard (`isSubmitting`) prevents a double-submit
 * if `onComplete` and a manual click race.
 *
 * `useSearchParams` requires a Suspense boundary in the App Router, so the form
 * is split out and wrapped below.
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
  const te = useTranslations("errors");
  const params = useSearchParams();
  const email = params.get("email") ?? undefined;
  const [error, setError] = useState<string | null>(null);
  // #326: neutral, enumeration-safe resend acknowledgement. The on-screen response
  // to a resend is generic and IDENTICAL in every case (registered / unregistered /
  // already-verified) — the "account exists" fact is disclosed out-of-band by email,
  // never on-screen (OWASP Authentication Cheat Sheet + WSTG "Testing for Account
  // Enumeration"; Clerk user-enumeration-protection). It is purely UI: a resend sends
  // no additional notice email (the register-time EARS-23 notice already covered the
  // owner; re-notifying per resend is noise + abuse-amplification). This also fixes
  // the "dead button" — the resend re-armed the cooldown but acknowledged nothing.
  const [notice, setNotice] = useState<string | null>(null);
  // Resend is an abuse-prone unauthenticated surface (EARS-17), so the EARS-25
  // endpoint is `@BotProtected("verify-resend")`. The widget token rides as
  // `captchaToken`; when no provider is configured (the dev default)
  // `<BotProtectionField>` renders nothing and the guard short-circuits to ok.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const form = useForm<VerifyRequest>({
    resolver: useLocalizedResolver(VerifyRequestSchema),
    // Seed the email from the query (registration is email-only, #202); the field
    // is not user-editable here — they only type the code.
    defaultValues: { email, code: "" },
  });

  // Privacy-masked destination (#227): the screen confirms WHERE the code went
  // without re-printing the full address (`a•••@p•••.com`); reuses the same
  // `maskDestination` helper the login-OTP focus-screen displays. Computed here so
  // both the card description and the #326 resend confirmation can interpolate it.
  const identifierLabel = email ? maskDestination(email) : t("fallbackIdentifier");

  // #267 resend: re-issue the registration code via the dedicated EARS-25 endpoint
  // (`/v1/auth/verify/resend`, #319) — NOT a re-`register` (no held password here).
  // The identifier is the seeded email; if it is absent (deep-link without `?email=`)
  // resend has nothing to target, so the control is hidden. EARS-16: the ack is
  // existence-agnostic, so resend never reveals whether the account exists.
  const { resendNonce, onResend } = useResendCooldown({
    resend: async () => {
      await authClient.resendVerification({
        identifier: email ?? "",
        ...(captchaToken ? { captchaToken } : {}),
      });
    },
    onError: (err) =>
      setError(authErrorMessage(err, te, te("verifyResendFailed"))),
    // Clear BOTH channels before a fresh attempt: a prior error or a stale
    // confirmation must not linger across the next resend (#326).
    onBeforeResend: () => {
      setError(null);
      setNotice(null);
    },
    // #326: neutral confirmation, conditionally phrased so it asserts nothing about
    // account existence (identical for every visitor — see the `notice` comment above).
    onSuccess: () => setNotice(t("resendAcknowledged", { identifier: identifierLabel })),
  });
  // The block's countdown lives inside <OtpFocusScreen>; the /verify code section
  // keeps its existing dual-affordance layout (NOT the single-focus block, per
  // EARS-24), so it runs the SAME shared timer inline for its own resend control.
  const remaining = useResendCountdown(VERIFY_RESEND_COOLDOWN_SECONDS, resendNonce);
  const resendDisabled = remaining > 0;

  // On a successful resend (nonce bump) clear the now-superseded typed code, so the
  // user re-enters the fresh code — same explicit reset /login's verify step uses.
  const isInitialResend = useRef(true);
  useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    form.resetField("code");
    // Keyed only on the resend signal — `form` is a stable useForm handle.

  }, [resendNonce]);

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
        // EARS-5 login takes a single `identifier` box (email OR phone — Zitadel
        // resolves it), so the same shape replays for both channels.
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
      // If verify itself failed the store was never read (the user retries the
      // code, still auto-logs-in on success). If the login REPLAY failed, the
      // store is already wiped by takePendingRegistration — the password is gone
      // and the user signs in manually at /login. EARS-16: the verify/auth
      // outcome stays generic; only 429/5xx/network surface a specific message.
      setError(authErrorMessage(err, te, te("verifyFailed")));
    }
  }

  // Auto-submit when the fixed-length OTP completes. Guard against a double
  // network call if `onComplete` and a manual button click race, or if
  // `onComplete` re-fires: skip while a submit is already in flight.
  const submit = form.handleSubmit(onSubmit);
  const onComplete = useCallback(() => {
    if (form.formState.isSubmitting) return;
    void submit();
  }, [form.formState.isSubmitting, submit]);

  return (
    <AuthCard
      icon={<MailCheck className="text-primary" aria-hidden />}
      title={t("title")}
      description={t.rich("description", {
        identifier: identifierLabel,
        strong: (chunks) => <strong>{chunks}</strong>,
      })}
      contentClassName="space-y-6"
    >
        {/* (a) New-registrant path — enter the email code (unchanged auto-submit
            + post-verify auto-login). A co-equal affordance, not the only one. */}
        <section className="space-y-3" aria-label={t("newAccountHeading")}>
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("newAccountHeading")}
          </h2>
          <Form {...form}>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <OtpField
                    field={field}
                    length={VERIFY_OTP_LENGTH}
                    variant="slotted"
                    label={t("codeLabel")}
                    onComplete={onComplete}
                  />
                )}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
                data-testid="verify-submit"
              >
                {t("submit")}
              </Button>
            </form>
          </Form>
          {/* #267 resend-with-cooldown, wired to the real EARS-25 endpoint. Only
              meaningful when an email destination is known (it is seeded from the
              `?email=` the register step passes); on a bare deep-link there is
              nothing to resend to, so the control is hidden rather than firing an
              empty request. The countdown reuses the SAME timer the focus-screen
              block runs. */}
          {email ? (
            <div className="space-y-2">
              {/* EARS-17 bot-protection for the resend (renders nothing when no
                  provider is configured — the dev default). */}
              <BotProtectionField onToken={setCaptchaToken} />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={resendDisabled}
                  onClick={() => void onResend()}
                  data-testid="verify-resend"
                  // `tabular-nums` — fixed-width digits so the countdown label does
                  // not jitter as the seconds tick down (#227/#267 owner finding).
                  className="tabular-nums"
                >
                  {resendDisabled
                    ? t("resendIn", { seconds: remaining })
                    : t("resend")}
                </Button>
              </div>
              {/* #326: neutral, enumeration-safe confirmation — NOT destructive (it is
                  a success ack, not an error). Identical copy in every case; the
                  account-exists fact is disclosed out-of-band by email, never here. */}
              {notice && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-muted-foreground"
                  data-testid="verify-resend-notice"
                >
                  {notice}
                </p>
              )}
            </div>
          ) : null}
        </section>

        {/* (b) Already-registered owner's path — prominent, co-equal sign-in /
            reset actions (NOT a footnote link). The screen never branches on
            account existence; the owner's path is also reinforced out-of-band by
            the EARS-23 notice email. */}
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
