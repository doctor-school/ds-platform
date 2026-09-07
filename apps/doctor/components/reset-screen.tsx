"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  IdentifierFieldSchema,
  NewPasswordFieldSchema,
  OtpCodeFieldSchema,
} from "@ds/design-system/fields";
import {
  BotProtectionField,
  botProtectionFailureMessage,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  PasswordRecoveryCard,
  useBotProtectedAction,
  useResendCooldown,
  type PasswordRecoveryCardCopy,
  type PasswordRecoveryCompleteValues,
  type PasswordRecoveryRequestValues,
} from "@ds/design-system/blocks";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import {
  BOT_PROTECTION_MESSAGES,
  botProtectionSiteKey,
} from "@/lib/bot-protection";
import { makeResolver } from "@/lib/make-resolver";

/**
 * #1989 — the doctor storefront password-recovery screen (`doctor.school/reset`).
 *
 * A HOST PROJECTION, like `login-screen.tsx` beside it. The whole recovery
 * composition — card frame, both stage forms, the #267 resend footer with its
 * cooldown and the #326 neutral acknowledgement — lives ONCE in the
 * `@ds/design-system/blocks` `<PasswordRecoveryCard>` (#1666), and both
 * storefronts recover a password through that one implementation (AGENTS.md §6
 * cross-front reuse, ADR-0013 A1; registry row «Auth flows» in
 * `specs/product/two-site-ia/capability-ownership.md`). What this file adds is
 * only what a host may add: RU copy, the identifier/code/password guards, this
 * origin's transport, the EARS-16 outcome mapping and the post-completion route.
 * There is no doctor-local card and no second state machine.
 */

/**
 * WHY THE SURFACE EXISTS. Until now both doctor-host entrances to recovery — the
 * `/login` card's «Забыли пароль?» and the `/account` «Сменить пароль» row — sent
 * the doctor across to the Academy `academy.doctor.school/reset`, the
 * #1933/#1958 interim: the storefront had no recovery surface of its own, so the
 * only live one stood on the other host. The crossing was sanctioned but visible
 * — a doctor who came to change a password left the storefront and came back
 * signed in somewhere else. This closes it: recovery happens HERE, on this
 * origin, and both entrances are host-relative.
 *
 * TWO STEPS ON ONE ROUTE (003 EARS-11 initiate / EARS-12 complete). Request a
 * code for an identifier (email or phone — Zitadel resolves which), then submit
 * that code together with a new policy-conforming password. EARS-16: the
 * initiate answer is IDENTICAL whether or not an account exists, so the screen
 * always advances to the code step and nothing here may read existence out of
 * the response. `POST /v1/auth/password/reset` is `@BotProtected("password-reset")`,
 * so the initiate and the resend both run behind the shared invisible challenge
 * (021 EARS-19 glue in `lib/bot-protection.ts`) — nothing renders without a site
 * key, and the pending action resumes tokenless exactly as the backend guard
 * no-ops when the provider is disabled.
 *
 * WHERE COMPLETION LANDS. The BFF revokes every PRIOR session for the subject
 * and mints a fresh one on THIS origin (auto-login, #221 — the response sets the
 * `__Host-ds_session` cookie here), so the doctor goes straight to `/account`
 * rather than back to the door. `router.refresh()` rides along for the reason
 * `login-screen.tsx` states: the 017 shell reads the session SERVER-side
 * (`lib/shell-auth.ts`), so re-rendering the server tree — not the Academy's
 * client header-refresh helper — is what flips the header from the guest cluster
 * to the signed-in one.
 *
 * NO `next-intl`, BY DECISION, as everywhere else in this app: the copy below is
 * literal RU. The GUARDS are not re-invented either — `IdentifierFieldSchema`,
 * `OtpCodeFieldSchema` and `NewPasswordFieldSchema` are the shared field shapes
 * the Academy validates these same two forms with; only the sentence shown to
 * the doctor is doctor-owned.
 */

const IDENTIFIER_REQUIRED = "Введите почту или телефон.";
const IDENTIFIER_MALFORMED =
  "Проверьте: почта вида doctor@clinic.ru или телефон в формате +79991234567.";
const CODE_REQUIRED = "Введите код из письма.";
const PASSWORD_TOO_SHORT = "Пароль должен быть не короче 8 символов.";

