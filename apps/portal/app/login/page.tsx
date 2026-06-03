"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";

import { BotProtectionField } from "@/components/bot-protection";

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
 * Sign-in SCAFFOLD. It wires the ADR-0004 §9 form stack end to end — RHF +
 * `@hookform/resolvers/zod` + the shadcn `<Form>` set + `<InputOTP>` — so #82
 * proves the portal builds against the design system. It does NOT talk to the
 * BFF: the real schema moves to the `@ds/schemas` SSOT and `onSubmit` calls the
 * `/v1/auth/*` endpoints in feature 003 (F2 #86 password, F3 #87 OTP).
 */
const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function LoginPage() {
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  // SmartCaptcha solve token (#84). F2 (#86) sends it to the guarded BFF
  // endpoint as the `x-smartcaptcha-token` header; the backend
  // `BotProtectionGuard` verifies it.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  function onSubmit(values: SignInValues) {
    // Wired to the BFF in 003 F2 (#86). Scaffold only — no network call yet.
    console.log("sign-in scaffold submit", values.email, {
      captcha: captchaToken !== null,
    });
  }

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
        <CardContent>
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
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="doctor@example.com"
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
              {/*
                Bot-protection MECHANISM bootstrapped by #84. EARS-17 POLICY
                (show on registration / reset, and on login only after a failed
                attempt) is wired in 003 F6 (#90); here it renders unconditionally
                so the scaffold proves the widget→token→guard path end to end.
              */}
              <BotProtectionField onToken={setCaptchaToken} />
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex-col items-start gap-2">
          <CardDescription>
            Or enter the one-time code we sent you (email-OTP / SMS-OTP):
          </CardDescription>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </CardFooter>
      </Card>
    </main>
  );
}
