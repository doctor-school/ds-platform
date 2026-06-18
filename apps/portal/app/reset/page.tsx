"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import {
  type PasswordResetRequest,
  type PasswordResetCompleteRequest,
} from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { AuthShell } from "@/components/auth-shell";
import { IdentifierField, PasswordField } from "@ds/design-system/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import {
  ResetCompleteFormSchema,
  ResetIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Form, FormField } from "@ds/design-system/form";
import {
  AuthCard,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";

/** The reset code is a FIXED 6 characters (Zitadel default) — and ALPHANUMERIC
 * (e.g. `PVDC3R`), not digits-only — like the registration verify code. The slotted
 * `<OtpField>` inside `<OtpFocusScreen>` accepts letters (no digit-only filter). */
const RESET_OTP_LENGTH = 6;

/*
 * Password-reset surface (#131, EARS-11 initiate / EARS-12 complete; rebuilt on
 * `@ds/design-system` for #237). Two steps on one branded card: request a reset code
 * for an identifier (email or phone — Zitadel resolves it), then submit the code plus
 * a new policy-conforming password on the reusable `<OtpFocusScreen>` (masked
 * destination + resend/cooldown; the new-password field rides the focus-screen's
 * `children` slot, so the code and password submit together — no auto-submit here).
 * Both forms validate with the `@ds/schemas` SSOT and submit same-origin to
 * `/v1/auth/password/reset[...]`. Reset is an abuse-prone unauthenticated surface, so
 * the initiate step renders the bot-protection field (EARS-17). On completion the BFF
 * revokes every PRIOR session for the subject AND mints a fresh authenticated session
 * (auto-login, #221) — the response sets the `__Host-` session cookie — so we route
 * straight to `/account`.
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
  // z.string().min(1)` so Zitadel remains the credential authority). The submitted
  // body still matches the loose `@ds/schemas` contract.
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
      // render — no late-mounted/detached Controller (#212/#211).
      setIdentifier(values.identifier);
      setStage("complete");
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetRequestFailed")));
    }
  }

  return (
    <AuthShell>
      <AuthCard
        title={t("title")}
        description={stage === "request" ? t("descriptionRequest") : undefined}
        icon={<KeyRound className="text-primary" aria-hidden />}
        footer={
          <Link href="/login" className="underline">
            {t("backToSignIn")}
          </Link>
        }
      >
        {stage === "request" ? (
          <Form {...requestForm}>
            <form
              onSubmit={requestForm.handleSubmit(onRequest)}
              className="space-y-4"
              noValidate
            >
              {/* #196 fix: the reset identifier is the same union box as
                  login-password — `<IdentifierField>` bakes in the email-OR-phone
                  validation, so a bare numeric is rejected before submit. UNMASKED
                  (the default), matching the login-password box. */}
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
            captchaToken={captchaToken}
            onBack={() => setStage("request")}
          />
        )}
      </AuthCard>
    </AuthShell>
  );
}

/**
 * EARS-12 complete step — the reusable `<OtpFocusScreen>` (#227) carrying the
 * new-password field in its `children` slot, so the code and password submit
 * together (no auto-submit — `onComplete` is intentionally omitted). Its OWN
 * `useForm` lives here so the `code` Controller is registered on this component's
 * first render: it mounts only once the request step has fired, so there is no
 * late-mounted Controller (#212/#211). `identifier` comes in as a prop (the BFF
 * re-resolves it); the user types the code + the new password and submits both.
 */
function ResetCompleteForm({
  identifier,
  captchaToken,
  onBack,
}: {
  identifier: string;
  captchaToken: string | null;
  onBack: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("reset");
  const tc = useTranslations("common");
  const ta = useTranslations("auth");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);

  // #200: resolve the complete step from the portal `ResetCompleteFormSchema` (field
  // primitives), NOT `PasswordResetCompleteRequestSchema` — the request schema's
  // message-carrying `newPassword` outranks the localized error map in zod v4. The
  // submitted body still matches the loose `@ds/schemas` contract; the API enforces
  // the real policy.
  const completeForm = useForm<PasswordResetCompleteRequest>({
    mode: "onTouched",
    resolver: useLocalizedResolver(ResetCompleteFormSchema),
    defaultValues: { identifier, code: "", newPassword: "" },
  });

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

  // #227 resend: re-request the reset code for the same identifier. The block owns
  // the cooldown; this only fires the network call.
  async function onResend() {
    setError(null);
    try {
      await authClient.requestPasswordReset({
        identifier,
        ...(captchaToken ? { captchaToken } : {}),
      });
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetRequestFailed")));
    }
  }

  const submit = completeForm.handleSubmit(onComplete);

  return (
    <Form {...completeForm}>
      <FormField
        control={completeForm.control}
        name="code"
        render={({ field }) => (
          <OtpFocusScreen
            field={field}
            length={RESET_OTP_LENGTH}
            variant="slotted"
            title={t("completeTitle")}
            sentToLabel={ta("sentTo", {
              destination: maskDestination(identifier),
            })}
            codeLabel={t("codeLabel")}
            submitLabel={t("setNewPassword")}
            resendLabel={ta("resend")}
            resendCountdownLabel={(s) => ta("resendCountdown", { seconds: s })}
            changeMethodLabel={ta("changeMethod")}
            cooldownSeconds={30}
            isSubmitting={completeForm.formState.isSubmitting}
            onSubmit={submit}
            onResend={onResend}
            onChangeMethod={onBack}
            error={error}
            submitTestId="reset-complete-submit"
            resendTestId="reset-resend"
            changeMethodTestId="reset-change-method"
          >
            {/* New-password field — rides the focus-screen's children slot so it
                submits together with the code (#147 complexity baseline enforced by
                the API; the portal `ResetCompleteFormSchema` localizes the hint). */}
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
          </OtpFocusScreen>
        )}
      />
    </Form>
  );
}
