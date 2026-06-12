"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import {
  PasswordResetCompleteRequestSchema,
  type PasswordResetRequest,
  type PasswordResetCompleteRequest,
} from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { IdentifierField, OtpField, PasswordField } from "@/components/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { ResetIdentifierFormSchema } from "@/lib/identifier-validation";
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

/** The reset code is a FIXED 6 digits (Zitadel default), like the registration
 * verify code — `<OtpField>` uses its slotted variant. */
const RESET_OTP_LENGTH = 6;

/*
 * Password-reset surface (#131, EARS-11 initiate / EARS-12 complete). Two steps on
 * one page: request a reset code for an identifier (email or phone — Zitadel
 * resolves it), then submit the code plus a new policy-conforming password. Both
 * forms validate with the `@ds/schemas` SSOT (`PasswordResetRequestSchema` and
 * `PasswordResetCompleteRequestSchema`, the latter carrying the #147 creation
 * complexity baseline) and submit same-origin to `/v1/auth/password/reset[...]`.
 * Reset is an abuse-prone unauthenticated surface, so the initiate step renders
 * the bot-protection field (EARS-17). On completion the BFF revokes every existing
 * session for the subject; we route to `/login` to sign in fresh.
 */

export default function ResetPage() {
  const router = useRouter();
  const t = useTranslations("reset");
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
    resolver: useLocalizedResolver(ResetIdentifierFormSchema),
    defaultValues: { identifier: "" },
  });
  const completeForm = useForm<PasswordResetCompleteRequest>({
    resolver: useLocalizedResolver(PasswordResetCompleteRequestSchema),
    defaultValues: { identifier: "", code: "", newPassword: "" },
  });

  async function onRequest(values: PasswordResetRequest) {
    setError(null);
    try {
      await authClient.requestPasswordReset({
        ...values,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // EARS-16: the ack is identical whether or not the identifier exists; we
      // always advance to the code step. Carry the identifier into completion.
      setIdentifier(values.identifier);
      completeForm.reset({
        identifier: values.identifier,
        code: "",
        newPassword: "",
      });
      setStage("complete");
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetRequestFailed")));
    }
  }

  async function onComplete(values: PasswordResetCompleteRequest) {
    setError(null);
    try {
      await authClient.completePasswordReset(values);
      router.push("/login");
    } catch (err) {
      setError(authErrorMessage(err, te, te("resetCompleteFailed")));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="text-primary" aria-hidden />
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>
            {stage === "request"
              ? t("descriptionRequest")
              : t("descriptionComplete", { identifier })}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    (the default), matching the login-password box — only the OTP-sms
                    channel masks. */}
                <FormField
                  control={requestForm.control}
                  name="identifier"
                  render={({ field }) => <IdentifierField field={field} />}
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
            <Form {...completeForm}>
              <form
                onSubmit={completeForm.handleSubmit(onComplete)}
                className="space-y-4"
                noValidate
              >
                {/* Slotted 6-digit code (no auto-submit here — the complete step
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
            </Form>
          )}
        </CardContent>
        <CardFooter className="text-sm">
          <Link href="/login" className="underline">
            {t("backToSignIn")}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
