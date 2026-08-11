"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminEnrollmentOffer } from "@ds/schemas";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  OtpField,
} from "@ds/design-system";
import { Form, FormField } from "@ds/design-system/form";
import { QrCode } from "@/components/qr-code";
import { startMfaEnrollment, verifyMfaEnrollment } from "@/lib/admin-auth";

/** The TOTP code length the provisioning URI this screen renders declares (`digits=6`). */
const CODE_LENGTH = 6;

interface CodeForm {
  code: string;
}

/**
 * 011 EARS-4/EARS-5 — the forced TOTP-enrollment screen.
 *
 * A `platform_admin` who has completed primary auth with no registered factor
 * lands here and can go nowhere else: the API refuses every other admin route for
 * the `mfa_pending_enrollment` state, so this screen is not a navigational
 * convention that a typed URL could sidestep — it is the only door the server
 * leaves open. This is also the bootstrap path for the admins who exist today
 * (PD-1): no cutover mailing, no support ticket, no IdP console step.
 *
 * **Stage-A layout (owner-approved 2026-08-07, recorded on #718):** one card,
 * three stacked steps — scan the QR, or transcribe the secret beside it, then
 * enter the code. The secret is selectable monospace text, never image-only, and
 * the QR carries an RU text alternative: some authenticator apps cannot scan and
 * a screen-reader user cannot scan at all, so an image-only offer would lock
 * those operators out of a control they are not allowed to skip (EARS-12).
 *
 * The offer is fetched **once per mount** and is not re-servable: a reload
 * registers a NEW provisional factor with a new secret, so an operator who lost
 * the screen gets a fresh factor rather than a second look at the old one. Copy
 * resolves from the RU catalog; every refusal renders one message, because the
 * API answers every refusal identically (EARS-7) and a client-side taxonomy would
 * leak exactly what the server refused to disclose.
 */
export default function MfaEnrollPage() {
  const t = useTranslations("mfaEnroll");
  const router = useRouter();
  const [offer, setOffer] = useState<AdminEnrollmentOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<CodeForm>({ defaultValues: { code: "" } });
  const code = form.watch("code");

  useEffect(() => {
    let cancelled = false;
    void startMfaEnrollment().then((result) => {
      if (cancelled) return;
      setLoading(false);
      // Not a pending-enrollment principal (no pending reference, an expired one,
      // or one owing a different step): send them to the login form rather than
      // render an empty card that suggests the flow is broken.
      if (!result.ok) {
        router.replace("/login");
        return;
      }
      setOffer(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const submit = useCallback(
    async ({ code }: CodeForm) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      const result = await verifyMfaEnrollment(code);
      setSubmitting(false);
      if (!result.ok) {
        // The API answers every refusal identically (EARS-7) except the ADR-0001
        // §7 rate limit, which is about the operator's own attempt rate rather
        // than the account — telling them to wait beats telling them a correct
        // code is wrong.
        setError(result.throttled ? t("errorThrottled") : t("errorGeneric"));
        // Clear + refocus so the next code goes straight in. The CTA disables
        // itself while the field is short of six digits (see the button below),
        // so the operator is never left clicking a control that cannot act —
        // the #1191 Stage-B finding: an enabled submit over an EMPTY code field
        // reads as a broken button, because the six-digit constraint would
        // reject it before any verification path ran.
        form.setValue("code", "");
        form.setFocus("code");
        return;
      }
      // LD-1: the verify response carried `__Host-ds_admin_session` — the login is
      // complete in place, so this is a navigation, not a second sign-in.
      router.replace("/events");
    },
    [form, router, submitting, t],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : null}

          {offer ? (
            <>
              <section className="flex flex-col gap-3" aria-labelledby="mfa-scan">
                <h2
                  id="mfa-scan"
                  className="text-sm font-medium text-primary-action"
                >
                  {t("scanTitle")}
                </h2>
                <QrCode
                  value={offer.provisioningUri}
                  label={t("qrAlt", { issuer: offer.issuer })}
                  className="h-48 w-48 self-center rounded-md border border-border"
                  data-testid="mfa-qr"
                />
              </section>

              <section
                className="flex flex-col gap-2"
                aria-labelledby="mfa-secret"
              >
                <h2
                  id="mfa-secret"
                  className="text-sm font-medium text-primary-action"
                >
                  {t("secretTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("secretHint")}
                </p>
                {/* Selectable text, not an image: the operator whose app cannot
                    scan types this, and a screen reader reads it out. */}
                <code
                  className="select-all break-all rounded-md bg-muted px-3 py-2 font-mono text-sm text-primary-action"
                  data-testid="mfa-secret"
                >
                  {offer.secret}
                </code>
              </section>

              <Form {...form}>
                <form
                  className="flex flex-col gap-4"
                  data-testid="mfa-enroll-form"
                  noValidate
                  onSubmit={form.handleSubmit(submit)}
                >
                  {error ? (
                    <Alert variant="danger" data-testid="mfa-error">
                      {error}
                    </Alert>
                  ) : null}
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <OtpField
                        field={field}
                        length={CODE_LENGTH}
                        label={t("codeLabel")}
                        variant="slotted"
                        charset="numeric"
                        onComplete={() => void form.handleSubmit(submit)()}
                      />
                    )}
                  />
                  <Button
                    type="submit"
                    loading={submitting}
                    disabled={code.length !== CODE_LENGTH}
                    data-testid="mfa-submit"
                  >
                    {t("submit")}
                  </Button>
                </form>
              </Form>

              <p className="text-sm text-muted-foreground">{t("lostFactor")}</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
