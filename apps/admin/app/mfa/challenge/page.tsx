"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { readAdminAuthState, verifyMfaChallenge } from "@/lib/admin-auth";
import {
  mfaFailurePresentation,
  type MfaFailurePresentation,
} from "@/lib/mfa-failure";

/** The TOTP code length the provisioning URI this tier emits declares (`digits=6`). */
const CODE_LENGTH = 6;

interface CodeForm {
  code: string;
}

/**
 * 011 EARS-6/EARS-12 — the TOTP challenge screen: every admin login after the
 * one-time enrollment.
 *
 * The operator arrives here holding a pending authentication and nothing else.
 * No admin surface and no admin API route is reachable until a correct,
 * unexpired, not-previously-used code is accepted — and that is enforced by the
 * API, not by this screen: typing an admin URL gets the same refusal (design §5).
 * So this is the only door the server leaves open, rather than a navigational
 * convention.
 *
 * **Every refusal renders one message.** A wrong code, an expired window, a
 * replayed code, a stale pending reference, and a soft-locked account are one
 * uniform 401 at the API (EARS-7); a client-side taxonomy would leak precisely
 * what the server spent a clause refusing to disclose. The exceptions are the two
 * answers that describe the SERVICE rather than the account — the ADR-0001 §7 rate
 * limit (429) and an IdP outage (503, #1213) — and neither can leak account state
 * because neither depends on it. Which alert each renders is decided once, for both
 * MFA screens, by `mfaFailurePresentation`.
 *
 * The recovery guidance (LD-2 — the Tech Lead removes the factor, the next login
 * re-enters enrollment) is on the screen permanently, not surfaced after failure:
 * an operator whose phone is lost or wiped needs it before they have burned ten
 * attempts finding out.
 */
export default function MfaChallengePage() {
  const t = useTranslations("mfaChallenge");
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [failure, setFailure] = useState<MfaFailurePresentation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<CodeForm>({ defaultValues: { code: "" } });
  const code = form.watch("code");

  useEffect(() => {
    let cancelled = false;
    void readAdminAuthState().then((state) => {
      if (cancelled) return;
      // Not a pending-challenge principal: an already-active session belongs in
      // admin, a pending ENROLLMENT belongs on the enrollment screen, and anything
      // else belongs at the login form. Rendering a code field to any of them
      // would offer a control that cannot succeed.
      if (state === "mfa_pending_challenge") {
        setChecking(false);
        return;
      }
      router.replace(
        state === "active"
          ? "/events"
          : state === "mfa_pending_enrollment"
            ? "/mfa/enroll"
            : "/login",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const submit = useCallback(
    async ({ code: submitted }: CodeForm) => {
      if (submitting) return;
      setSubmitting(true);
      setFailure(null);
      const result = await verifyMfaChallenge(submitted);
      setSubmitting(false);
      if (!result.ok) {
        setFailure(mfaFailurePresentation(result));
        // A CHECKED code that failed is spent: clear + refocus so the next one
        // goes straight in. An outage code was never checked, so it is kept —
        // that is what "submit stays active" means here (Stage-A, #1213): a
        // service back within the code's 30-second window is one click away, and
        // wiping the field would impose a re-type the failure did not earn. The
        // CTA disables itself while the field is short of six digits (see the
        // button below), so the operator is never left clicking a dead control.
        if (!result.outage) {
          form.setValue("code", "");
          form.setFocus("code");
        }
        return;
      }
      // LD-1: the verify response carried `__Host-ds_admin_session` — the login
      // is complete in place, so this is a navigation, not a second sign-in.
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
          {checking ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <>
              <Form {...form}>
                <form
                  className="flex flex-col gap-4"
                  data-testid="mfa-challenge-form"
                  noValidate
                  onSubmit={form.handleSubmit(submit)}
                >
                  {failure ? (
                    <Alert
                      variant={failure.variant}
                      data-testid={failure.testId}
                    >
                      {t(failure.messageKey)}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
