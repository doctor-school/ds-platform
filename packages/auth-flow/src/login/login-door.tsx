"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { type LoginRequest, type OtpChannel } from "@ds/schemas";
import {
  botProtectionFailureMessage,
  BotProtectionField,
  isBotProtectionRejected,
  isBotProtectionRequired,
  LoginCard,
  useBotProtectedAction,
  type LoginCardCopy,
  type LoginCardOtpChannel,
  type LoginCardOtpProps,
  type LoginCardOtpRequestValues,
  type LoginCardOtpVerifyValues,
  type LoginCardPasswordProps,
  type LoginCardPasswordValues,
} from "@ds/design-system/blocks";
import { OtpCodeFieldSchema } from "@ds/design-system/fields";

import { resolveAuthFlowCopy } from "../copy";
import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { completeReturnTarget } from "../client/return-completion";
import { authErrorMessage } from "../errors";
import { identifierFieldSchema, otpIdentifierFormSchema } from "../fields";
import { makeResolver } from "../form-resolver";
import type { AuthFlowHostConfig } from "../host-config";
import { withReturnTarget } from "../return-target-href";
import { LoginGlyph } from "./login-glyph";
import type { ReactNode } from "react";

/**
 * The ONE client sign-in door of the platform (#2027 PR 1.5, gate rows 21, 33–46).
 *
 * Both storefronts sign in through THIS component; what differs between them is
 * data — `AuthFlowHostConfig` — and never a branch. The card frame, method tabs,
 * password form, OTP request form and the #227 focus screen are the design-system
 * `<LoginCard>` block (ADR-0013 A1); what the door adds is the composition the two
 * hosts used to own twice: the live BFF calls (003 F2 password / F3 OTP), the
 * bot-protection retry-once orchestration, the EARS-16 outcome mapping, the
 * resolvers, and the post-login routing.
 *
 * On success the BFF sets the `__Host-ds_session` cookie and the door routes to
 * the carried target or the landing; no token ever touches this client (003
 * EARS-8). Two journeys live here: password sign-in (003 EARS-5) and the
 * passwordless sign-in code (003 EARS-6 email / EARS-7 SMS).
 *
 * 005 EARS-2: a visitor carried in from an event's «Участвовать» CTA arrives with
 * a return target. On success — password or OTP — the carried registration
 * completes and the visitor lands on that event page registered; the footer links
 * carry the context onward into `/register` and `/reset` (rule S3: recovery is an
 * INTERRUPTION of wherever this visitor was going). A hostile value is refused by
 * the same same-origin guard at every consumption point.
 */
export type LoginDoorProps = {
  /** Everything that differs between the two storefronts (rows 21, 33–46). */
  config: AuthFlowHostConfig;
  /**
   * Where a visitor with NO carried target lands — resolved on the SERVER by the
   * mount, because a host may decide it per visitor (the doctor storefront's
   * specialty-aware feed). Published on the root element so the decision is
   * readable rather than recomputed here.
   */
  landing: string;
  /**
   * The RAW carried `returnTo` param, for the footer LINKS only. Guarded here by
   * the same-origin rule before it decorates anything, so a hostile value is
   * never propagated onward.
   */
  returnTo?: string | null;
  /**
   * The completion target: the mount's own guard-reconstructed projection of the
   * arrival, in THIS host's vocabulary. The Academy's raw param already is that
   * value; the doctor mount projects the academy-shaped `/webinars/<slug>` gate
   * param onto its own `/events/<slug>` before handing it over. Absent on a
   * direct arrival, and then the landing simply stands.
   */
  returnTarget?: string | null;
  /** The gate context the visitor arrived from — the plate beside the form (021 EARS-2). */
  returnContextPlate?: ReactNode;
};

/** EARS-5 — the identifier box this host serves, plus the length-only password rule. */
function passwordResolverOf(
  config: AuthFlowHostConfig,
): LoginCardPasswordProps["resolver"] {
  const identifier = identifierFieldSchema(config);
  const { fields, login } = resolveAuthFlowCopy(config);
  return makeResolver<
    LoginCardPasswordValues,
    LoginCardPasswordProps["resolver"]
  >({
    identifier: (value) => {
      if (!value?.trim()) {
        return fields.identifier.required ?? fields.identifier.invalid;
      }
      return identifier.safeParse(value).success
        ? null
        : fields.identifier.invalid;
    },
    // Length only — 003 EARS-36 owns the password policy and no surface may
    // declare a second one. The credential authority is the BFF, not this form.
    password: (value) =>
      value?.length ? null : login.password.passwordRequired,
  });
}

