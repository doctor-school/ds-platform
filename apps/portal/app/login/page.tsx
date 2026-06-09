"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";

import {
  LoginRequestSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  type LoginRequest,
  type OtpChannel,
  type OtpRequest,
  type OtpVerify,
} from "@ds/schemas";

import { BotProtectionField } from "@/components/bot-protection";
import { authClient } from "@/lib/auth-client";

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
 * Sign-in surface (#131). Wires the live BFF (003 F2 password / F3 OTP) into the
 * portal: forms validate with the `@ds/schemas` SSOT (NO re-declared zod), submit
 * same-origin to `/v1/auth/*` via {@link authClient}, and on success the BFF sets
 * the `__Host-ds_session` cookie and we route to the session-aware `/account`
 * landing. No token ever touches this client (EARS-8). Two journeys live here:
 *   • Password login (EARS-5): single `identifier` box (email OR phone) — Zitadel
 *     resolves it — plus password. Matches {@link LoginRequestSchema}, which is
 *     why this is NOT an `email` field (the old scaffold was wrong).
 *   • Passwordless OTP login (EARS-6 email / EARS-7 SMS): request a code for an
 *     identifier+channel, then submit the 6-digit code. SMS has no dev-stand
 *     provider, but the UI is built for both channels.
 */

const GENERIC_FAILURE = "Sign-in failed. Check your details and try again.";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary" aria-hidden />
            <CardTitle>Sign in</CardTitle>
          </div>
          <CardDescription>Access your Doctor.School account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <PasswordLogin />
          <div className="border-t pt-6">
            <OtpLogin />
          </div>
        </CardContent>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <Link href="/register" className="underline">
            Create an account
          </Link>
          <Link href="/reset" className="underline">
            Forgot your password?
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}

/** EARS-5 password login. */
function PasswordLogin() {
  const router = useRouter();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: LoginRequest) {
    setError(null);
    try {
      await authClient.login({
        ...values,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // The BFF set the `__Host-` cookie; the session shell reads it server-side.
      router.push("/account");
    } catch {
      // EARS-16: ALL login failures — typed AuthError responses AND untyped
      // network/programming errors alike — deliberately collapse to one generic
      // message, so the UI never leaks an existence/error oracle.
      setError(GENERIC_FAILURE);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
        aria-label="Password sign-in"
      >
        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email or phone</FormLabel>
              <FormControl>
                <Input
                  autoComplete="username"
                  placeholder="doctor@example.com or +7…"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Bot-protection mechanism (#84); the EARS-17 after-N-failures policy is
            F6/#90, so here it renders unconditionally (harmless — the guard no-ops
            without a configured provider). Its token rides as `captchaToken`. */}
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
        >
          Sign in
        </Button>
      </form>
    </Form>
  );
}

/** EARS-6/7 passwordless OTP login: request a code, then submit it. */
function OtpLogin() {
  const router = useRouter();
  const [channel, setChannel] = useState<OtpChannel>("email");
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestForm = useForm<OtpRequest>({
    resolver: zodResolver(OtpRequestSchema),
    defaultValues: { identifier: "", channel: "email" },
  });
  const verifyForm = useForm<OtpVerify>({
    resolver: zodResolver(OtpVerifySchema),
    defaultValues: { identifier: "", code: "", channel: "email" },
  });

  async function onRequest(values: OtpRequest) {
    setError(null);
    try {
      await authClient.requestOtp({
        ...values,
        channel,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // Carry identifier+channel into the verify step (the BFF re-resolves them).
      verifyForm.reset({ identifier: values.identifier, code: "", channel });
      setSent(true);
    } catch {
      setError("Could not send the code. Try again.");
    }
  }

  async function onVerify(values: OtpVerify) {
    setError(null);
    try {
      await authClient.loginWithOtp({ ...values, channel });
      router.push("/account");
    } catch {
      setError("That code did not work. Request a new one.");
    }
  }

  return (
    <div className="space-y-4" aria-label="One-time-code sign-in">
      <div className="space-y-1">
        <p className="text-sm font-medium">Sign in with a one-time code</p>
        <p className="text-xs text-muted-foreground">
          We send a code to your email or phone (email-OTP / SMS-OTP).
        </p>
      </div>

      {/* Channel selector — drives EARS-6 (email) vs EARS-7 (sms). */}
      <div className="flex gap-2" role="radiogroup" aria-label="OTP channel">
        {(["email", "sms"] as const).map((c) => (
          <Button
            key={c}
            type="button"
            variant={channel === c ? "default" : "outline"}
            size="sm"
            role="radio"
            aria-checked={channel === c}
            onClick={() => {
              setChannel(c);
              setSent(false);
            }}
          >
            {c === "email" ? "Email code" : "SMS code"}
          </Button>
        ))}
      </div>

      {!sent ? (
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
                  <FormLabel>
                    {channel === "email" ? "Email" : "Phone"}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete={channel === "email" ? "email" : "tel"}
                      placeholder={
                        channel === "email" ? "doctor@example.com" : "+7…"
                      }
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
              variant="secondary"
              className="w-full"
              disabled={requestForm.formState.isSubmitting}
            >
              Send code
            </Button>
          </form>
        </Form>
      ) : (
        <Form {...verifyForm}>
          <form
            onSubmit={verifyForm.handleSubmit(onVerify)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={verifyForm.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Enter the 6-digit code</FormLabel>
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
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                disabled={verifyForm.formState.isSubmitting}
              >
                Verify &amp; sign in
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSent(false)}
              >
                Back
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}
