"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";

import { VerifyRequestSchema, type VerifyRequest } from "@ds/schemas";

import { authClient } from "@/lib/auth-client";

import { Button } from "@ds/design-system/button";
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
 * Verification surface (#131, EARS-3 email / EARS-4 phone). Step 2 of register:
 * the registrant lands here from `/register` with their identifier in the query
 * and submits the OTP code Zitadel sent. Validates with `VerifyRequestSchema`
 * (the same exactly-one-identifier refine), submits same-origin to
 * `/v1/auth/verify`, and on `verified` routes to `/login` to sign in.
 *
 * `useSearchParams` requires a Suspense boundary in the App Router, so the form
 * is split out and wrapped below.
 */

export default function VerifyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Suspense fallback={null}>
        <VerifyCard />
      </Suspense>
    </main>
  );
}

function VerifyCard() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? undefined;
  const phone = params.get("phone") ?? undefined;
  const [error, setError] = useState<string | null>(null);

  const form = useForm<VerifyRequest>({
    resolver: zodResolver(VerifyRequestSchema),
    // Seed exactly one identifier from the query (the channel the user registered
    // with); the field is not user-editable here — they only type the code.
    defaultValues: email ? { email, code: "" } : { phone, code: "" },
  });

  async function onSubmit(values: VerifyRequest) {
    setError(null);
    try {
      await authClient.verify(values);
      router.push("/login");
    } catch {
      setError("That code did not work. Please try again.");
    }
  }

  const identifierLabel = email ?? phone ?? "your account";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MailCheck className="text-primary" aria-hidden />
          <CardTitle>Confirm your account</CardTitle>
        </div>
        <CardDescription>
          Enter the code we sent to <strong>{identifierLabel}</strong>.
        </CardDescription>
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
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Verification code</FormLabel>
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
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              Confirm
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-sm">
        <Link href="/login" className="underline">
          Back to sign-in
        </Link>
      </CardFooter>
    </Card>
  );
}
