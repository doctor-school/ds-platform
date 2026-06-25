"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import {
  type PasswordResetRequest,
  type PasswordResetCompleteRequest,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { BotProtectionField } from "@/components/bot-protection";
import { IdentifierField, OtpField, PasswordField } from "@ds/design-system/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import {
  ResetCompleteFormSchema,
  ResetIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";
import {
  AuthCard,
  maskDestination,
  useResendCountdown,
} from "@ds/design-system/blocks";
import { Form, FormField } from "@ds/design-system/form";

/** The reset code is a FIXED 6 characters (Zitadel default) — and ALPHANUMERIC
 * (e.g. `PVDC3R`), not digits-only — like the registration verify code. `<OtpField>`
 * uses its slotted variant, which accepts letters (it carries no digit-only filter). */
const RESET_OTP_LENGTH = 6;

/**
 * Resend cooldown (#267) for the reset complete step. Bumping the nonce restarts the
 * shared `useResendCountdown` timer (the same one `<OtpFocusScreen>` runs on /login
 * & /verify) without a remount. The reset code-step submits the code TOGETHER with a
 * new password (a shape `<OtpFocusScreen>` doesn't carry), so it reuses the timer +
 * resend orchestration inline rather than adopting the whole block.
 */
const RESET_RESEND_COOLDOWN_SECONDS = 30;

/*
 * Password-reset surface (#131, EARS-11 initiate / EARS-12 complete). Two steps on
 * one page: request a reset code for an identifier (email or phone — Zitadel
 * resolves it), then submit the code plus a new policy-conforming password. Both
 * forms validate with the `@ds/schemas` SSOT (`PasswordResetRequestSchema` and
 * `PasswordResetCompleteRequestSchema`, the latter carrying the #147 creation
 * complexity baseline) and submit same-origin to `/v1/auth/password/reset[...]`.
 * Reset is an abuse-prone unauthenticated surface, so the initiate step renders
 * the bot-protection field (EARS-17). On completion the BFF revokes every PRIOR
 * session for the subject AND mints a fresh authenticated session (auto-login,
 * #221) — the response sets the `__Host-` session cookie — so we route straight
 * to `/account` rather than back to `/login`.
 */