/** The neutral EARS-16 outcome copy, one per recovery command. */
const REQUEST_FAILED =
  "Не удалось отправить код. Проверьте почту или телефон и повторите.";
const RESEND_FAILED = "Не удалось отправить код ещё раз. Попробуйте позже.";
const COMPLETE_FAILED =
  "Не удалось сменить пароль. Проверьте код и попробуйте ещё раз.";

/** EARS-11 — the union box: Zitadel resolves whichever identifier was typed. */
const requestResolver = makeResolver<PasswordRecoveryRequestValues>({
  identifier: (value) => {
    if (!value?.trim()) return IDENTIFIER_REQUIRED;
    return IdentifierFieldSchema.safeParse(value).success
      ? null
      : IDENTIFIER_MALFORMED;
  },
});

/**
 * EARS-12 — the code plus the new password. The identifier is not re-validated:
 * the host seeds it from the request the BFF already accepted, so the doctor
 * cannot have mistyped it here. The password bound is the 003 EARS-36
 * length-only rule through the shared field schema — this surface declares no
 * second policy, and Zitadel stays the authority.
 */
const completeResolver = makeResolver<PasswordRecoveryCompleteValues>({
  code: (value) =>
    OtpCodeFieldSchema.safeParse(value).success ? null : CODE_REQUIRED,
  newPassword: (value) =>
    NewPasswordFieldSchema.safeParse(value).success ? null : PASSWORD_TOO_SHORT,
});

/**
 * Every visible string on the surface, stated once. The wording is the doctor
 * storefront's own voice; the STRUCTURE is the block, which is why there is one
 * entry per slot and no free markup here. The reveal-toggle labels stay
 * unsupplied — the design-system default is already the RU copy the Academy
 * catalogue holds, and restating it would make a second source for one string.
 */
const COPY: PasswordRecoveryCardCopy = {
  title: "Восстановление пароля",
  titleComplete: "Новый пароль",
  descriptionRequest:
    "Укажите почту или телефон — пришлём код для смены пароля.",
  descriptionComplete: (destination) =>
    "Код отправлен на " +
    destination +
    ". Введите его и придумайте новый пароль.",
  backToSignIn: "Вернуться ко входу",
  request: {
    identifierLabel: "Почта или телефон",
    identifierPlaceholder: "doctor@clinic.ru",
    submit: "Прислать код",
  },
  complete: {
    codeLabel: "Код из письма",
    newPasswordLabel: "Новый пароль",
    passwordPolicyHint: "Не короче 8 символов.",
    submit: "Сменить пароль",
    startOver: "Начать заново",
    resend: "Прислать код ещё раз",
    resendCountdown: (seconds) =>
      "Отправить снова можно через " + seconds + " с",
  },
};

