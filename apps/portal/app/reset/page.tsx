"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

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
import {
  ResetCompleteFormSchema,
  ResetIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

import {
  maskDestination,
  PasswordRecoveryCard,
  type PasswordRecoveryCardCopy,
  type PasswordRecoveryCompleteValues,
  type PasswordRecoveryRequestValues,
} from "@ds/design-system/blocks";

/*
 * Password-reset surface (#131, EARS-11 initiate / EARS-12 complete). Since #1666
 * the whole composition — card frame, both stage forms, the #267 resend footer and
 * the #326 acknowledgement — lives ONCE in the design-system
 * `<PasswordRecoveryCard>` block, so both storefronts recover a password through the
 * same implementation (AGENTS.md §6 cross-front reuse, ADR-0013 A1). This page is
 * the portal's thin host projection: copy from `next-intl`, the localized zod
 * resolvers, the live BFF via {@link authClient}, the EARS-16 outcome mapping, the
 * bot-protection element and the post-completion routing.
 *
 * Two steps on one page: request a reset code for an identifier (email or phone —
 * Zitadel resolves it), then submit the code plus a new policy-conforming password.
 * Both forms validate with the portal field schemas (#196/#200) and submit
 * same-origin to `/v1/auth/password/reset[...]`; the request bodies still match the
 * `@ds/schemas` SSOT contract. Reset is an abuse-prone unauthenticated surface, so
 * the initiate step renders the bot-protection field (EARS-17). On completion the
 * BFF revokes every PRIOR session for the subject AND mints a fresh authenticated
 * session (auto-login, #221) — the response sets the `__Host-` session cookie — so
 * we route straight to `/account` rather than back to `/login`.
 */

export default function ResetPage() {
  const router = useRouter();
  const t = useTranslations("reset");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [stage, setStage] = useState<"request" | "complete">("request");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(botProtectionFailureMessage(failure, te)),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setCaptchaError(te("captchaRequired"));
        return;
      }
      setError(authErrorMessage(err, te, te("resetRequestFailed")));
    },
  });

  // ---- EARS-12 complete step: resend orchestration + its own captcha ----------
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCaptchaError, setResendCaptchaError] = useState<string | null>(
    null,
  );
  // #326: neutral, enumeration-safe resend acknowledgement. The on-screen response is
  // generic and IDENTICAL whether or not an account exists for the identifier — the
  // "account exists" fact is disclosed out-of-band by email, never on-screen (OWASP
  // Authentication Cheat Sheet + WSTG "Testing for Account Enumeration"; Clerk
  // user-enumeration-protection). UI-only: a resend re-hits the existing reset
  // endpoint and sends no additional notice email.
  const [notice, setNotice] = useState<string | null>(null);
  const resendCaptcha = useBotProtectedAction({
    onVerified: () => setResendCaptchaError(null),
    onChallengeError: (failure) =>
      setResendCaptchaError(botProtectionFailureMessage(failure, te)),
    onActionError: (err) =>
      setResendError(authErrorMessage(err, te, te("resetResendFailed"))),
  });

  // #267 resend: re-request a reset code for the SAME held identifier via the
  // EXISTING `requestPasswordReset` (no new backend). EARS-16: the ack is identical
  // whether the identifier exists, so resend leaks nothing. Bumping the nonce
  // restarts the block's cooldown timer + clears the now-stale typed code.
  const { resendNonce, onResend, resetNonce } = useResendCooldown({
    resend: async (captchaToken) => {
      await authClient.requestPasswordReset({
        identifier,
        ...(captchaToken ? { captchaToken } : {}),
      });
    },
    onError: (err) => {
      if (isBotProtectionRejected(err)) {
        setResendCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setResendCaptchaError(te("captchaRequired"));
        return;
      }
      setResendError(authErrorMessage(err, te, te("resetResendFailed")));
    },
    // Clear only resend-owned state; reset-completion feedback is unrelated.
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
    },
    // #326: neutral confirmation, conditionally phrased so it discloses nothing about
    // account existence (identical for every visitor). The masked destination reuses
    // the same `maskDestination` helper the card description shows.
    onSuccess: () =>
      setNotice(
        t("resendAcknowledged", { identifier: maskDestination(identifier) }),
      ),
  });

  const requestResolver = useLocalizedResolver(ResetIdentifierFormSchema);
  // #200: resolve the complete step from the portal `ResetCompleteFormSchema` (field
  // primitives), NOT `PasswordResetCompleteRequestSchema`. The request schema's
  // `newPassword` is the message-carrying `NewPasswordSchema`, whose baked-in English
  // outranks the localized error map in zod v4 and leaked onto the field; the portal
  // schema's message-less `NewPasswordFieldSchema` renders the RU `passwordComplexity`
  // copy instead. The submitted body still matches the loose `@ds/schemas` contract;
  // the API enforces the real policy.
  const completeResolver = useLocalizedResolver(ResetCompleteFormSchema);

  function onRequest(values: PasswordRecoveryRequestValues) {
    setError(null);
    captcha.request(async (captchaToken) => {
      await authClient.requestPasswordReset({
        ...values,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // EARS-16: the ack is identical whether or not the identifier exists; we
      // always advance to the code step. Carry the identifier into completion — the
      // block mounts a FRESH complete form for the stage, so its `code` Controller is
      // registered on that form's first render (never seeded post-hoc, the #212/#211
      // detachment that dropped every keystroke on /reset).
      setIdentifier(values.identifier);
      setStage("complete");
    });
  }

  async function onComplete(values: PasswordRecoveryCompleteValues) {
    setCompleteError(null);
    try {
      await authClient.completePasswordReset({ ...values, identifier });
      // #221: the reset response auto-logged us in (the BFF set the __Host- session
      // cookie), so go straight to the authenticated area instead of /login.
      // #1004: soft landing → signal the persistent header to re-read the
      // profile so the avatar appears without a hard reload.
      refreshHeaderAuth();
      router.push("/account");
    } catch (err) {
      setCompleteError(authErrorMessage(err, te, te("resetCompleteFailed")));
    }
  }

  function onRestart() {
    // «Начать заново»: return to the request stage so the user can change the
    // identifier (e.g. mistyped email/phone) and request a fresh code. The block
    // remounts the request form, so its field comes back empty.
    setError(null);
    setCaptchaError(null);
    setCompleteError(null);
    setResendError(null);
    setResendCaptchaError(null);
    setNotice(null);
    resetNonce();
    setIdentifier("");
    setStage("request");
  }

  const copy: PasswordRecoveryCardCopy = {
    title: t("title"),
    titleComplete: t("titleComplete"),
    descriptionRequest: t("descriptionRequest"),
    descriptionComplete: (destination) =>
      t("descriptionComplete", { identifier: destination }),
    backToSignIn: t("backToSignIn"),
    request: {
      identifierLabel: tc("emailOrPhone"),
      identifierPlaceholder: tc("identifierPlaceholder"),
      submit: t("sendResetCode"),
    },
    complete: {
      codeLabel: t("codeLabel"),
      newPasswordLabel: t("newPasswordLabel"),
      passwordPolicyHint: tc("passwordPolicy"),
      submit: t("setNewPassword"),
      startOver: t("startOver"),
      resend: t("resend"),
      resendCountdown: (seconds) => t("resendIn", { seconds }),
    },
  };

  return (
    // `allowAuthenticated` (#770 rework): /reset is exempt from the #675
    // authenticated-redirect — the /account «Сменить пароль» action hands off
    // HERE for logged-in doctors (003 EARS-28), and completing the reset
    // revokes all sessions + auto-logs-in with the new password (EARS-12).
    <AuthShell allowAuthenticated>
      <PasswordRecoveryCard
        icon={<KeyRound className="text-primary" aria-hidden />}
        copy={copy}
        stage={stage}
        identifier={identifier}
        links={{ login: "/login" }}
        // Next.js `<Link>` keeps the footer link on client-side navigation.
        renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
        request={{
          resolver: requestResolver,
          onSubmit: onRequest,
          error: captchaError ?? error,
          pending: captcha.pending,
          captchaSlot: <BotProtectionField {...captcha.fieldProps} />,
        }}
        complete={{
          resolver: completeResolver,
          onSubmit: onComplete,
          error: completeError,
          resendError: resendCaptchaError ?? resendError,
          resendPending: resendCaptcha.pending,
          resendNonce,
          onResend: () => resendCaptcha.request(onResend),
          onRestart,
          notice,
          captchaSlot: <BotProtectionField {...resendCaptcha.fieldProps} />,
        }}
      />
    </AuthShell>
  );
}
