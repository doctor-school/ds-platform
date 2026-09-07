"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";

import { AuthShell } from "@/components/auth-shell";
import {
  botProtectionMessages,
  botProtectionSiteKey,
} from "@/lib/bot-protection";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { REQUIRED_CONSENT } from "@/lib/consent";
import { withReturnTarget } from "@/lib/registration-handoff";
import { registerCardFormSchema } from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Link as DsLink } from "@ds/design-system/link";
import {
  botProtectionFailureMessage,
  BotProtectionField,
  clearPendingRegistration,
  isBotProtectionRejected,
  isBotProtectionRequired,
  RegisterCard,
  setPendingRegistration,
  type RegisterCardValues,
  useBotProtectedAction,
} from "@ds/design-system/blocks";

/*
 * Registration surface (#131, EARS-1). Email-primary (#202): registration is
 * email + password only — Zitadel cannot create a login-capable human without an
 * email, so the dual-identifier email/phone toggle was removed (phone is a future
 * post-registration secondary identifier; it stays on /login, OTP-login, /reset).
 *
 * #1934: the form itself is no longer assembled here. Both registration doors —
 * this one and the doctor storefront `/register` — are thin projections of the ONE
 * canonical `<RegisterCard>` block in `@ds/design-system/blocks` (AGENTS.md §6
 * cross-front capability reuse; registry row in
 * `specs/product/two-site-ia/capability-ownership.md`). What stays here is exactly
 * what is host-owned: the RU copy (#235 — the package carries no strings), the
 * localized resolver, the bot-protection element, the transport, and the outcome
 * mapping. The rendered result is unchanged — the consent line still reads between
 * the password and the challenge (`belowFieldsSlot`), the submit group still reads
 * challenge → statement → button (`submitBlock="error-first"`) in the `sm` rhythm.
 *
 * Validates with a portal resolver built from the field primitives (#200, see
 * `registerCardFormSchema`), submits same-origin to `/v1/auth/register`, and on the
 * `pending_verification` ack routes to `/verify?email=…` carrying the email so the
 * registrant can submit the code Zitadel mailed. Consent is captured here
 * (EARS-20) — the BFF refuses an empty array — using the canonical ToS pair, as a
 * single read-only statement rather than a tier-1 checkbox group (that is the
 * doctor door's 021 EARS-5 shape, not this one's).
 *
 * 003 EARS-16: no discriminated outcome branch — the BFF answers a brand-new and an
 * already-registered address identically, so this host maps every ack to the same
 * `/verify` hop. 003 EARS-24: the Academy navigates rather than swapping the card in
 * place, so the block's `confirmation` slot stays unused here.
 *
 * 005 EARS-2: a guest entering from an event's «Участвовать» CTA arrives with
 * `?returnTo=/webinars/:slug` (004 EARS-3 handoff). The event context is carried
 * ONWARD through both hops this page owns — the post-submit `/verify` navigation
 * and the «уже есть аккаунт» `/login` link — via the guard-cleaning
 * `withReturnTarget` (a hostile returnTo is dropped at the hop, never
 * propagated). `useSearchParams` requires a Suspense boundary in the App Router,
 * so the card is split out and wrapped below.
 */

export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <RegisterProjection />
      </Suspense>
    </AuthShell>
  );
}

function RegisterProjection() {
  const router = useRouter();
  const t = useTranslations("register");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  // 005 EARS-2: the carried registration-intent (validated at every consumption
  // point by `parseReturnTarget` inside `withReturnTarget` — this page only
  // forwards it, never navigates to it).
  const returnTo = useSearchParams().get("returnTo");
  const [error, setError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(
        botProtectionFailureMessage(failure, botProtectionMessages(te)),
      ),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setCaptchaError(te("captchaRequired"));
        return;
      }
      setError(authErrorMessage(err, te, te("registerFailed")));
    },
  });

  // #200/#202: validate with the email-only portal resolver built from the field
  // primitives, NOT the loose `RegisterRequestSchema`. Its `password` is the
  // message-less `NewPasswordFieldSchema`, whose issues the localized resolver maps
  // to the RU `passwordComplexity` copy (the request schema's baked-in English would
  // outrank the error map in zod v4). The submitted body still goes through
  // `authClient.register(...)` and the API still enforces the full
  // `RegisterRequestSchema` (email required + consent).
  const resolver = useLocalizedResolver<RegisterCardValues, RegisterCardValues>(
    registerCardFormSchema(),
  );

  function onSubmit(values: RegisterCardValues) {
    setError(null);
    // Drop any password held from a prior (e.g. failed-then-retried) registration
    // before we re-stash, so the single in-memory slot never carries a stale
    // credential into this attempt (#175 — explicit single-slot replace).
    clearPendingRegistration();
    captcha.request(async (captchaToken) => {
      await authClient.register({
        email: values.email,
        password: values.password,
        consent: REQUIRED_CONSENT.slice(),
        ...(captchaToken ? { captchaToken } : {}),
      });
      // Hand the entered credential to the verify step IN MEMORY ONLY (#175):
      // module-scoped state survives this SPA `router.push` so `/verify` can
      // replay the EARS-5 password login on success and land the user signed-in
      // on `/account` — but it never touches the URL or any persisted store, and
      // a hard reload of `/verify` drops it (then falls back to `/login`). The
      // email is NOT secret and still rides the query; only the password is held
      // in memory.
      setPendingRegistration({
        identifier: values.email,
        password: values.password,
      });
      // Carry the email into verification (registration is email-only, #202) —
      // plus the event context, when a safe one rode in (005 EARS-2).
      router.push(
        withReturnTarget(
          `/verify?email=${encodeURIComponent(values.email)}`,
          returnTo,
        ),
      );
    });
  }

  return (
    <RegisterCard
      copy={{
        title: t("title"),
        description: t("description"),
        emailLabel: tc("email"),
        emailPlaceholder: tc("emailPlaceholder"),
        passwordLabel: tc("password"),
        passwordPolicyHint: tc("passwordPolicy"),
        // 003 EARS-38 (#1663): the reveal control is the primitive's; this door
        // only supplies its localized labels, unchanged from the hand-assembled
        // form this projection replaced.
        passwordRevealLabels: {
          show: tc("passwordShow"),
          hide: tc("passwordHide"),
          showAria: tc("passwordShowAria"),
          hideAria: tc("passwordHideAria"),
        },
        submit: t("submit"),
      }}
      icon={<UserPlus className="text-primary" aria-hidden />}
      footer={
        <DsLink asChild>
          {/* 005 EARS-2: the already-registered guest's path — the event
                context rides onward into /login so it survives this hop too. */}
          <Link href={withReturnTarget("/login", returnTo)}>
            {t("haveAccount")}
          </Link>
        </DsLink>
      }
      // EARS-20 on this door: one read-only statement, in the position it has
      // shipped in — under the credentials, above the challenge.
      belowFieldsSlot={
        <p className="text-xs text-muted-foreground">{t("consent")}</p>
      }
      captchaSlot={
        <BotProtectionField
          sitekey={botProtectionSiteKey()}
          {...captcha.fieldProps}
        />
      }
      resolver={resolver}
      onSubmit={onSubmit}
      // The shipped single statement slot: a challenge failure outranks a command
      // failure, exactly as the one `<FormError>{captchaError ?? error}` did.
      errors={{
        challenge: captchaError,
        command: captchaError ? null : error,
      }}
      pending={captcha.pending}
      submitBlock="error-first"
      spacing="sm"
      testIds={{ password: "register-password", submit: "register-submit" }}
    />
  );
}
