"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  botProtectionFailureMessage,
  BotProtectionField,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  PasswordRecoveryCard,
  useBotProtectedAction,
  useResendCooldown,
  type PasswordRecoveryCardCopy,
  type PasswordRecoveryCardProps,
  type PasswordRecoveryCompleteValues,
  type PasswordRecoveryRequestValues,
} from "@ds/design-system/blocks";
import {
  NewPasswordFieldSchema,
  OtpCodeFieldSchema,
} from "@ds/design-system/fields";

import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { completeReturnTarget } from "../client/return-completion";
import { resolveAuthFlowCopy } from "../copy";
import { authErrorMessage } from "../errors";
import { identifierFieldSchema } from "../fields";
import { makeResolver } from "../form-resolver";
import type { AuthFlowHostConfig, AuthFlowResetCopy } from "../host-config";
import { ResetGlyph } from "./reset-glyph";

/**
 * The ONE password-recovery flow of the platform (#2027 PR 1.8, tech spec §2.7
 * rows 78–85) — the canvas «Сброс» screen (`design-source/auth.dc.html`
 * 246-289), drawn by the design-system `<PasswordRecoveryCard>` block (#1666).
 *
 * Both storefronts recover a password through THIS component, mounted by
 * `ResetRoute`. What differs between them is data — the host config (its copy
 * override, its channels, `routes.login`, `routes.account`) and the two ends the
 * route resolved server-side — never a branch.
 *
 * Two steps on one route (003 EARS-11 initiate / EARS-12 complete):
 *   • request — a code for the typed identifier, behind the invisible challenge
 *     (003 EARS-17). The BFF answers a known and an UNKNOWN identifier
 *     identically (003 EARS-16), so the door ALWAYS advances and holds the
 *     identifier the BFF accepted;
 *   • complete — the code plus a new length-only password (003 EARS-36) with
 *     the HELD identifier, challenge-free. The BFF revokes every prior session
 *     and mints a fresh one on THIS origin (#221), so the visitor lands signed in
 *     — on the carried target, completed through the shared 005 EARS-2 rule, or
 *     on this host's account page when the arrival carried nothing.
 *
 * The resend (#267) re-runs the REAL initiate for the held identifier under its
 * own challenge and acknowledges it neutrally (#326); «Начать заново» drops the
 * held identifier and every stage-local message.
 */
export type ResetDoorProps = {
  config: AuthFlowHostConfig;
  /**
   * Rule S3 — «Вернуться ко входу», this host's own `routes.login` with the
   * arrival target the guards reconstructed. Built by the route.
   */
  loginHref: string;
  /**
   * Rule S4 — where a completed recovery lands: the carried target's host
   * projection, or `routes.account` when the arrival carried none (#221).
   */
  landing: string;
  /**
   * The carried target 005 EARS-2 COMPLETES once the visitor is signed in (an
   * эфир registration, an account page). `null` → the landing stands as-is.
   */
  returnTarget?: string | null;
};

