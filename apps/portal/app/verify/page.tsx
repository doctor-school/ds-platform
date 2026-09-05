"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";

import { VerifyRequestSchema, type LoginRequest } from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import {
  BotProtectionField,
  botProtectionFailureMessage,
  isBotProtectionRejected,
  isBotProtectionRequired,
  useBotProtectedAction,
} from "@/components/bot-protection";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { refreshHeaderAuth } from "@/lib/header-auth";
import { takePendingRegistration } from "@/lib/pending-registration";
import { withReturnTarget } from "@/lib/registration-handoff";
import { completeReturnTarget } from "@/lib/registration-resume";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

import {
  EmailConfirmCard,
  maskDestination,
  type EmailConfirmCardCopy,
  type EmailConfirmValues,
} from "@ds/design-system/blocks";

/*
 * Post-registration surface (#131, EARS-3; reframed #207, EARS-24). Since #1666 the
 * whole composition — card frame, the code form with its #175 auto-submit, the #267
 * resend control and the co-equal already-registered actions — lives ONCE in the
 * design-system `<EmailConfirmCard>` block, so both storefronts confirm an email
 * through the same implementation (AGENTS.md §6 cross-front reuse, ADR-0013 A1).
 * This page is the portal's thin host projection: copy from `next-intl`, the
 * localized resolver, the live BFF via {@link authClient}, the #904 identifier
 * resolution, the auto-login replay and the routing.
 *
 * The BFF returns the IDENTICAL `pending_verification` for a brand-new and an
 * already-registered email (EARS-16), so this screen CANNOT know which visitor it is
 * showing — and must NEVER branch on account existence. It is therefore framed as a
 * single, existence-agnostic "check your email" view with two co-equal affordances:
 *   (a) enter the email code  — the new registrant's path (unchanged auto-submit
 *       + post-verify auto-login, #175/#194);
 *   (b) Войти / Сбросить пароль — prominent actions for the already-registered
 *       owner, whose correct path is ALSO delivered privately by the EARS-23
 *       account-exists notice email.
 * The per-case routing happens in the inbox or by the user's own choice, never by
 * the form disclosing existence. All copy is from the EARS-21 message catalog.
 *
 * Registration verification is email-only (#202 — registration is email-primary).
 * Validates with `VerifyRequestSchema`, submits same-origin to `/v1/auth/verify`.
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
 * `useSearchParams` requires a Suspense boundary in the App Router, so the card is
 * split out and wrapped below.
 */

export default function VerifyPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <PortalEmailConfirmCard />
      </Suspense>
    </AuthShell>
  );
}

