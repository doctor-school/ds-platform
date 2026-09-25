"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  botProtectionFailureMessage,
  BotProtectionField,
  EmailConfirmCard,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  takePendingRegistration,
  useBotProtectedAction,
  useResendCooldown,
  type EmailConfirmCardCopy,
  type EmailConfirmCardProps,
  type EmailConfirmCardTestIds,
  type EmailConfirmValues,
} from "@ds/design-system/blocks";

import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { completeReturnTarget } from "../client/return-completion";
import { resolveAuthFlowCopy } from "../copy";
import { authErrorMessage } from "../errors";
import { resolveVerificationCode } from "../fields";
import { makeResolver } from "../form-resolver";
import type { AuthFlowHostConfig, AuthFlowVerifyCopy } from "../host-config";
import { resolveConfirmLanding } from "../register/confirm-landing";
import { withReturnTarget } from "../return-target-href";
import { VerifyGlyph } from "./verify-glyph";

/**
 * The ONE confirmation step of the platform (#2027 PR 1.7, tech spec §2.6 rows
 * 65–77) — the canvas «Подтверждение» screen (`design-source/auth.dc.html`
 * 212-244), drawn by the design-system `<EmailConfirmCard>` block.
 *
 * Both storefronts confirm an address through THIS component: the Academy on
 * its `/verify` route (`VerifyRoute` → `VerifyEntry`), the doctor storefront
 * inline on the registration door (`RegistrationConfirmation`). What differs
 * between them is data — the host config and the three targets below — never a
 * branch.
 *
 * The surface is EXISTENCE-AGNOSTIC (003 EARS-16): the BFF answers a new and an
 * already-registered address identically, so the card offers the code AND the
 * co-equal «Войти» / «Сбросить пароль» way out, and never says which applies.
 *
 * Past an accepted code (003 EARS-3 mints no session) the rule is one on both
 * hosts, owner decisions 2026-09-15 (tech spec §5 Q1/Q2, 003 EARS-39):
 *   • a held credential → replay the real password login, complete the carried
 *     эфир (005 EARS-2) and replace onto the landing (021 EARS-10);
 *   • no held credential (a reload, a restored tab, the mail's cold link) → the
 *     email is verified and there is no session, so the visitor goes to the
 *     sign-in door carrying the arrival target — never onward as a guest;
 *   • a replay the login refuses → stay on THIS step with the generic sentence.
 */
export type VerifyDoorProps = {
  config: AuthFlowHostConfig;
  /**
   * The address the code went to. `undefined` on a bare deep-link (#904): the
   * card still renders, the resend is hidden and a submit says why nothing
   * happened instead of firing an empty command.
   */
  email?: string | undefined;
  /** Where a visitor with no honoured target lands — decided server-side by the mount. */
  landing: string;
  /**
   * The эфир intent the CONFIRM COMMAND re-validates with the code (021 EARS-19)
   * — supplied only by a host whose confirm command takes one (the doctor
   * storefront's). Absent, the command carries the address and the code only.
   */
  returnTarget?: string | null;
  /**
   * What 005 EARS-2 completes once the visitor is signed in. The shared rule
   * guards it, and on a host that parks its target (014 EARS-6) an absent value
   * consumes the parked one.
   */
  completionTarget?: string | null;
  /** Rule S3 — the target the sideways hops and the cold exit carry onward. */
  carriedTarget?: string | null;
  /**
   * 021 EARS-2 — the mobile return-context plate above the card, the one the
   * registration door draws (`returnContextSlots(...).plate`). Absent → nothing.
   */
  returnContextPlate?: ReactNode;
};

/** The canonical `data-testid` map, one on both hosts (the ids #1666 shipped). */
export const VERIFY_TEST_IDS: Partial<EmailConfirmCardTestIds> = {
  root: "verify-card",
  // The registration door's id: the step shows the same plate the form did.
  returnContext: "registration-return-context",
  error: "verify-error",
  succeeded: "verify-succeeded",
  submit: "verify-submit",
  resend: "verify-resend",
  resendNotice: "verify-resend-notice",
  goToLogin: "verify-go-to-login",
  goToReset: "verify-go-to-reset",
};

