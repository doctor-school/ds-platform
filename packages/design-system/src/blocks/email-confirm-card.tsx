"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";

import { FormError, FormField, Form } from "../primitives/form";
import { AuthCard } from "./auth-card";
import { OtpFocusScreen } from "./otp-focus-screen";

/**
 * `<EmailConfirmCard>` — the post-registration code step both storefronts mount
 * on `/verify` (003 EARS-24 amended, EARS-42; ADR-0013 A1). It is the canvas
 * «ШАГ КОДА» (`design-source/auth.dc.html` 64-85) in its own card: heading
 * «Проверьте почту», «Мы отправили код на <address as typed>.», the SAME
 * `<OtpFocusScreen>` the sign-in card draws once a code was sent, and the
 * «← Изменить почту» back control. A new and an already-registered address get
 * the identical step — it never branches on existence (003 EARS-16), and there
 * is no co-equal «Уже регистрировались?» block any more.
 *
 * What lives HERE: the `<AuthCard>` frame with the #1035 `<h1>` landmark, the
 * one operation-error plate above the title (canvas 53-56), the RHF code form
 * with the #175 guarded auto-submit, and the resend wiring the step draws.
 *
 * What stays in the HOST: copy, the resolver, BFF transport (the code submit
 * and the EARS-25 resend), the destination, routing (including where
 * «back» goes) and the bot-protection element (a slot).
 */

/** Resend cooldown (#227/#267) — the same timer the sign-in code step runs. */
export const EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS = 30;

/** The address is carried, only the code is typed. */
export interface EmailConfirmValues {
  email: string;
  code: string;
}

/** Every visible string the block renders. No copy lives in the package (#235). */
export interface EmailConfirmCardCopy {
  title: React.ReactNode;
  /** Rich description — the host may embed markup around the destination. */
  description: (destination: string) => React.ReactNode;
  codeLabel: string;
  submit: React.ReactNode;
  /** Success row shown once the server accepted the code. */
  codeAccepted: React.ReactNode;
  resend: React.ReactNode;
  resendCountdown: (seconds: number) => React.ReactNode;
  /** «← Изменить почту». */
  back: React.ReactNode;
}

/** #267/EARS-25 resend wiring. */
export interface EmailConfirmResendProps {
  /** Bumped by the host on each SUCCESSFUL resend — restarts the cooldown. */
  nonce: number;
  /** Fire-and-forget: the host's protected resend bumps `nonce` on success. */
  onResend: () => void;
  /** Already-localized resend/captcha error — said in the one plate. */
  error?: React.ReactNode | undefined;
  /** Host-side pending signal (an in-flight captcha challenge). */
  pending?: boolean | undefined;
  /** The after-resend notice (host-composed copy, canvas 81-83). */
  notice?: React.ReactNode | undefined;
  /** The host's bot-protection element. */
  captchaSlot?: React.ReactNode | undefined;
}

export interface EmailConfirmCardProps {
  copy: EmailConfirmCardCopy;
  /** The address the code was sent to — seeds the non-rendered `email` field. */
  email?: string | undefined;
  /** The destination exactly as typed (#2607) the description interpolates. */
  destination: string;
  /** App-owned RHF resolver (localized messages + the `@ds/schemas` SSOT). */
  resolver: Resolver<EmailConfirmValues>;
  /** Awaited by RHF, so it drives `isSubmitting`. Transport + routing are the host's. */
  onSubmit: (values: EmailConfirmValues) => Promise<void> | void;
  /** A submit blocked by validation (#904): the host decides the message. */
  onInvalid?: (() => void) | undefined;
  /** Already-localized code error. */
  error?: React.ReactNode | undefined;
  /** Server-confirmed acceptance — never set optimistically. */
  succeeded?: boolean | undefined;
  /** «← Изменить почту» — the host returns to its registration form. */
  onBack: () => void;
  /** Card glyph (app-supplied — the package carries no icon set). */
  icon?: React.ReactNode | undefined;
  resend: EmailConfirmResendProps;
  /** Resend cooldown in seconds; defaults to 30. */
  resendCooldownSeconds?: number;
  /** The `data-testid` map — every key defaults to the shipped id. */
  testIds?: Partial<EmailConfirmCardTestIds> | undefined;
  /**
   * 021 EARS-2 — the gate-context plate above the card, the slot the
   * registration door carries. Absent → NOTHING renders (EARS-3 honest-empty).
   */
  returnContextSlot?: React.ReactNode | undefined;
}