export function ResetDoor({
  config,
  loginHref,
  landing,
  returnTarget = null,
}: ResetDoorProps) {
  const router = useRouter();
  const resolvedCopy = resolveAuthFlowCopy(config);
  const copy = resolvedCopy.reset;
  const errors = resolvedCopy.errors;
  const captchaCopy = botProtectionMessages(config);
  const authClient = useMemo(() => createAuthClient(config.api), [config.api]);
  const cardCopy = useMemo(() => cardCopyOf(copy), [copy]);
  const requestResolver = useMemo(() => requestResolverOf(config), [config]);
  const completeResolver = useMemo(() => completeResolverOf(config), [config]);

  const [stage, setStage] = useState<"request" | "complete">("request");
  // The identifier the code actually went to — set only after the BFF ACCEPTED
  // the initiate, so the door never asserts a destination the server did not take.
  const [identifier, setIdentifier] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCaptchaError, setResendCaptchaError] = useState<string | null>(
    null,
  );
  // #326: neutral, enumeration-safe resend acknowledgement — identical whether
  // or not an account exists; the account fact goes out of band, by email.
  const [notice, setNotice] = useState<string | null>(null);

  /** A token the guard refused, or a request that arrived without one (003 EARS-17). */
  function challengeMessage(error: unknown): string | null {
    if (isBotProtectionRejected(error)) return captchaCopy.rejected;
    if (isBotProtectionRequired(error)) return captchaCopy.required;
    return null;
  }

  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(botProtectionFailureMessage(failure, captchaCopy)),
    onActionError: (error) => {
      const challenge = challengeMessage(error);
      if (challenge) {
        setCaptchaError(challenge);
        return;
      }
      setRequestError(authErrorMessage(error, errors, copy.requestFailed));
    },
  });

  // The resend is its own protected action: every resend mints its own token.
  const resendCaptcha = useBotProtectedAction({
    onVerified: () => setResendCaptchaError(null),
    onChallengeError: (failure) =>
      setResendCaptchaError(botProtectionFailureMessage(failure, captchaCopy)),
    onActionError: (error) =>
      setResendError(authErrorMessage(error, errors, copy.resendFailed)),
  });

  // #267 — the EXISTING initiate for the SAME held identifier (no second
  // endpoint). Bumping the nonce restarts the block's cooldown and clears the
  // now-stale typed code.
  const { resendNonce, onResend, resetNonce } = useResendCooldown({
    resend: async (captchaToken) => {
      await authClient.requestPasswordReset({ identifier }, captchaToken);
    },
    onError: (error) => {
      const challenge = challengeMessage(error);
      if (challenge) {
        setResendCaptchaError(challenge);
        return;
      }
      setResendError(authErrorMessage(error, errors, copy.resendFailed));
    },
    // Only resend-owned state: completion feedback answers another question.
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
    },
    onSuccess: () =>
      setNotice(
        fillTemplate(
          copy.resendAcknowledged,
          "destination",
          maskDestination(identifier),
        ),
      ),
  });

  function onRequest(values: PasswordRecoveryRequestValues) {
    setRequestError(null);
    const value = values.identifier.trim();
    captcha.request(async (captchaToken) => {
      // Row 18: the token rides the header; the body is the command only.
      await authClient.requestPasswordReset(
        { identifier: value },
        captchaToken,
      );
      // 003 EARS-16: identical for an unknown identifier, so ALWAYS advance. The
      // block mounts a FRESH complete form for the stage, so its code field is
      // registered on that form's first render, never seeded post hoc (#212).
      setIdentifier(value);
      setStage("complete");
    });
  }

  async function onComplete(values: PasswordRecoveryCompleteValues) {
    setCompleteError(null);
    let destination: string;
    try {
      await authClient.completePasswordReset({ ...values, identifier });
      // Rule S4 / 005 EARS-2 — the session exists now (#221), so a carried
      // target is COMPLETED before the visitor is sent to it; nothing carried →
      // the landing the route resolved (this host's account page).
      destination = returnTarget
        ? await completeReturnTarget(config, returnTarget, landing)
        : landing;
    } catch (error) {
      setCompleteError(authErrorMessage(error, errors, copy.completeFailed));
      return;
    }
    router.push(destination);
    // 008 EARS-5 (#2281): drop the guest-era client Router Cache so the
    // server-read header re-renders signed in and Back re-reads it.
    router.refresh();
  }

  /**
   * «Начать заново»: back to the request step with an empty box. The block
   * remounts the request form; what the DOOR holds is cleared here, because that
   * unmount cannot reach it.
   */
  function onRestart() {
    setRequestError(null);
    setCaptchaError(null);
    setCompleteError(null);
    setResendError(null);
    setResendCaptchaError(null);
    setNotice(null);
    resetNonce();
    setIdentifier("");
    setStage("request");
  }

  return (
    <PasswordRecoveryCard
      icon={<ResetGlyph />}
      copy={cardCopy}
      stage={stage}
      identifier={identifier}
      links={{ login: loginHref }}
      renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
      request={{
        resolver: requestResolver,
        onSubmit: onRequest,
        error: captchaError ?? requestError,
        pending: captcha.pending,
        captchaSlot: (
          <BotProtectionField
            sitekey={botProtectionSiteKey(config)}
            {...captcha.fieldProps}
          />
        ),
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
        captchaSlot: (
          <BotProtectionField
            sitekey={botProtectionSiteKey(config)}
            {...resendCaptcha.fieldProps}
          />
        ),
      }}
    />
  );
}

type RequestResolver = PasswordRecoveryCardProps["request"]["resolver"];
type CompleteResolver = PasswordRecoveryCardProps["complete"]["resolver"];

/** EARS-11 — the identifier box this host serves (row 21), in the package sentences. */
function requestResolverOf(config: AuthFlowHostConfig): RequestResolver {
  const identifier = identifierFieldSchema(config);
  const { fields } = resolveAuthFlowCopy(config);
  return makeResolver<PasswordRecoveryRequestValues, RequestResolver>({
    identifier: (value) => {
      if (!value?.trim()) {
        return fields.identifier.required ?? fields.identifier.invalid;
      }
      return identifier.safeParse(value.trim()).success
        ? null
        : fields.identifier.invalid;
    },
  });
}

/**
 * EARS-12 — the code plus the new password. The identifier is not re-validated:
 * the door holds the one the BFF already accepted. The password bound is the
 * 003 EARS-36 length-only rule through the shared field schema; the RU sentence
 * is the package's, never the English baked into `@ds/schemas` (#200).
 */
function completeResolverOf(config: AuthFlowHostConfig): CompleteResolver {
  const { fields } = resolveAuthFlowCopy(config);
  return makeResolver<PasswordRecoveryCompleteValues, CompleteResolver>({
    code: (value) =>
      OtpCodeFieldSchema.safeParse(value).success
        ? null
        : (fields.code.required ?? fields.code.invalid),
    newPassword: (value) => {
      if (!value) return fields.password.required ?? fields.password.invalid;
      return NewPasswordFieldSchema.safeParse(value).success
        ? null
        : fields.password.invalid;
    },
  });
}

/**
 * The block takes two lines as FUNCTIONS of a runtime value and the copy holds
 * only strings, so the templates are closed over here.
 */
function cardCopyOf(copy: AuthFlowResetCopy): PasswordRecoveryCardCopy {
  return {
    title: copy.title,
    titleComplete: copy.completeTitle,
    descriptionRequest: copy.description,
    descriptionComplete: (destination) =>
      fillTemplate(copy.completeDescription, "destination", destination),
    backToSignIn: copy.backToSignIn,
    request: {
      identifierLabel: copy.identifierLabel,
      identifierPlaceholder: copy.identifierPlaceholder,
      submit: copy.submit,
    },
    complete: {
      codeLabel: copy.codeLabel,
      newPasswordLabel: copy.newPasswordLabel,
      passwordPolicyHint: copy.passwordHint,
      passwordReveal: copy.reveal,
      submit: copy.completeSubmit,
      startOver: copy.startOver,
      resend: copy.resend,
      resendCountdown: (seconds) =>
        fillTemplate(copy.resendCountdown, "seconds", String(seconds)),
    },
  };
}

/** Substitute a template's single placeholder. */
function fillTemplate(template: string, token: string, value: string): string {
  return template.split(`{${token}}`).join(value);
}
