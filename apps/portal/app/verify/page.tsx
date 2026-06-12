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
  type VerifyRequest,
} from "@ds/schemas";

import { OtpField } from "@/components/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { takePendingRegistration } from "@/lib/pending-registration";
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

/** The registration verification code is a FIXED 6 digits (Zitadel default),
 * shorter than the 8-digit login OTP — so `<OtpField>` uses its slotted variant. */
const VERIFY_OTP_LENGTH = 6;

/*
 * Verification surface (#131, EARS-3 email / EARS-4 phone). Step 2 of register:
 * the registrant lands here from `/register` with their identifier in the query
 * and submits the OTP code Zitadel sent. Validates with `VerifyRequestSchema`
 * (the same exactly-one-identifier refine), submits same-origin to
 * `/v1/auth/verify`.
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
 * Auto-submit (#175): the registration code is a FIXED 6 digits, so the
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Suspense fallback={null}>
        <VerifyCard />
      </Suspense>
    </main>
  );
}

function VerifyCard() {
  const router = useRouter();
  const t = useTranslations("verify");
  const te = useTranslations("errors");
  const params = useSearchParams();
  const email = params.get("email") ?? undefined;
  const phone = params.get("phone") ?? undefined;
  const [error, setError] = useState<string | null>(null);

  const form = useForm<VerifyRequest>({
    resolver: useLocalizedResolver(VerifyRequestSchema),
    // Seed exactly one identifier from the query (the channel the user registered
    // with); the field is not user-editable here — they only type the code.
    defaultValues: email ? { email, code: "" } : { phone, code: "" },
  });

  async function onSubmit(values: VerifyRequest) {
    setError(null);
    const identifier = email ?? phone ?? "";
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

  const identifierLabel = email ?? phone ?? t("fallbackIdentifier");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MailCheck className="text-primary" aria-hidden />
          <CardTitle>{t("title")}</CardTitle>
        </div>
        <CardDescription>
          {t.rich("description", {
            identifier: identifierLabel,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
      <CardFooter className="text-sm">
        <Link href="/login" className="underline">
          {t("backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
