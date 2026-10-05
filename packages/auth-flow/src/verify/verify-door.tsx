"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { DoctorVerifyRequest, VerifyRequest } from "@ds/schemas";
import {
  botProtectionFailureMessage,
  BotProtectionField,
  clearPendingRegistration,
  EmailConfirmCard,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  peekPendingRegistration,
  useBotProtectedAction,
  useResendCooldown,
  type EmailConfirmCardCopy,
  type EmailConfirmCardProps,
  type EmailConfirmCardTestIds,
  type EmailConfirmValues,
  type PendingRegistrationValues,
} from "@ds/design-system/blocks";

import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { completeResolvedReturnTarget } from "../client/return-completion";
import { resolveAuthFlowCopy } from "../copy";
import { withBoldDestination } from "../copy/destination";
import { authErrorMessage } from "../errors";
import { resolveVerificationCode } from "../fields";
import { makeResolver } from "../form-resolver";
import type { AuthFlowHostConfig, AuthFlowVerifyCopy } from "../host-config";
import {
  completionTargetAfterSignIn,
  landingAfterSignIn,
  type CompletionTarget,
} from "../client/signed-in-landing";
import { consentRefusalMessage } from "../register/consent-refusal";
import { withReturnTarget } from "../return-target-href";
import { VerifyGlyph } from "./verify-glyph";

/**
 * The code step after the registration form (003 EARS-24 amended, EARS-42) —
 * the canvas «ШАГ КОДА» (`design-source/auth.dc.html` 64-85), drawn by the
 * design-system `<EmailConfirmCard>` around the SAME `<OtpFocusScreen>` the
 * sign-in card shows once a code was sent.
 *
 * Both storefronts reach it on their own `/verify` route (`VerifyRoute` →
 * `VerifyEntry`). What differs between them is data — the host config (its
 * `api.verifyPath` and the `registration` its register command held) and the
 * targets below — never a branch. A new and an already-registered address get
 * the identical step (003 EARS-16; re-registration, 044 EARS-14).
 *
 * One submission (003 EARS-41): the code goes to the host's verify command
 * together with the in-tab registration values while this tab still holds
 * them; the answer sets the session itself — there is no password replay
 * (003 EARS-39 amended). A cold step (a reload, an expired hold) submits the
 * code alone and is signed in just the same. On success the carried эфир is
 * completed (005 EARS-2, 021 EARS-10) and the visitor replaced onto the target
 * or the landing; a refused code stays on this step with the generic sentence,
 * the held values kept for the retry.
 */
export type VerifyDoorProps = {
  config: AuthFlowHostConfig;
  /**
   * The address the code went to — always known: a `/verify` arrival with none
   * is sent to the registration door before the step is shown (003 EARS-40).
   */
  email: string;
  /** Where a visitor with no honoured target lands — decided server-side by the mount. */
  landing: string;
  /**
   * #2333 — the mount's server action that decides the landing AGAIN once the
   * confirmed visitor is signed in; absent where it cannot change.
   */
  resolveSignedInLanding?: () => Promise<string>;
  /**
   * 021 EARS-10 (#2455) — the mount's server action that judges the carried
   * эфир again once the code is accepted; absent when the arrival carried none.
   */
  resolveCompletionTarget?: () => Promise<CompletionTarget>;
  /**
   * The resolved эфир intent of the arrival (021 EARS-10), in this host's
   * vocabulary — what 005 EARS-2 completes once the visitor is signed in.
   */
  returnTarget?: string | null;
  /** Rule S3 — the target «← Изменить почту» carries back to the form. */
  carriedTarget?: string | null;
  /**
   * 021 EARS-2 — the mobile return-context plate above the card, the one the
   * registration door draws (`returnContextSlots(...).plate`). Absent → nothing.
   */
  returnContextPlate?: ReactNode;
};

/** The canonical `data-testid` map, one on both hosts. */
export const VERIFY_TEST_IDS: Partial<EmailConfirmCardTestIds> = {
  root: "verify-card",
  // The registration door's id: the step shows the same plate the form did.
  returnContext: "registration-return-context",
  error: "verify-error",
  succeeded: "verify-succeeded",
  submit: "verify-submit",
  resend: "verify-resend",
  resendNotice: "verify-resend-notice",
  back: "verify-back",
};

/** The verify request: the code, plus the held registration values when present. */
function verifyRequestOf(
  email: string,
  code: string,
  held: PendingRegistrationValues | undefined,
): VerifyRequest | DoctorVerifyRequest {
  if (!held) return { email, code };
  const { consent, ...rest } = held;
  return { email, code, registration: { ...rest, consent: [...consent] } };
}