/** EARS-6/7 — the ACTIVE channel decides the shape: an email box or an E.164 box. */
function otpRequestResolverOf(
  config: AuthFlowHostConfig,
  channel: LoginCardOtpChannel,
): LoginCardOtpProps["requestResolvers"][LoginCardOtpChannel] {
  const schema = otpIdentifierFormSchema(config, channel as OtpChannel);
  const fields = resolveAuthFlowCopy(config).fields;
  const copy = channel === "email" ? fields.email : fields.phone;
  return makeResolver<
    LoginCardOtpRequestValues,
    LoginCardOtpProps["requestResolvers"][LoginCardOtpChannel]
  >({
    identifier: (value) => {
      if (!value?.trim()) {
        return (
          copy.required ??
          fields.identifier.required ??
          copy.invalid
        );
      }
      // The channel rides the parse so the host's served-channel rule (row 21)
      // decides the shape; only the identifier's own verdict is rendered, the
      // way both hosts render it today.
      const parsed = schema.safeParse({ identifier: value, channel });
      const rejected =
        !parsed.success &&
        parsed.error.issues.some((issue) => issue.path[0] === "identifier");
      return rejected ? copy.invalid : null;
    },
  });
}

/** The focus-screen code box — the shape is the contract's, the sentence the host's. */
function otpVerifyResolverOf(
  config: AuthFlowHostConfig,
): LoginCardOtpProps["verifyResolver"] {
  return makeResolver<
    LoginCardOtpVerifyValues,
    LoginCardOtpProps["verifyResolver"]
  >({
    code: (value) =>
      OtpCodeFieldSchema.safeParse(value).success
        ? null
        : resolveAuthFlowCopy(config).login.otp.codeInvalid,
  });
}

/**
 * The host's login sentences, projected onto the block's copy slots. The two
 * `{…}`-templated lines are interpolated here rather than in the config, because
 * the block hands over a value (the masked destination, the remaining seconds)
 * that only exists at render time.
 */
function loginCardCopyOf(config: AuthFlowHostConfig): LoginCardCopy {
  const copy = resolveAuthFlowCopy(config).login;
  return {
    title: copy.title,
    description: copy.description,
    createAccount: copy.createAccount,
    forgotPassword: copy.forgotPassword,
    methodSwitcherLabel: copy.methodSwitcherLabel,
    methodPassword: copy.methodPassword,
    methodOtp: copy.methodOtp,
    password: {
      formLabel: copy.password.formLabel,
      identifierLabel: copy.password.identifierLabel,
      identifierPlaceholder: copy.password.identifierPlaceholder,
      passwordLabel: copy.password.passwordLabel,
      // 003 EARS-38: the reveal toggle copy rides the host catalog where the
      // host states one; ABSENT — spread, not `undefined` — leaves the
      // design-system RU default, which is a different thing from "no labels".
      ...(copy.password.reveal ? { reveal: copy.password.reveal } : {}),
      submit: copy.password.submit,
    },
    otp: {
      formLabel: copy.otp.formLabel,
      heading: copy.otp.heading,
      description: copy.otp.description,
      channelGroupLabel: copy.otp.channelGroupLabel,
      channelEmail: copy.otp.channelEmail,
      channelSms: copy.otp.channelSms,
      emailLabel: copy.otp.emailLabel,
      emailPlaceholder: copy.otp.emailPlaceholder,
      phoneLabel: copy.otp.phoneLabel,
      phonePlaceholder: copy.otp.phonePlaceholder,
      sendCode: copy.otp.sendCode,
      verifyTitle: copy.otp.verifyTitle,
      sentTo: (destination) =>
        copy.otp.sentTo.replace("{destination}", destination),
      codeLabel: copy.otp.codeLabel,
      verifySubmit: copy.otp.verifySubmit,
      resend: copy.otp.resend,
      resendCountdown: (seconds) =>
        copy.otp.resendCountdown.replace("{seconds}", String(seconds)),
      changeMethod: copy.otp.changeMethod,
    },
  };
}