/** The block's addressable parts — see `EMAIL_CONFIRM_TEST_IDS` for the shipped ids. */
export interface EmailConfirmCardTestIds {
  /** The card frame; unnamed by default. */
  root: string | undefined;
  /** Wrapper of the 021 EARS-2 gate-context plate; unnamed by default. */
  returnContext: string | undefined;
  /** The one operation-failure plate above the title (canvas 53-56). */
  error: string;
  succeeded: string;
  submit: string;
  resend: string;
  resendNotice: string;
  back: string;
}

/** The ids the block ships with — the defaults of `testIds`. */
export const EMAIL_CONFIRM_TEST_IDS: EmailConfirmCardTestIds = {
  root: undefined,
  returnContext: undefined,
  error: "verify-error",
  succeeded: "verify-succeeded",
  submit: "verify-submit",
  resend: "verify-resend",
  resendNotice: "verify-resend-notice",
  back: "verify-back",
};

export function EmailConfirmCard({
  copy,
  email,
  destination,
  resolver,
  onSubmit,
  onInvalid,
  error,
  succeeded = false,
  onBack,
  icon,
  resend,
  resendCooldownSeconds = EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS,
  testIds,
  returnContextSlot,
}: EmailConfirmCardProps) {
  const form = useForm<EmailConfirmValues>({
    resolver,
    // Spread-if-present: with `exactOptionalPropertyTypes` an explicit
    // `undefined` is not assignable to the `string` field.
    defaultValues: { ...(email === undefined ? {} : { email }), code: "" },
  });

  // An address the host resolves after mount is pushed into the non-rendered
  // `email` field once known — otherwise the submit carries an empty identifier.
  React.useEffect(() => {
    if (email) form.setValue("email", email);
    // Keyed only on the resolved address — `form` is a stable useForm handle.
  }, [email]);

  // On a successful resend (nonce bump) clear the now-superseded typed code.
  const isInitialResend = React.useRef(true);
  React.useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    form.resetField("code");
    // Keyed only on the resend signal — `form` is a stable useForm handle.
  }, [resend.nonce]);

  // #175 — auto-submit on the sixth character, guarded against a double call.
  const submit = form.handleSubmit(onSubmit, onInvalid);
  const onComplete = React.useCallback(() => {
    if (form.formState.isSubmitting) return;
    void submit();
  }, [form.formState.isSubmitting, submit]);

  const ids = { ...EMAIL_CONFIRM_TEST_IDS, ...testIds };
  // Canvas 53-56 — ONE operation plate: the code failure wins over a resend
  // failure while both are live, because it is the one just acted on.
  const operationError = error ?? resend.error;

  const card = (
    <AuthCard
      {...(ids.root ? { "data-testid": ids.root } : {})}
      icon={icon}
      errorBanner={
        operationError ? (
          <FormError variant="banner" className="mb-5" data-testid={ids.error}>
            {operationError}
          </FormError>
        ) : null
      }
      // #1035: the page title is the document's single h1 (a11y landmark).
      title={<h1>{copy.title}</h1>}
      description={copy.description(destination)}
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <OtpFocusScreen
              field={field}
              codeLabel={copy.codeLabel}
              submitLabel={copy.submit}
              backLabel={copy.back}
              resendLabel={copy.resend}
              resendCountdownLabel={copy.resendCountdown}
              cooldownSeconds={resendCooldownSeconds}
              resendNonce={resend.nonce}
              isSubmitting={form.formState.isSubmitting}
              resendPending={resend.pending ?? false}
              succeeded={succeeded}
              succeededLabel={copy.codeAccepted}
              notice={resend.notice}
              onComplete={onComplete}
              onSubmit={submit}
              onResend={resend.onResend}
              onBack={onBack}
              captchaSlot={resend.captchaSlot}
              testIds={{
                submit: ids.submit,
                resend: ids.resend,
                back: ids.back,
                notice: ids.resendNotice,
                succeeded: ids.succeeded,
              }}
            />
          )}
        />
      </Form>
    </AuthCard>
  );

  // Supplied or absent, never an empty frame (021 EARS-2 / EARS-3).
  if (!returnContextSlot) return card;
  return (
    <div className="flex w-full flex-col gap-4.5">
      <div {...(ids.returnContext ? { "data-testid": ids.returnContext } : {})}>
        {returnContextSlot}
      </div>
      {card}
    </div>
  );
}
