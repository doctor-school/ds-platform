"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { DoctorConfirmRequest, DoctorConfirmResponse } from "@ds/schemas";
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
  type EmailConfirmValues,
} from "@ds/design-system/blocks";

import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { completeReturnTarget } from "../client/return-completion";
import { authErrorMessage } from "../errors";
import { resolveVerificationCode } from "../fields";
import type {
  AuthFlowHostConfig,
  AuthFlowRegisterConfirmCopy,
} from "../host-config";
import { withReturnContext } from "../return-context-href";
import { resolveConfirmLanding } from "./confirm-landing";
import type { RegisterConfirmationProps } from "./register-door";

/**
 * 021 EARS-19 / 003 EARS-3 + EARS-25 — the post-submit state of the shared
 * registration door, and the SECOND bot-protected surface this Issue owns.
 *
 * Rows 51 + 76: a host that serves a `/verify` route of its own hands the
 * address to it, and a host that serves none confirms it HERE, on the door
 * itself. That is a host FACT (`routes.verify`), never a branch — which is why
 * this unit is a separate module the door mounts rather than a mode inside it.
 *
 * The composition is not written here: `EmailConfirmCard` is the ONE canonical
 * email-confirmation block both storefronts mount (#1902, AGENTS.md §6
 * cross-front reuse), so this is a projection of it — the host's words, the code
 * resolver, and the transport. The code ENGINE is 003's shipped one, unchanged:
 * the storefront confirm command delegates to it and a resend goes straight to
 * the bot-protected resend route, which is why every resend mints its own token
 * through the same challenge the registration submit ran.
 *
 * Its own `useBotProtectedAction`, separate from the registration form's: the
 * form is gone by the time this renders, and a resend is a different protected
 * action with a different failure channel.
 *
 * WHAT THIS UNIT DOES NOT DECIDE (#1549, EARS-13): the co-equal
 * already-registered affordances the block renders point at THIS host's own
 * `routes.login` and `routes.reset` — same-site relative, never a hand-off to a
 * sibling storefront origin, which is a separate site.
 *
 * WHERE A CONFIRMED VISITOR LANDS (#1546, EARS-10) is decided here, which is why
 * the code goes to the STOREFRONT confirm command rather than the bare 003
 * verify route: that command runs the same 003 engine and answers with the 021
 * success state, so ONE round trip both accepts the code and names the
 * destination — a client that called both routes would verify the code twice.
 *
 * On success this surface NAVIGATES (021 EARS-10, amended 2026-09-17): the
 * confirmed visitor is replaced onto the honoured target itself, with no
 * interstitial to acknowledge. A rejected code stays on the EARS-16 generic
 * failure — the confirm command is no more of an oracle than the 003 route it
 * delegates to.
 */