export function VerifyDoor({
  config,
  email,
  landing,
  resolveSignedInLanding,
  resolveCompletionTarget,
  returnTarget = null,
  carriedTarget = null,
  returnContextPlate,
}: VerifyDoorProps) {
  const router = useRouter();
  const resolvedCopy = resolveAuthFlowCopy(config);
  const copy = resolvedCopy.verify;
  const errors = resolvedCopy.errors;
  const captchaCopy = botProtectionMessages(config);
  const authClient = useMemo(() => createAuthClient(config.api), [config.api]);
  const cardCopy = useMemo(() => cardCopyOf(copy), [copy]);
  const resolver = useMemo(() => codeResolver(config), [config]);
  const destination = maskDestination(email);

  const [error, setError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  // Canvas 73-75 — «Код принят — входим…», set only AFTER the server accepted
  // the code (never optimistically).
  const [succeeded, setSucceeded] = useState(false);

  // A resend is its own protected action: every resend mints its own token.
  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(botProtectionFailureMessage(failure, captchaCopy)),
    onActionError: (err) =>
      setResendError(authErrorMessage(err, errors, copy.resendFailed)),
  });

  // #267 / 003 EARS-25 — the dedicated resend endpoint, never a re-`register`.
  const { resendNonce, onResend } = useResendCooldown({
    resend: async (captchaToken) => {
      await authClient.resendVerification({ identifier: email }, captchaToken);
    },
    onError: (err) => {
      if (isBotProtectionRejected(err)) {
        setCaptchaError(captchaCopy.rejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setCaptchaError(captchaCopy.required);
        return;
      }
      setResendError(authErrorMessage(err, errors, copy.resendFailed));
    },
    onBeforeResend: () => {
      // The one plate says the failure of the operation just performed
      // (canvas 53-56): a resend withdraws a stale refused-code sentence.
      setError(null);
      setResendError(null);
      setNotice(null);
      setSucceeded(false);
    },
    // Canvas 81-83 — the same sentence for every address (003 EARS-16).
    onSuccess: () =>
      setNotice(withBoldDestination(copy.resendAcknowledged, destination)),
  });

  async function onSubmit(values: EmailConfirmValues) {
    setError(null);
    // 003 EARS-41 — read, not taken: a refused code is retried with the same
    // values; only an accepted code wipes them.
    const held = peekPendingRegistration(email);
    let destinationHref: string;
    try {
      await authClient.verify(
        verifyRequestOf(email, values.code, held?.registration),
      );
      clearPendingRegistration();
      setSucceeded(true);
      // #2333 — the session exists now, so the landing is decided again for
      // it: the guest-render one could not see a profile specialty.
      const signedInLanding = await landingAfterSignIn(
        landing,
        resolveSignedInLanding,
      );
      // 021 EARS-10 (amendment 2026-09-29) — the target is judged now, not
      // when this step rendered.
      const target = await completionTargetAfterSignIn(
        { returnTarget, landing: signedInLanding },
        resolveCompletionTarget,
      );
      // 005 EARS-2 — completed before the visitor is sent anywhere.
      destinationHref = await completeResolvedReturnTarget(
        config,
        target.returnTarget,
        target.landing,
      );
    } catch (err) {
      setSucceeded(false);
      // 021 EARS-12 — a 422 access-condition refusal (the doctor command checks
      // the held consent it received with the code) reads exactly as the
      // registration door reads that condition; otherwise 003 EARS-16 —
      // generic, except 429 / 5xx / network (rows 12, 14).
      setError(
        consentRefusalMessage(err, resolvedCopy.consents) ??
          authErrorMessage(err, errors, copy.failed),
      );
      return;
    }
    // `replace`: the spent code form must not sit behind a back gesture; then
    // drop the guest-era client Router Cache so the header re-reads (008 EARS-5).
    router.replace(destinationHref);
    router.refresh();
  }

  return (
    <EmailConfirmCard
      icon={<VerifyGlyph />}
      copy={cardCopy}
      email={email}
      destination={destination}
      resolver={resolver}
      onSubmit={onSubmit}
      // A blocked submit is never a silent no-op (#904): it names the code the
      // FieldSpec rule refused.
      onInvalid={() => setError(resolvedCopy.fields.code.invalid)}
      error={error}
      succeeded={succeeded}
      // 003 EARS-24 amended — «← Изменить почту»: back to this host's form,
      // which refills from the values still held in this tab, the arrival
      // target carried onward (rule S3).
      onBack={() =>
        router.push(withReturnTarget(config.routes.register, carriedTarget))
      }
      resend={{
        nonce: resendNonce,
        onResend: () => captcha.request(onResend),
        error: captchaError ?? resendError,
        pending: captcha.pending,
        notice,
        captchaSlot: (
          <BotProtectionField
            sitekey={botProtectionSiteKey(config)}
            {...captcha.fieldProps}
          />
        ),
      }}
      testIds={VERIFY_TEST_IDS}
      returnContextSlot={returnContextPlate}
    />
  );
}

/** The block takes two lines as FUNCTIONS of a runtime value; the config holds templates. */
function cardCopyOf(copy: AuthFlowVerifyCopy): EmailConfirmCardCopy {
  return {
    title: copy.title,
    // Canvas 394 — the masked address stands bold inside the sentence.
    description: (destination) =>
      withBoldDestination(copy.description, destination),
    codeLabel: copy.codeLabel,
    submit: copy.submit,
    codeAccepted: copy.codeAccepted,
    resend: copy.resend,
    resendCountdown: (seconds) =>
      copy.resendCountdown.split("{seconds}").join(String(seconds)),
    back: copy.back,
  };
}

/**
 * 021 EARS-11 — the code rule and its message come from ONE FieldSpec
 * projection. Client guard only: the server normalises again.
 */
function codeResolver(
  config: AuthFlowHostConfig,
): NonNullable<EmailConfirmCardProps["resolver"]> {
  return makeResolver<
    EmailConfirmValues,
    NonNullable<EmailConfirmCardProps["resolver"]>
  >({
    code: (value) => resolveVerificationCode(config, value),
  });
}