/** The portal projection of the shared `<EmailConfirmCard>` block. */
function PortalEmailConfirmCard() {
  const router = useRouter();
  const t = useTranslations("verify");
  const te = useTranslations("errors");
  const params = useSearchParams();
  const queryEmail = params.get("email") ?? undefined;
  // #904: the branded verification email's CTA points at `/verify#email=<addr>` —
  // the identifier rides the URL FRAGMENT, which browsers never send to the server
  // (so the #869 scanner-prefetch invariant holds). On a cold email-button open there
  // is no `?email=` query, so seed the account from the fragment. The hash is not
  // available at SSR (it never leaves the browser), so read it on mount client-side.
  // The `?email=` query stays the same-tab primary + a backward-compat fallback.
  const [fragmentEmail, setFragmentEmail] = useState<string | undefined>(
    undefined,
  );
  useEffect(() => {
    if (queryEmail) return; // same-tab query wins; no need to consult the fragment.
    const hash = window.location.hash; // e.g. "#email=doc%40example.com"
    if (!hash.startsWith("#")) return;
    const seeded = new URLSearchParams(hash.slice(1)).get("email");
    if (seeded) setFragmentEmail(seeded);
  }, [queryEmail]);
  const email = queryEmail ?? fragmentEmail;
  // 005 EARS-2: the carried registration-intent riding the guest-through-auth
  // round-trip. Consumed ONLY through the `parseReturnTarget` guard (inside
  // `completeReturnTarget` / `withReturnTarget`), so a hostile value can neither
  // be navigated to nor propagated onward.
  const returnTo = params.get("returnTo");
  const [error, setError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  // #326: neutral, enumeration-safe resend acknowledgement. The on-screen response
  // to a resend is generic and IDENTICAL in every case (registered / unregistered /
  // already-verified) — the "account exists" fact is disclosed out-of-band by email,
  // never on-screen (OWASP Authentication Cheat Sheet + WSTG "Testing for Account
  // Enumeration"; Clerk user-enumeration-protection). It is purely UI: a resend sends
  // no additional notice email (the register-time EARS-23 notice already covered the
  // owner; re-notifying per resend is noise + abuse-amplification).
  const [notice, setNotice] = useState<string | null>(null);
  // Canvas `verified` success row: once the code is accepted the surface confirms
  // «Код принят — входим…» while the auto-login replay (below) completes and routes.
  // Presentation only — set AFTER `authClient.verify` resolves (never optimistically),
  // so it never asserts acceptance the server has not confirmed; cleared if the
  // login replay then fails (back to the error slot) or on a resend.
  const [succeeded, setSucceeded] = useState(false);
  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(botProtectionFailureMessage(failure, te)),
    onActionError: (err) =>
      setResendError(authErrorMessage(err, te, te("verifyResendFailed"))),
  });

  const resolver = useLocalizedResolver(VerifyRequestSchema);

  // Privacy-masked destination (#227): the screen confirms WHERE the code went
  // without re-printing the full address (`a•••@p•••.com`); reuses the same
  // `maskDestination` helper the login-OTP focus-screen displays. Computed here so
  // both the card description and the #326 resend confirmation can interpolate it.
  const identifierLabel = email
    ? maskDestination(email)
    : t("fallbackIdentifier");

  // #267 resend: re-issue the registration code via the dedicated EARS-25 endpoint
  // (`/v1/auth/verify/resend`, #319) — NOT a re-`register` (no held password here).
  // The identifier is the seeded email; if it is absent (deep-link without `?email=`)
  // resend has nothing to target, so the control is hidden. EARS-16: the ack is
  // existence-agnostic, so resend never reveals whether the account exists.
  const { resendNonce, onResend } = useResendCooldown({
    resend: async (captchaToken) => {
      await authClient.resendVerification({
        identifier: email ?? "",
        ...(captchaToken ? { captchaToken } : {}),
      });
    },
    onError: (err) => {
      if (isBotProtectionRejected(err)) {
        setCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setCaptchaError(te("captchaRequired"));
        return;
      }
      setResendError(authErrorMessage(err, te, te("verifyResendFailed")));
    },
    // Clear only resend-owned state; code-verification feedback is unrelated.
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
      setSucceeded(false);
    },
    // #326: neutral confirmation, conditionally phrased so it asserts nothing about
    // account existence (identical for every visitor — see the `notice` comment above).
    onSuccess: () =>
      setNotice(t("resendAcknowledged", { identifier: identifierLabel })),
  });

  async function onSubmit(values: EmailConfirmValues) {
    setError(null);
    const identifier = email ?? "";
    try {
      // Mapped field-by-field, not cast: the block's structural values type and the
      // `VerifyRequest` contract coincide today, and a future field on the contract
      // must fail typecheck HERE rather than ship a silent omission.
      await authClient.verify({ email: values.email, code: values.code });
      // Code accepted (server-confirmed) — show the success row while we replay the
      // login below and route. Reverted in the catch if the replay itself fails.
      setSucceeded(true);
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
        // the back-stack. 005 EARS-2: with a carried event context the session
        // now exists, so the SAME RegisterForEvent (EARS-1) fires for that event
        // and the doctor lands back on its page registered; without one this is
        // the shipped `/account` landing.
        // #1004: soft landing → signal the persistent header to re-read the
        // profile so the avatar appears without a hard reload.
        refreshHeaderAuth();
        router.replace(await completeReturnTarget(returnTo));
        return;
      }
      // No held credential (deep-link / reload / abandoned) — fall back to the
      // manual sign-in round-trip, carrying the event context onward (EARS-2).
      router.push(withReturnTarget("/login", returnTo));
    } catch (err) {
      // If verify itself failed the store was never read (the user retries the
      // code, still auto-logs-in on success). If the login REPLAY failed, the
      // store is already wiped by takePendingRegistration — the password is gone
      // and the user signs in manually at /login. EARS-16: the verify/auth
      // outcome stays generic; only 429/5xx/network surface a specific message.
      setSucceeded(false);
      setError(authErrorMessage(err, te, te("verifyFailed")));
    }
  }

  // #904: a submit blocked by validation on the NON-RENDERED `email` field must
  // never be a silent no-op (the exact dead-end the owner hit on a cold bare
  // `/verify`: no `?email=` and no `#email=` → the hidden field fails Zod →
  // `handleSubmit` never calls `onSubmit` and nothing is shown). Surface a visible,
  // localized error via the existing `error` slot / <FormError> so the user knows
  // the link was incomplete and can act (open the email link, or re-register). This
  // ships independently of the fragment fix (correctness + a11y).
  const onInvalid = useCallback(() => {
    if (!email) {
      setError(te("verifyMissingIdentifier"));
      return;
    }
    // A blocked submit with an identifier present means the code itself is
    // invalid/empty — surface a generic prompt rather than staying silent.
    setError(te("verifyFailed"));
  }, [email, te]);

  const copy: EmailConfirmCardCopy = {
    title: t("title"),
    description: (destination) =>
      t.rich("description", {
        identifier: destination,
        strong: (chunks) => <strong>{chunks}</strong>,
      }),
    newAccountHeading: t("newAccountHeading"),
    codeLabel: t("codeLabel"),
    submit: t("submit"),
    codeAccepted: t("codeAccepted"),
    resend: t("resend"),
    resendCountdown: (seconds) => t("resendIn", { seconds }),
    existingAccountHeading: t("existingAccountHeading"),
    existingAccountHint: t("existingAccountHint"),
    goToSignIn: t("goToSignIn"),
    goToReset: t("goToReset"),
  };

  return (
    <EmailConfirmCard
      icon={<MailCheck className="text-primary" aria-hidden />}
      copy={copy}
      email={email}
      destination={identifierLabel}
      resolver={resolver}
      onSubmit={onSubmit}
      onInvalid={onInvalid}
      error={error}
      succeeded={succeeded}
      // 005 EARS-2: the already-registered owner's sign-in path — the event
      // context rides onward into /login so completing auth there still finishes
      // the carried registration.
      links={{ login: withReturnTarget("/login", returnTo), reset: "/reset" }}
      // Next.js `<Link>` keeps the two actions on client-side navigation.
      renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
      // Only meaningful when an email destination is known (it is seeded from the
      // `?email=` the register step passes, or the #904 fragment); on a bare
      // deep-link there is nothing to resend to, so the control is omitted rather
      // than firing an empty request.
      resend={
        email
          ? {
              nonce: resendNonce,
              onResend: () => captcha.request(onResend),
              error: captchaError ?? resendError,
              pending: captcha.pending,
              notice,
              captchaSlot: <BotProtectionField {...captcha.fieldProps} />,
            }
          : undefined
      }
    />
  );
}