export function RegistrationConfirmation({
  config,
  email,
  landing,
  returnTarget,
  carriedTarget,
}: RegisterConfirmationProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = confirmCopyOf(config);
  const captchaCopy = botProtectionMessages(config);
  const authClient = useMemo(() => createAuthClient(config.api), [config.api]);
  const cardCopy = useMemo(() => cardCopyOf(copy), [copy]);
  const resolver = useMemo(() => confirmResolver(config), [config]);
  const destination = maskDestination(email);
  const carried = carriedTarget ?? undefined;

  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(botProtectionFailureMessage(failure, captchaCopy)),
    onActionError: () => setResendError(copy.resendFailed),
  });

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
      setResendError(copy.resendFailed);
    },
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
    },
    // 003 EARS-16 — the acknowledgement is conditionally phrased, so it is the
    // same sentence for a registrant, a stranger and an already-verified owner.
    onSuccess: () =>
      setNotice(
        fillTemplate(copy.resendAcknowledged, "destination", destination),
      ),
  });

  async function onSubmit(values: EmailConfirmValues) {
    setError(null);
    let confirmed: DoctorConfirmResponse;
    try {
      // Mapped field by field rather than cast: a future field on the confirm
      // contract must fail typecheck here instead of shipping a silent omission.
      // `returnTo` rides the SAME command as the code, so the server decides the
      // destination with the verification it just performed — there is no second
      // hop in which the target could go stale unobserved.
      confirmed = await authClient.confirm<
        DoctorConfirmRequest,
        DoctorConfirmResponse
      >({
        email: values.email,
        code: values.code,
        ...(returnTarget ? { returnTo: returnTarget } : {}),
      });
    } catch (err) {
      // Only the CODE failing keeps the visitor on this screen: it is the one
      // failure they can act on from here, by typing the code again. Everything
      // below has already accepted the code, so it can no longer produce this
      // state (003 EARS-16 — the message stays generic either way).
      //
      // #2001 (gate row 13): the outcome is still the generic sentence, but the
      // status decides — a 429 from the confirm route says «too many attempts»
      // in this host's words instead of blaming a code that was typed correctly,
      // and a 5xx says the service is down.
      setError(authErrorMessage(err, config.copy.errors, copy.failed));
      return;
    }

    // 021 EARS-15 / 003 EARS-39 (#1996) — the confirm route verifies the email
    // and mints NO session (by contract, same as 003 EARS-3), so a visitor sent
    // onward from here would land on the эфир as a guest and be asked to
    // register again. The rule: replay the REAL 003 EARS-5 password login with
    // the held credential — the session still comes from the login route, never
    // from confirm — and let the ONWARD NAVIGATION EXIST ONLY FOR A VISITOR WHO
    // IS SIGNED IN.
    //
    // No held credential (a reload, a restored tab, an expired hold) or a replay
    // the login refuses (the classic case: the same address re-registered with a
    // SECOND password, so the slot holds a credential the IdP never took — 003
    // EARS-16 answers a repeat registration identically) both mean the same
    // thing: the email is verified and there is no session. That visitor goes to
    // the sign-in door carrying their return context, NOT onward to the эфир,
    // which would walk them in as a guest and back through the registration loop
    // this rule exists to close. The slot is wiped by the take whether the
    // replay then succeeds or throws.
    const held = takePendingRegistration(email);
    if (held) {
      try {
        await authClient.login({
          identifier: held.identifier,
          password: held.password,
        });
        // 005 EARS-2 (#2005) — the session exists now, so the эфир the visitor
        // came from is COMPLETED before they are sent anywhere: they pressed
        // «Участвовать» on a gated эфир and were sent here to make an account,
        // and an account without the registration is not what they asked for.
        // The decision is the ONE shared rule (`completeReturnTarget`) read
        // through this host's config. The landing it returns is not the one
        // used: it is computed from the carried target alone, while the confirm
        // response was produced by the round trip that just re-validated that
        // target and therefore knows whether it went stale. Best-effort by that
        // rule's contract: a refusal still lands the visitor, and the эфир
        // page's per-viewer participation read (005 EARS-4) tells the truth.
        await completeReturnTarget(config, returnTarget ?? null, landing);
        // 021 EARS-10 (amended 2026-09-17) — direct navigation, no success card.
        // `replace`, not `push`: the confirmation screen is spent, and a back
        // gesture from the эфир must not return the visitor to a code form whose
        // code has already been consumed.
        router.replace(resolveConfirmLanding(confirmed, landing));
        return;
      } catch {
        // Fall through to the sign-in door below — the same exit as no hold at
        // all, because the visitor is in the same position: verified, not signed
        // in, and holding a password only they can now supply.
      }
    }
    // Rule S3 — the CARRY value, not the эфир-only confirm intent: a visitor who
    // arrived here from a closed page has no `returnTarget` at all, and building
    // this hop from it sent them to a bare door.
    router.push(withReturnContext(config, config.routes.login, carried));
  }

  return (
    <EmailConfirmCard
      icon={<ConfirmationGlyph />}
      copy={cardCopy}
      email={email}
      destination={destination}
      resolver={resolver}
      onSubmit={onSubmit}
      onInvalid={() => setError(config.copy.fields.code.invalid)}
      error={error}
      // Same-site, relative: a storefront is its own site and hands a visitor
      // off to no other one — and rule S3: both hops carry the arrival target
      // onward, through the shared helper, so a visitor who lands here and steps
      // sideways into sign-in or recovery is still on their way to the page they
      // asked for.
      links={{
        login: withReturnContext(config, config.routes.login, carried),
        reset: withReturnContext(config, config.routes.reset, carried),
      }}
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
    />
  );
}

/**
 * This host's inline-confirmation sentences, or a loud failure.
 *
 * The copy is optional on the config because a host with a `/verify` route of
 * its own states none (rows 51, 76): stating it there would be a claim about a
 * step that host never runs. A host that reaches THIS unit without the words is
 * a wiring mistake, and it must read as one at the boundary rather than as a
 * card full of blanks.
 */
function confirmCopyOf(
  config: AuthFlowHostConfig,
): AuthFlowRegisterConfirmCopy {
  const copy = config.copy.register?.confirm;
  if (!copy) {
    throw new Error("auth-flow: this host states no inline confirmation copy");
  }
  return copy;
}

/**
 * The block's copy takes two of its lines as FUNCTIONS of a runtime value, and a
 * host config can hold only strings — so the config carries templates and this
 * projection closes them over the value. The description is split around its
 * placeholder rather than interpolated, which keeps the shipped render exactly:
 * the address stands in its own `<strong>`, emphasised inside the sentence.
 */
function cardCopyOf(copy: AuthFlowRegisterConfirmCopy): EmailConfirmCardCopy {
  const [beforeDestination, afterDestination] = splitTemplate(
    copy.description,
    "destination",
  );
  return {
    title: copy.title,
    description: (destination) => (
      <>
        {beforeDestination}
        <strong>{destination}</strong>
        {afterDestination}
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

/**
 * Split a one-placeholder template into the text on either side of it. A
 * template that omits the placeholder keeps its whole text and renders nothing
 * around the value — the host stated a sentence that does not name the address,
 * and this projection does not invent a place for it.
 */
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
 * 021 EARS-11 — the code field's rule and its message come from the same
 * FieldSpec projection (`resolveVerificationCode`), so the rule that rejects and
 * the copy that explains cannot drift apart.
 *
 * The REQUEST contract stays loose by design (the confirm schema's `code` is a
 * plain string, LD-1): this length/charset vocabulary is the client guard only,
 * and the 003 engine normalises again server-side.
 */
function confirmResolver(
  config: AuthFlowHostConfig,
): NonNullable<EmailConfirmCardProps["resolver"]> {
  return (values) => {
    const message = resolveVerificationCode(config, values.code);
    return message === null
      ? { values, errors: {} }
      : { values: {}, errors: { code: { type: "validate", message } } };
  };
}

/**
 * The confirmation card's glyph — an envelope, drawn inline for the same reason
 * the registration glyph is: the design system carries no icon set, and this
 * mark is the same drawing on every host. Decorative only; the heading carries
 * the meaning.
 */
function ConfirmationGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <path
        d="M3 5h18v14H3zM3 6l9 7 9-7"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