export default function ResetPage() {
  const t = useTranslations("reset");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [stage, setStage] = useState<"request" | "complete">("request");
  const [identifier, setIdentifier] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // #196: validate the identifier with the union guard (email OR E.164 phone), NOT
  // the loose `PasswordResetRequestSchema` (which stays `identifier:
  // z.string().min(1)` so Zitadel remains the credential authority). Before #197
  // this form used the loose schema as its resolver, so a bare numeric string sailed
  // through unvalidated — the exact #196 defect. The submitted body still matches
  // the loose `@ds/schemas` contract.
  const requestForm = useForm<PasswordResetRequest>({
    // `onTouched` (#200): flag a malformed identifier on blur, before submit.
    mode: "onTouched",
    resolver: useLocalizedResolver(ResetIdentifierFormSchema),
    defaultValues: { identifier: "" },
  });

  async function onRequest(values: PasswordResetRequest) {
    setError(null);
    try {
      await authClient.requestPasswordReset({
        ...values,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // EARS-16: the ack is identical whether or not the identifier exists; we
      // always advance to the code step. Carry the identifier into completion — the
      // complete step is a SEPARATE component (<ResetCompleteForm/>) that mounts only
      // once `stage` flips, so its own useForm registers the `code` field on its first
      // render. We deliberately do NOT hold the complete form here and seed it with
      // reset()/setValue() after the request→complete toggle: because the `code`
      // Controller mounted AFTER that form was created, RHF never bound it and every
      // keystroke was dropped (the slotted field stayed "" — the #212/#211 bug that
      // survived on /reset only). Owning the complete form in a freshly-mounted child
      // is the same fix /login uses for its OTP verify step.
      setIdentifier(values.identifier);
      setStage("complete");
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetRequestFailed")));
    }
  }

  return (
    <AuthShell>
      <AuthCard
        icon={<KeyRound className="text-primary" aria-hidden />}
        title={t("title")}
        description={
          stage === "request"
            ? t("descriptionRequest")
            : // #227: confirm WHERE the reset code went with a privacy-masked
              // destination (the same `maskDestination` the login-OTP focus-screen
              // shows), never the full identifier.
              t("descriptionComplete", {
                identifier: maskDestination(identifier),
              })
        }
        footer={
          <DsLink asChild>
            <Link href="/login">{t("backToSignIn")}</Link>
          </DsLink>
        }
      >
        {stage === "request" ? (
          <Form {...requestForm}>
            <form
              onSubmit={requestForm.handleSubmit(onRequest)}
              className="space-y-5"
              noValidate
            >
              {/* #196 fix: the reset identifier is the same union box as
                  login-password — `<IdentifierField>` bakes in the email-OR-phone
                  validation, so a bare numeric is rejected before submit. UNMASKED
                  (the default), matching the login-password box — only the OTP-sms
                  channel masks. */}
              <FormField
                control={requestForm.control}
                name="identifier"
                render={({ field }) => (
                  <IdentifierField
                    field={field}
                    label={tc("emailOrPhone")}
                    placeholder={tc("identifierPlaceholder")}
                  />
                )}
              />
              <BotProtectionField onToken={setCaptchaToken} />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={requestForm.formState.isSubmitting}
                data-testid="reset-request-submit"
              >
                {t("sendResetCode")}
              </Button>
            </form>
          </Form>
        ) : (
          <ResetCompleteForm
            identifier={identifier}
            onRestart={() => {
              // «Начать заново»: return to the request stage so the user can change
              // the identifier (e.g. mistyped email/phone) and request a fresh code.
              setError(null);
              setCaptchaToken(null);
              setIdentifier("");
              requestForm.reset({ identifier: "" });
              setStage("request");
            }}
          />
        )}
      </AuthCard>
    </AuthShell>
  );
}

/**
 * EARS-12 complete step. Its OWN `useForm` lives here so the `code` Controller is
 * registered on this component's first render: the component mounts only once the
 * request step has fired, so there is no late-mounted Controller and no post-hoc
 * `reset()`/`setValue()` seeding of a parent-held form — both of which left the
 * slotted `code` field detached and dropped every keystroke on /reset (#212/#211,
 * the same class of failure /login's <OtpVerifyForm/> was restructured to avoid).
 * `identifier` comes in as a prop (the BFF re-resolves it); the user types the code
 * and the new password and submits both together.
 */
function ResetCompleteForm({
  identifier,
  onRestart,
}: {
  identifier: string;
  onRestart: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("reset");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  // The resend re-hits `POST /v1/auth/password/reset`, which is
  // `@BotProtected("password-reset")` (EARS-17) — so the resend needs its own
  // captcha token (the request step's token lives in the parent and is not
  // carried here). Renders nothing when no provider is configured (dev default).
  const [resendCaptchaToken, setResendCaptchaToken] = useState<string | null>(
    null,
  );

  // #200: resolve the complete step from the portal `ResetCompleteFormSchema` (field
  // primitives), NOT `PasswordResetCompleteRequestSchema`. The request schema's
  // `newPassword` is the message-carrying `NewPasswordSchema`, whose baked-in English
  // outranks the localized error map in zod v4 and leaked onto the field; the portal
  // schema's message-less `NewPasswordFieldSchema` renders the RU `passwordComplexity`
  // copy instead. The submitted body still matches the loose `@ds/schemas` contract;
  // the API enforces the real policy. Seeded with the resolved `identifier` at mount —
  // no post-toggle reset()/setValue() on a parent form (the #212/#211 detachment).
  const completeForm = useForm<PasswordResetCompleteRequest>({
    mode: "onTouched",
    resolver: useLocalizedResolver(ResetCompleteFormSchema),
    defaultValues: { identifier, code: "", newPassword: "" },
  });

  // #267 resend: re-request a reset code for the SAME held identifier via the
  // EXISTING `requestPasswordReset` (no new backend). EARS-16: the ack is identical
  // whether the identifier exists, so resend leaks nothing. Bumping the nonce
  // restarts the shared cooldown timer + clears the now-stale typed code.
  const { resendNonce, onResend } = useResendCooldown({
    resend: async () => {
      await authClient.requestPasswordReset({
        identifier,
        ...(resendCaptchaToken ? { captchaToken: resendCaptchaToken } : {}),
      });
    },
    onError: (err) =>
      setError(authErrorMessage(err, te, te("resetResendFailed"))),
    onBeforeResend: () => setError(null),
  });
  const remaining = useResendCountdown(RESET_RESEND_COOLDOWN_SECONDS, resendNonce);
  const resendDisabled = remaining > 0;

  // On a successful resend clear the superseded code (the new password is kept — the
  // user only needs the fresh code). Skips the initial mount.
  const isInitialResend = useRef(true);
  useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    completeForm.resetField("code");

  }, [resendNonce]);

  async function onComplete(values: PasswordResetCompleteRequest) {
    setError(null);
    try {
      await authClient.completePasswordReset({ ...values, identifier });
      // #221: the reset response auto-logged us in (the BFF set the __Host- session
      // cookie), so go straight to the authenticated area instead of /login.
      router.push("/account");
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetCompleteFailed")));
    }
  }

  return (
    <Form {...completeForm}>
      <form
        onSubmit={completeForm.handleSubmit(onComplete)}
        className="space-y-5"
        noValidate
      >
        {/* Slotted 6-char alphanumeric code (no auto-submit here — the complete step
            pairs the code with a new password, so the user submits both
            together; `onComplete` is intentionally omitted). */}
        <FormField
          control={completeForm.control}
          name="code"
          render={({ field }) => (
            <OtpField
              field={field}
              length={RESET_OTP_LENGTH}
              variant="slotted"
              label={t("codeLabel")}
            />
          )}
        />
        <FormField
          control={completeForm.control}
          name="newPassword"
          render={({ field }) => (
            <PasswordField
              field={field}
              purpose="new"
              label={t("newPasswordLabel")}
              policyHint={tc("passwordPolicy")}
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
          disabled={completeForm.formState.isSubmitting}
        >
          {t("setNewPassword")}
        </Button>
      </form>
      {/* #267: focus-polish footer — separated from the password field with a top
          border + spacing so «Начать заново» is no longer jammed against the input
          (owner finding). «Начать заново» (change the identifier, back to the
          request step) on the left, resend-with-cooldown (real
          `requestPasswordReset`) on the right; mirrors the focus-screen's
          change-method/resend pairing, kept inline because the reset step submits
          the code together with a new password. */}
      <div className="mt-6 space-y-3 border-t pt-4">
        {/* EARS-17 bot-protection for the resend (renders nothing when no provider
            is configured — the dev default). */}
        <BotProtectionField onToken={setResendCaptchaToken} />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRestart}
            data-testid="reset-restart"
          >
            {t("startOver")}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={resendDisabled}
            onClick={() => void onResend()}
            data-testid="reset-resend"
            // `tabular-nums` — fixed-width digits so the countdown does not jitter
            // (#227/#267 owner finding).
            className="tabular-nums"
          >
            {resendDisabled
              ? t("resendIn", { seconds: remaining })
              : t("resend")}
          </Button>
        </div>
      </div>
    </Form>
  );
}