export function ResetScreen() {
  const router = useRouter();

  const [stage, setStage] = useState<"request" | "complete">("request");
  // The identifier the code actually went to — carried into the complete step,
  // which the block masks in its «код отправлен на …» line. Set only after the
  // BFF ACCEPTED the command, so the screen never asserts a destination the
  // server did not take.
  const [identifier, setIdentifier] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCaptchaError, setResendCaptchaError] = useState<string | null>(
    null,
  );
  // #326: neutral, enumeration-safe resend acknowledgement. The on-screen
  // response is generic and IDENTICAL whether or not an account exists — the
  // account-exists fact is disclosed out of band by email, never on screen.
  const [notice, setNotice] = useState<string | null>(null);

  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(
        botProtectionFailureMessage(failure, BOT_PROTECTION_MESSAGES),
      ),
    onActionError: (error) => {
      // 003 EARS-17 — a token the guard refused, or a request that arrived
      // without one. Reported as the challenge statement rather than as a
      // recovery failure, because retrying the challenge is what fixes it.
      if (isBotProtectionRejected(error) || isBotProtectionRequired(error)) {
        setCaptchaError(
          isBotProtectionRejected(error)
            ? BOT_PROTECTION_MESSAGES.rejected
            : BOT_PROTECTION_MESSAGES.required,
        );
        return;
      }
      setRequestError(authErrorMessage(error, REQUEST_FAILED));
    },
  });

  const resendCaptcha = useBotProtectedAction({
    onVerified: () => setResendCaptchaError(null),
    onChallengeError: (failure) =>
      setResendCaptchaError(
        botProtectionFailureMessage(failure, BOT_PROTECTION_MESSAGES),
      ),
    onActionError: (error) =>
      setResendError(authErrorMessage(error, RESEND_FAILED)),
  });

  // #267 resend: re-request a code for the SAME held identifier through the
  // EXISTING initiate call (no second endpoint, and EARS-16 keeps the ack
  // identical, so a resend leaks nothing either). Bumping the nonce restarts the
  // block's cooldown and clears the now-stale typed code.
  const { resendNonce, onResend, resetNonce } = useResendCooldown({
    resend: async (captchaToken) => {
      await authClient.requestPasswordReset({
        identifier,
        ...(captchaToken ? { captchaToken } : {}),
      });
    },
    onError: (error) => {
      if (isBotProtectionRejected(error) || isBotProtectionRequired(error)) {
        setResendCaptchaError(
          isBotProtectionRejected(error)
            ? BOT_PROTECTION_MESSAGES.rejected
            : BOT_PROTECTION_MESSAGES.required,
        );
        return;
      }
      setResendError(authErrorMessage(error, RESEND_FAILED));
    },
    // Clear only resend-owned state; completion feedback answers another question.
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
    },
    onSuccess: () =>
      setNotice("Отправили код ещё раз на " + maskDestination(identifier) + "."),
  });

  function onRequest(values: PasswordRecoveryRequestValues) {
    setRequestError(null);
    const value = values.identifier.trim();
    captcha.request(async (captchaToken) => {
      await authClient.requestPasswordReset({
        identifier: value,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // EARS-16: the acknowledgement is identical whether or not the identifier
      // exists, so the screen ALWAYS advances. Carry the identifier into the
      // complete step — the block mounts a FRESH form for the stage, so its code
      // field is registered on that form's first render, never seeded post hoc.
      setIdentifier(value);
      setStage("complete");
    });
  }

  async function onComplete(values: PasswordRecoveryCompleteValues) {
    setCompleteError(null);
    try {
      await authClient.completePasswordReset({ ...values, identifier });
      // #221: the response auto-logged us in ON THIS ORIGIN, so go straight to
      // the authenticated area; `refresh()` re-renders the server tree so the
      // 017 header shows the signed-in cluster (`lib/shell-auth.ts`).
      router.push("/account");
      router.refresh();
    } catch (error) {
      setCompleteError(authErrorMessage(error, COMPLETE_FAILED));
    }
  }

  /**
   * «Начать заново»: back to the request step so the doctor can correct a
   * mistyped identifier and ask for a fresh code. The block remounts the request
   * form, so its field comes back empty; what the HOST holds is cleared here,
   * because that unmount cannot reach it.
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
    <div data-testid="reset-screen" className="flex w-full flex-col gap-4.5">
      <PasswordRecoveryCard
        icon={<KeyGlyph />}
        copy={COPY}
        stage={stage}
        identifier={identifier}
        // Recovery ends at the door it came from — this host's own `/login`,
        // never the Academy's: the crossing is what this slice removes.
        links={{ login: "/login" }}
        // Next.js `<Link>` keeps the footer link on client-side navigation.
        renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
        request={{
          resolver: requestResolver,
          onSubmit: onRequest,
          error: captchaError ?? requestError,
          pending: captcha.pending,
          captchaSlot: (
            <BotProtectionField
              sitekey={botProtectionSiteKey()}
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
              sitekey={botProtectionSiteKey()}
              {...resendCaptcha.fieldProps}
            />
          ),
        }}
      />
    </div>
  );
}

/**
 * The card-head glyph. Drawn inline rather than pulled from an icon package, for
 * the reason `login-screen.tsx` states: `apps/doctor` ships no icon dependency,
 * and adding one for a single decorative mark is a heavier change than the mark.
 * Purely decorative — the heading carries the meaning.
 */
function KeyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <circle cx="8" cy="12" r="4" strokeWidth="2" />
      <path d="M12 12h9" strokeWidth="2" strokeLinecap="square" />
      <path d="M17 12v4" strokeWidth="2" strokeLinecap="square" />
      <path d="M20.5 12v3" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