export function VerifyDoor({
  config,
  email,
  landing,
  returnTarget = null,
  completionTarget = null,
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
  const destination = email ? maskDestination(email) : copy.fallbackDestination;

  const [error, setError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Canvas 221-224 — «Код принят — входим…», set only AFTER the server accepted
  // the code (never optimistically) and withdrawn if the replay is refused.
  const [succeeded, setSucceeded] = useState(false);

  // A resend is its own protected action, separate from any registration form:
  // every resend mints its own token through the same challenge.
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
      await authClient.resendVerification(
        { identifier: email ?? "" },
        captchaToken,
      );
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
      setResendError(null);
      setNotice(null);
      setSucceeded(false);
    },
    // 003 EARS-16 — conditionally phrased, so it is the same sentence for a
    // registrant, a stranger and an already-verified owner.
    onSuccess: () =>
      setNotice(
        fillTemplate(copy.resendAcknowledged, "destination", destination),
      ),
  });

  async function onSubmit(values: EmailConfirmValues) {
    setError(null);
    if (!email) {
      // #904 — the code went to an address this surface cannot name.
      setError(copy.missingIdentifier);
      return;
    }
    let confirmed: unknown;
    try {
      // `returnTo` rides the SAME command as the code where the host's command
      // takes one, so the server decides the destination with the verification
      // it just performed (021 EARS-19).
      confirmed = await authClient.confirm({
        email,
        code: values.code,
        ...(returnTarget ? { returnTo: returnTarget } : {}),
      });
    } catch (err) {
      // 003 EARS-16 — generic, except 429 / 5xx / network (rows 12, 14).
      setError(authErrorMessage(err, errors, copy.failed));
      return;
    }
    setSucceeded(true);

    // The slot is wiped by the take whether the replay then succeeds or throws.
    const held = takePendingRegistration(email);
    if (!held) {
      // Q2 — verified, no session: the sign-in door, carrying the target.
      router.push(withReturnTarget(config.routes.login, carriedTarget));
      return;
    }
    let destinationHref: string;
    try {
      await authClient.login({
        identifier: held.identifier,
        password: held.password,
      });
      // 005 EARS-2 — the session exists now, so the carried эфир is COMPLETED
      // before the visitor is sent anywhere. Best-effort by the rule's contract.
      const completed = await completeReturnTarget(
        config,
        completionTarget,
        landing,
      );
      // 021 EARS-10 — a confirm command that NAMES a destination produced it in
      // the round trip that just re-validated the target, so it wins; the 003
      // command names none, and the completion's landing stands.
      destinationHref = isNamedLanding(confirmed)
        ? resolveConfirmLanding(confirmed, landing)
        : completed;
    } catch (err) {
      // Q1 — a refused replay stays on this step, generic (003 EARS-16).
      setSucceeded(false);
      setError(authErrorMessage(err, errors, copy.failed));
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
      // A blocked submit is never a silent no-op (#904): with no address the
      // reason is the address, otherwise the code the FieldSpec rule refused.
      onInvalid={() =>
        setError(
          email ? resolvedCopy.fields.code.invalid : copy.missingIdentifier,
        )
      }
      error={error}
      succeeded={succeeded}
      // Same-site and relative, with the arrival target carried onward (rule S3).
      links={{
        login: withReturnTarget(config.routes.login, carriedTarget),
        reset: withReturnTarget(config.routes.reset, carriedTarget),
      }}
      renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
      // Only where an address is known: a bare deep-link has nothing to resend to.
      resend={
        email
          ? {
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
            }
          : undefined
      }
      testIds={VERIFY_TEST_IDS}
      returnContextSlot={returnContextPlate}
    />
  );
}

/** The confirm response of a command that names where the visitor goes (021 EARS-10). */
function isNamedLanding(
  response: unknown,
): response is Parameters<typeof resolveConfirmLanding>[0] {
  return (
    typeof response === "object" &&
    response !== null &&
    "primaryAction" in response
  );
}

/**
 * The block takes two lines as FUNCTIONS of a runtime value and a host config
 * holds only strings, so the config carries templates closed over here. The
 * description is split around its placeholder so the address stands in its own
 * `<strong>` inside the sentence.
 */
function cardCopyOf(copy: AuthFlowVerifyCopy): EmailConfirmCardCopy {
  const [before, after] = splitTemplate(copy.description, "destination");
  return {
    title: copy.title,
    description: (destination) => (
      <>
        {before}
        <strong>{destination}</strong>
        {after}
      </>
    ),
    newAccountHeading: copy.newAccountHeading,
    codeLabel: copy.codeLabel,
    submit: copy.submit,
    codeAccepted: copy.codeAccepted,
    resend: copy.resend,
    resendCountdown: (seconds) =>
      fillTemplate(copy.resendCountdown, "seconds", String(seconds)),
    existingAccountHeading: copy.existingAccountHeading,
    existingAccountHint: copy.existingAccountHint,
    goToSignIn: copy.goToSignIn,
    goToReset: copy.goToReset,
  };
}

/** Split a one-placeholder template into the text on either side of it. */
function splitTemplate(template: string, token: string): [string, string] {
  const marker = `{${token}}`;
  const at = template.indexOf(marker);
  if (at === -1) return [template, ""];
  return [template.slice(0, at), template.slice(at + marker.length)];
}

/** Substitute a template's single placeholder. */
function fillTemplate(template: string, token: string, value: string): string {
  return template.split(`{${token}}`).join(value);
}

/**
 * 021 EARS-11 — the code rule and its message come from ONE FieldSpec
 * projection, so the rule that rejects and the copy that explains cannot drift.
 * Client guard only: the confirm contract's `code` stays a plain string and the
 * 003 engine normalises again server-side. The slotted field itself keeps the
 * shipped code facts — 6 cells, a text keyboard, UPPERCASE normalisation.
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