export function LoginDoor({
  config,
  landing,
  returnTo = null,
  returnTarget = null,
  returnContextPlate,
}: LoginDoorProps) {
  const router = useRouter();
  const { errors, login } = resolveAuthFlowCopy(config);
  const failed = login.failed;
  // One client per host config — the paths are bound once at this boundary, so
  // every call below stays path-free (rows 6–8).
  const authClient = useMemo(() => createAuthClient(config.api), [config.api]);

  // ---- EARS-5 password login -------------------------------------------------
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordCaptchaError, setPasswordCaptchaError] = useState<
    string | null
  >(null);
  const passwordCaptcha = useBotProtectedAction({
    onVerified: () => setPasswordCaptchaError(null),
    onChallengeError: (failure) =>
      setPasswordCaptchaError(
        botProtectionFailureMessage(failure, botProtectionMessages(config)),
      ),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setPasswordCaptchaError(errors.botProtectionRejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setPasswordCaptchaError(errors.botProtectionRequired);
        return;
      }
      setPasswordError(authErrorMessage(err, errors, failed.password));
    },
  });

  async function finishLogin(values: LoginRequest, captchaToken?: string) {
    // Row 18: the captcha token travels as the `x-smartcaptcha-token` HEADER the
    // package sets, never as a body field — one carrier on both storefronts.
    await authClient.login(values, captchaToken);
    // The BFF set the `__Host-` cookie; the session shell reads it server-side.
    // 005 EARS-2: with a carried context the session now exists, so the carried
    // registration completes and the visitor lands back on that event page;
    // without one this is the 008 EARS-7 discovery front-door landing, which the
    // MOUNT resolved (a host may decide it per visitor) and the door honours.
    // #1004: the navigation renders the persistent header on the server again,
    // which reads the new session — the avatar appears without a hard reload.
    router.push(await completeReturnTarget(config, returnTarget, landing));
    // 008 EARS-5 (#2281): pages seen as a guest sit in the client Router Cache
    // with the guest `@chrome` header, and browser Back replays them. Dropping
    // the cache makes Back re-read the header from the server.
    router.refresh();
  }

  async function onPasswordSubmit(values: LoginCardPasswordValues) {
    setPasswordError(null);
    setPasswordCaptchaError(null);
    try {
      await finishLogin(values);
    } catch (err) {
      if (isBotProtectionRequired(err)) {
        // Retry ONCE with the ORIGINAL values: the challenge resumes the action
        // the visitor already submitted, never a re-read of a mutated form.
        const original = {
          identifier: values.identifier,
          password: values.password,
        };
        passwordCaptcha.request((captchaToken) =>
          finishLogin(original, captchaToken),
        );
        return;
      }
      // EARS-16: the login OUTCOME (wrong credential / unknown account) stays the
      // generic sentence so the UI never leaks an existence/error oracle. Only
      // the non-oracle statuses get a specific message: 429 → too-many-attempts,
      // 5xx/network → temporarily-unavailable.
      setPasswordError(authErrorMessage(err, errors, failed.password));
    }
  }

  // ---- EARS-6/7 passwordless sign-in code ------------------------------------
  // The block owns the channel selection and hands it back on every handler call;
  // the door owns the stage (a code is "sent" only once the protected request
  // actually succeeded — the bot-protection callback is the only place that knows).
  const [sentIdentifier, setSentIdentifier] = useState<string | null>(null);
  // #266: a successful resend bumps this nonce, which restarts the focus-screen
  // cooldown and clears the superseded typed code WITHOUT a remount.
  const [resendNonce, setResendNonce] = useState(0);
  const [otpRequestError, setOtpRequestError] = useState<string | null>(null);
  const [otpCaptchaError, setOtpCaptchaError] = useState<string | null>(null);
  const [otpVerifyError, setOtpVerifyError] = useState<string | null>(null);
  const otpCaptcha = useBotProtectedAction({
    onVerified: () => setOtpCaptchaError(null),
    onChallengeError: (failure) =>
      setOtpCaptchaError(
        botProtectionFailureMessage(failure, botProtectionMessages(config)),
      ),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setOtpCaptchaError(errors.botProtectionRejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setOtpCaptchaError(errors.botProtectionRequired);
        return;
      }
      setOtpRequestError(authErrorMessage(err, errors, failed.otpRequest));
    },
  });

  async function sendOtp(
    identifier: string,
    channel: LoginCardOtpChannel,
    captchaToken?: string,
  ) {
    await authClient.requestOtp(
      { identifier, channel: channel as OtpChannel },
      captchaToken,
    );
  }

  function onOtpRequest(values: LoginCardOtpRequestValues) {
    setOtpRequestError(null);
    otpCaptcha.request(async (captchaToken) => {
      await sendOtp(values.identifier, values.channel, captchaToken);
      // Carry the identifier into the focus screen (the BFF re-resolves it on
      // verify); flipping it non-null is what mounts the verify stage.
      setSentIdentifier(values.identifier);
      setResendNonce(0);
    });
  }

  // #227/#266 resend: re-request the SAME identifier+channel code. On success bump
  // the nonce (the focus screen restarts its cooldown + the verify form clears the
  // stale code, both without a remount); on failure surface the error and stay.
  function onOtpResend(values: LoginCardOtpRequestValues) {
    setOtpRequestError(null);
    otpCaptcha.request(async (captchaToken) => {
      await sendOtp(values.identifier, values.channel, captchaToken);
      setResendNonce((n) => n + 1);
    });
  }

  async function onOtpVerify(values: LoginCardOtpVerifyValues) {
    setOtpVerifyError(null);
    try {
      // Mapped field-by-field, not cast: the block's structural values type and
      // the `OtpVerify` contract coincide today, and a future field on the
      // contract must fail typecheck HERE rather than ship a silent omission.
      await authClient.loginWithOtp({
        identifier: values.identifier,
        code: values.code,
        channel: values.channel as OtpChannel,
      });
      // 005 EARS-2: complete the carried registration (if any) now the session
      // exists, landing on the event page — else the resolved landing.
      router.push(await completeReturnTarget(config, returnTarget, landing));
      router.refresh();
    } catch (err) {
      setOtpVerifyError(authErrorMessage(err, errors, failed.otpVerify));
    }
  }

  function resetOtpStage() {
    setSentIdentifier(null);
    setOtpRequestError(null);
    setOtpCaptchaError(null);
    setOtpVerifyError(null);
  }

  // EARS-17: switching method is a TERMINAL path for anything in flight. The
  // block unmounts the inactive tab and so drops its own state; these calls clear
  // the state the door holds — errors, the issued-code stage, and any challenge
  // in flight. Without the `reset()` calls a dismissed challenge would keep its
  // stored closure and replay it (a duplicate `requestOtp`, or a login the
  // visitor never re-submitted) when the field remounts on return to the tab.
  function onMethodChange() {
    setPasswordError(null);
    setPasswordCaptchaError(null);
    passwordCaptcha.reset();
    otpCaptcha.reset();
    resetOtpStage();
  }

  // ---- resolvers and copy (config-owned: the host's rules AND its sentences) --
  const passwordResolver = useMemo(() => passwordResolverOf(config), [config]);
  const requestResolvers = useMemo(
    () => ({
      email: otpRequestResolverOf(config, "email"),
      sms: otpRequestResolverOf(config, "sms"),
    }),
    [config],
  );
  const verifyResolver = useMemo(() => otpVerifyResolverOf(config), [config]);
  const copy = useMemo(() => loginCardCopyOf(config), [config]);

  // Rendered on BOTH hosts and across both stages: the challenge is the api
  // guard's, not one storefront's, and the element is a no-op wherever the host
  // configures no site key (the dev stand) — data, never a branch.
  const captchaSlot = (
    fieldProps: Omit<Parameters<typeof BotProtectionField>[0], "sitekey">,
  ) => (
    <BotProtectionField
      sitekey={botProtectionSiteKey(config)}
      {...fieldProps}
    />
  );

  return (
    <div
      data-testid="login-screen"
      // The server landing decision, carried on the element the command belongs
      // to — the same read model and vocabulary `/register` publishes as
      // `data-registration-landing` (021 LD-3/LD-4).
      data-login-landing={landing}
      className="flex w-full flex-col gap-4.5"
    >
      {/* Supplied or absent, never an empty frame (021 EARS-3 honest-empty rule). */}
      {returnContextPlate ? (
        <div data-testid="login-return-context">{returnContextPlate}</div>
      ) : null}

      <LoginCard
        icon={<LoginGlyph icon={config.brand.loginIcon} />}
        copy={copy}
        // 005 EARS-2: signup is a co-equal auth path — the arrival context rides
        // onward into /register so it survives this hop too.
        // Rule S3 (#2027): «Забыли пароль» carries the same context — recovery is
        // an INTERRUPTION of wherever this visitor was going, and `/reset` reads
        // the param back for both its own exit and its landing.
        links={{
          register: withReturnTarget(config.routes.register, returnTo),
          reset: withReturnTarget(config.routes.reset, returnTo),
        }}
        // Next.js `<Link>` keeps the footer links on client-side navigation.
        renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
        onMethodChange={onMethodChange}
        password={{
          resolver: passwordResolver,
          onSubmit: onPasswordSubmit,
          error: passwordCaptchaError ?? passwordError,
          pending: passwordCaptcha.pending,
          captchaSlot: captchaSlot(passwordCaptcha.fieldProps),
        }}
        otp={{
          // Row 21 — the channels this host serves; a one-channel host draws no
          // channel row at all (the same list gates the identifier schema).
          channels: config.channels,
          requestResolvers,
          verifyResolver,
          sentIdentifier,
          resendNonce,
          error: otpCaptchaError ?? otpRequestError,
          screenError: otpCaptchaError ?? otpRequestError ?? otpVerifyError,
          pending: otpCaptcha.pending,
          captchaSlot: captchaSlot(otpCaptcha.fieldProps),
          onRequest: onOtpRequest,
          onResend: onOtpResend,
          onVerify: onOtpVerify,
          onChangeMethod: resetOtpStage,
        }}
      />
    </div>
  );
}
