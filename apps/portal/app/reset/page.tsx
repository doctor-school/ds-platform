"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import {
  PasswordResetRequestSchema,
  PasswordResetCompleteRequestSchema,
  type PasswordResetRequest,
  type PasswordResetCompleteRequest,
} from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@ds/design-system/input-otp";

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
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [stage, setStage] = useState<"request" | "complete">("request");
  const [identifier, setIdentifier] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestForm = useForm<PasswordResetRequest>({
    resolver: useLocalizedResolver(PasswordResetRequestSchema),
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
      completeForm.reset({ identifier: values.identifier, code: "", newPassword: "" });
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
                <FormField
                  control={requestForm.control}
                  name="identifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tc("emailOrPhone")}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="username"
                          placeholder={tc("identifierPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
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
                <FormField
                  control={completeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("codeLabel")}</FormLabel>
                      <FormControl>
                        <InputOTP
                          maxLength={6}
                          autoComplete="one-time-code"
                          value={field.value}
                          onChange={field.onChange}
                        >
                          <InputOTPGroup>
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                              <InputOTPSlot key={i} index={i} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={completeForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("newPasswordLabel")}</FormLabel>
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
