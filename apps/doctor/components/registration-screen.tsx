"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import {
  useForm,
  type Resolver,
  type ResolverResult,
} from "react-hook-form";

import type { ConsentAcceptance, ConsentItem, ConsentTier } from "@ds/schemas";
import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
  VerifyRequestSchema,
} from "@ds/schemas";

import {
  AuthCard,
  BotProtectionField,
  botProtectionFailureMessage,
  EmailConfirmCard,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  useBotProtectedAction,
  useResendCooldown,
  type EmailConfirmCardCopy,
  type EmailConfirmValues,
} from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { Badge } from "@ds/design-system/badge";
import { Checkbox } from "@ds/design-system/checkbox";
import { EmailField, PasswordField } from "@ds/design-system/fields";
import { Input } from "@ds/design-system/input";

import {
  BOT_PROTECTION_MESSAGES,
  botProtectionSiteKey,
} from "@/lib/bot-protection";
import {
  registerDoctor,
  resendVerification,
  verifyEmail,
} from "@/lib/storefront-auth-client";

/**
 * 021 EARS-1 — the doctor registration screen (`design-source/auth.dc.html`,
 * the `#d-register` branch of the split composition).
 *
 * This is the ENVELOPE, not the whole feature. It is the CONTENT of the auth
 * frame's form column — the bordered card plus the slots stacked around it —
 * and nothing else: the frame itself (wordmark, brand panel, the vertical
 * centring, the `layout:` collapse) belongs to `<AuthShell>`, which the route
 * wraps this in. The card is surrounded by four things this slice does not own:
 * the return context
 * (#1538), the attribution line (#1544) and the points promise (#1545); the two
 * consent tiers (#1541) arrive as the read model the screen renders controls
 * from, not as pre-rendered nodes. They arrive here as props, and — per EARS-3's
 * honest-empty rule — a slot that is not supplied renders NOTHING: no wrapper, no
 * reserved frame, no dashed placeholder. That is why every slot below is guarded
 * by a truthiness check rather than always rendered with `children` inside; an
 * empty frame on the door would be exactly the scaffold surface REQ-22's sibling
 * rules exist to keep off this screen.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 * • **No header, nav or footer.** The route is chromeless by design — it sits
 *   in the `(auth)` route group, outside the 017 shell, because the canvas draws
 *   the door with no site chrome and the shell's onward links would lead the
 *   doctor away from the single CTA. EARS-1 forbids 021 defining or duplicating
 *   any of the three, so this component neither renders them nor substitutes for
 *   them. It starts at the card column and ends at the card column.
 *
 * • **No submit.** The button renders, disabled, with its reason stated beside
 *   it (EARS-12). Design §2 is explicit that no public 021 form may reach a
 *   003 EARS-17-protected endpoint without the EARS-19 bot-protection client
 *   half — and that widget is portal-local (`apps/portal/components/bot-protection/`),
 *   so `apps/doctor` has none yet. Wiring `RegisterDoctor` here would ship the
 *   untracked seam design §2 names by name. The mandatory access-condition
 *   consents (EARS-4/EARS-5) are likewise a precondition of the command and
 *   land in #1540/#1541, so the reason line states the real unmet condition rather
 *   than a build-status note. Both have since landed (#1540, #1541): the two
 *   access conditions are on the form, the reason line names whichever of them
 *   is unticked, and once both are granted it names the bot-protection
 *   challenge — the last real precondition, and the only one still unbuilt.
 *
 * • **No password policy of its own.** 021 design §7 and 003 EARS-36 make the
 *   rule length-only and forbid 021 declaring a second one. The canvas's
 *   «Минимум 8 символов, буквы и цифры.» would be exactly that second policy,
 *   so the hint states the length baseline only. Deliberate canvas deviation.
 *
 * • **No show-password toggle** (canvas + 003 EARS-38). `<PasswordField>`
 *   exposes no reveal affordance and no app ships one, so building it here
 *   would be a screen-local copy of a shared primitive's job — the adopt-first
 *   gate's failure mode. Surfaced as decision-debt for `@ds/design-system`.
 *
 * Tokens only, from `@ds/design-system`; the split's `layout:` breakpoint
 * (901px) — the canvas's 900px collapse — is the frame's business, not this
 * component's.
 */

export type RegistrationScreenProps = {
  /**
   * The gate context the doctor arrived from — 018's event-card unit (EARS-2,
   * #1538). Absent when they came on their own (EARS-3, #1539).
   */
  returnContext?: ReactNode;
  /**
   * 021 EARS-3 (#1539) — WHERE THIS ARRIVAL LANDS after confirmation, resolved
   * on the server and published as a fact on the form element
   * (`data-registration-landing`).
   *
   * The whole screen is a function of the entry URL (`021-requirements-en.md`
   * line 195), and the landing is the part of that function the pixels do not
   * show: a gate arrival carries its return target (the shared guard's own
   * reconstruction — one vocabulary, LD-3), a direct arrival carries the LD-4
   * decision (`lib/registration-landing.ts` — the 019 events feed for a doctor
   * whose specialty 017 remembers, the storefront home otherwise, never the
   * account page).
   *
   * REQUIRED, and a CONSUMED SEAM rather than decoration: the post-confirmation
   * success state of EARS-10 (#1546) reads this value for
   * `SuccessState.primaryAction` instead of recomputing the decision on the far
   * side of the confirmation hop, so the landing the doctor is promised on the
   * door is the landing they get. It is not optional precisely so that no
   * future caller can render the door without having decided.
   */
  landing: string;
  /** The resolved representative/organisation line (EARS-8, #1544). */
  attribution?: ReactNode;
  /** The pre-submission points promise read from configuration (EARS-9, #1545). */
  pointsPromise?: ReactNode;
  /**
   * The F-021-1 «вариант Б» consent block, as DATA (021 requirements —
   * `RegistrationScreen { …, consentTiers: ConsentTier[] }`).
   *
   * Deliberately not `ReactNode` slots, which is how this prop was shaped while
   * the tiers were unbuilt (#1540): every consent line is a control of THIS
   * form — the submit's precondition, its react-hook-form field and its
   * validation message all live here — so a pre-rendered node handed in from
   * the server route could not be one. The route supplies the read model
   * (purposes, required flags, the composition-derived statements from the
   * `@ds/schemas` SSOT); the screen renders the controls.
   *
   * Absent, the screen still renders the EARS-4 declaration — that one is a
   * precondition of the command this screen owns, never a slot.
   */
  consentTiers?: readonly ConsentTier[];
};

type RegistrationFormValues = {
  email: string;
  password: string;
  promoCode: string;
  /**
   * EARS-4 — the medical-worker declaration. A precondition of the command, not
   * a preference: there is no third state, no deferred state and no default of
   * `true`.
   */
  medicalWorkerDeclaration: boolean;
  /**
   * EARS-5 — the partner-data consent. The SECOND access condition, with
   * exactly the same standing as the declaration: no third state, no default of
   * `true`, and no path that completes registration without it.
   */
  partnerDataSharing: boolean;
  /**
   * EARS-6 — the optional marketing opt-in. Collected here so the tier-2
   * control is a real field of the form rather than an unbound decoration; its
   * RECORD semantics (a row only when granted, no row at all when withheld)
   * belong to #1542 and are not asserted by this slice.
   */
  marketingCommunications: boolean;
};

/**
 * EARS-4 copy, verbatim from `design-source/auth.dc.html` (:206, :207, :517).
 * The declaration is a DECLARATION: the helper states the legal reason and asks
 * for nothing to prove it, and nowhere on this surface is a document, file
 * input or diploma mentioned.
 */
const MEDICAL_WORKER_DECLARATION_LABEL = "Я являюсь медицинским работником";
const MEDICAL_WORKER_DECLARATION_HELP =
  "Требование закона: часть материалов доступна только медицинским работникам.";
const MEDICAL_WORKER_DECLARATION_UNMET =
  "Отметьте, что вы медицинский работник — без этого регистрация невозможна.";

/**
 * EARS-5 copy, verbatim from `design-source/auth.dc.html` (`#d-register`,
 * «согласия · вариант Б»).
 *
 * The tier-1 heading is what makes the two tiers distinguishable by RENDERING
 * rather than by wording: the canvas frames the access conditions in a bordered
 * group under this label and leaves the marketing line outside it. The
 * statements themselves are NOT here — they arrive as data from the
 * `@ds/schemas` SSOT, built from the declared data composition (design §4).
 * These constants are the surrounding UI copy the canvas draws around them.
 */
const ACCESS_CONDITIONS_HEADING = "Условия доступа";
const PARTNER_DATA_HELP =
  "Это условие бесплатного для врача обучения: без согласия часть материалов недоступна.";
const PARTNER_DATA_UNMET =
  "Отметьте согласие на передачу данных партнёрам — без него регистрация невозможна.";
const MARKETING_HELP =
  "Необязательно. Письма отправляет внешний сервис рассылок.";
const MARKETING_OPTIONAL_TAG = "необязательно";

/**
 * EARS-7 — the withdrawal statement, rendered as part of the block and with NO
 * self-service control beside it: a change or withdrawal is a request handled
 * by a platform manager (feature 037's manager-side operation), and a toggle
 * here would promise a mechanism this surface does not have.
 */
const CONSENT_MANAGER_NOTE =
  "Согласия раздельные и фиксируются с датой. Изменить или отозвать согласие можно через менеджера платформы.";

/**
 * 021 EARS-19 (#1558) — the version of the consent WORDING this screen renders,
 * carried on every granted purpose the command sends.
 *
 * The access-condition rows do not keep it: the service re-stamps the
 * declaration and the partner-data purposes with its own
 * `MEDICAL_WORKER_DECLARATION_VERSION` / `PARTNER_DATA_SHARING_VERSION`
 * (`doctor-register.service.ts`), because a client-supplied version would let a
 * record claim a wording the surface never rendered — presence in the array is
 * the grant, the version is the server's to stamp. The optional marketing
 * purpose has no server-side stamp yet (its record semantics are #1542's), so
 * for that row this IS the recorded version until #1542 moves the stamp across.
 */
const CONSENT_WORDING_VERSION = "2026-09";

/**
 * The command's own failure copy (021 EARS-12 / 003 EARS-16).
 *
 * Deliberately generic and identical for a brand-new and an already-registered
 * address: the BFF answers both with the same `pending_verification`, and a
 * screen that said anything more specific here would re-introduce on-screen the
 * account-existence signal the contract removes.
 */
const REGISTER_FAILED =
  "Не удалось завершить регистрацию. Попробуйте ещё раз.";

/**
 * The post-submit «письмо отправлено» copy, verbatim from the shipped 003
 * catalog (`apps/portal/messages/ru.json` → `verify.*`) — the Academy already
 * confirms an email with these words, and 021 invents none of its own.
 *
 * ONE line is deliberately NOT the portal's: the portal's «Код принят —
 * входим…» promises the auto-login replay it performs with a held password.
 * The doctor storefront holds no password and replays no login (#1546 owns
 * where a confirmed doctor lands), so promising a sign-in here would be copy
 * asserting a mechanism this surface does not have.
 */
const CONFIRM_COPY: EmailConfirmCardCopy = {
  title: "Проверьте почту",
  description: (destination) => (
    <>
      Мы отправили код на <strong>{destination}</strong>. Введите его, чтобы
      завершить регистрацию.
    </>
  ),
  newAccountHeading: "Новый аккаунт — введите код",
  codeLabel: "Код из письма",
  submit: "Подтвердить",
  codeAccepted: "Код принят — почта подтверждена.",
  resend: "Отправить снова",
  resendCountdown: (seconds) => `Отправить снова · ${seconds} с`,
  existingAccountHeading: "Уже регистрировались?",
  existingAccountHint: "Войдите в существующий аккаунт или сбросьте пароль.",
  goToSignIn: "Войти",
  goToReset: "Сбросить пароль",
};

const CONFIRM_CODE_INVALID = "Введите код из письма.";
const CONFIRM_FAILED = "Код не подошёл. Попробуйте ещё раз.";
const CONFIRM_RESEND_FAILED =
  "Не удалось отправить код повторно. Попробуйте ещё раз.";
const CONFIRM_RESEND_ACKNOWLEDGED = (destination: string) =>
  `Если регистрация ещё не подтверждена, мы повторно отправили код на ${destination}.`;

/** The item of a tier carrying this purpose, or `undefined` when unsupplied. */
function findConsentItem(
  tiers: readonly ConsentTier[] | undefined,
  purpose: string,
): ConsentItem | undefined {
  return tiers
    ?.flatMap((tier) => tier.items)
    .find((item) => item.purpose === purpose);
}

export function RegistrationScreen({
  returnContext,
  landing,
  attribution,
  pointsPromise,
  consentTiers,
}: RegistrationScreenProps) {
  // Client validation is a UX affordance only (EARS-11) — the BFF and the IdP
  // stay the credential authority. `onTouched` surfaces a malformed value on
  // blur rather than holding it back until a submit that cannot happen yet.
  const form = useForm<RegistrationFormValues>({
    mode: "onTouched",
    // Never pre-ticked: a pre-ticked declaration would be the platform
    // declaring on the doctor's behalf, which is the one thing a declaration
    // cannot be.
    defaultValues: {
      email: "",
      password: "",
      promoCode: "",
      medicalWorkerDeclaration: false,
      // EARS-5 / EARS-6 — neither is pre-ticked, for the same reason: a
      // pre-ticked box is the platform consenting on the doctor's behalf.
      partnerDataSharing: false,
      marketingCommunications: false,
    },
  });

  const partnerDataItem = findConsentItem(
    consentTiers,
    PARTNER_DATA_SHARING_PURPOSE,
  );
  const marketingItem = findConsentItem(
    consentTiers,
    MARKETING_COMMUNICATIONS_PURPOSE,
  );

  const reasonId = `${useId()}-register-submit-reason`;

  // EARS-12 — the reason beside the disabled submit names the SPECIFIC unmet
  // condition. While the declaration is unticked that is the declaration, in the
  // canvas's own words; once it is ticked the next real obstacle is stated
  // instead — first the partner-data consent (EARS-5), then, with both access
  // conditions granted, the bot-protection challenge the door still has to run
  // (003 EARS-17 / 021 EARS-19, #1558). The submit stays disabled through all
  // three because the command remains unreachable until that last one lands,
  // and wiring the button past it would ship the untracked seam design §2 names
  // by name. The reason line never says «следующим шагом» about a consent that
  // IS on the form.
  const declared = form.watch("medicalWorkerDeclaration");
  const partnerDataGranted = form.watch("partnerDataSharing");
  // With an empty consent read model the partner-data row is not rendered, but
  // the server still refuses without that purpose — so the reason names the
  // unmet access condition rather than a bot-protection step that is not the
  // first obstacle (EARS-12).
  // Both access conditions granted, the command is reachable: there is no third
  // obstacle any more. The bot-protection challenge is not one — it is INVISIBLE
  // and runs inside the submit (003 EARS-17), so a doctor who has met the two
  // stated conditions presses an ENABLED button and the challenge happens on the
  // way. `null` is the enabled state, and the reason paragraph is then absent
  // rather than empty (EARS-3's honest-empty rule, same as every other slot).
  const submitReason = !declared
    ? MEDICAL_WORKER_DECLARATION_UNMET
    : !partnerDataItem || !partnerDataGranted
      ? PARTNER_DATA_UNMET
      : null;

  /**
   * 021 EARS-19 — the challenge failure and the command failure are two
   * different statements, and both are FORM-level: neither belongs on the email,
   * the password or a consent box, none of which the doctor got wrong. They are
   * held apart so a fresh challenge clears the challenge line without erasing a
   * command failure the doctor still has to read.
   */
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  /**
   * The address the code went to — `null` while the door is still the form.
   * Set only after the BFF ACCEPTED the command, so the post-submit state never
   * asserts an email the server did not send.
   */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(
        botProtectionFailureMessage(failure, BOT_PROTECTION_MESSAGES),
      ),
    onActionError: (error) => {
      // 003 EARS-17 — a token the guard refused, or a request that arrived
      // without one. Reported as the challenge statement (and NOT as a
      // registration failure), because retrying the challenge is what fixes it.
      if (isBotProtectionRejected(error) || isBotProtectionRequired(error)) {
        setCaptchaError(
          isBotProtectionRejected(error)
            ? BOT_PROTECTION_MESSAGES.rejected
            : BOT_PROTECTION_MESSAGES.required,
        );
        return;
      }
      setCommandError(REGISTER_FAILED);
    },
  });

  /**
   * `RegisterDoctor` (021 design §2) — the command this screen owns, run behind
   * the invisible challenge: `request()` mounts one fresh widget instance, and
   * the pending closure below resumes with the minted token (or, with no site
   * key configured, tokenless — exactly matching the guard's no-op when the
   * provider is disabled).
   */
  const onValid = useCallback(
    (values: RegistrationFormValues) => {
      setCaptchaError(null);
      setCommandError(null);
      const email = values.email.trim();
      captcha.request(async (captchaToken) => {
        // EARS-7 — an ungranted optional purpose is ABSENT from the array;
        // there is no `granted: false` shape. The declaration is not listed
        // either: the service derives its row from the flag, so listing it
        // here would be a second, untrusted claim about the same tick.
        const consent: ConsentAcceptance[] = [];
        if (partnerDataItem) {
          consent.push({
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            version: CONSENT_WORDING_VERSION,
          });
        }
        if (marketingItem && values.marketingCommunications) {
          consent.push({
            purpose: MARKETING_COMMUNICATIONS_PURPOSE,
            version: CONSENT_WORDING_VERSION,
          });
        }
        await registerDoctor(
          {
            email,
            password: values.password,
            // EARS-4 — a literal, not the watched value: the submit is
            // unreachable while the declaration is unticked, so the command
            // that does leave this screen always carries the granted one.
            medicalWorkerDeclaration: true,
            consent,
          },
          captchaToken,
        );
        // 003 EARS-16 / 021 EARS-13 — the response is IDENTICAL for a new and
        // an already-registered address, so there is exactly one next state and
        // no branch to make on it.
        setPendingEmail(email);
      });
    },
    [captcha, marketingItem, partnerDataItem],
  );

  // 021 EARS-19 — a command that succeeded never shows nothing. The door becomes
  // the canonical 003 confirmation state, and the form's own surroundings do NOT
  // travel with it: the return context, the attribution line and the points
  // promise are pre-submission framing of a decision the doctor has now made,
  // and re-rendering them beside «Проверьте почту» would put a call to action
  // next to a screen whose only action is the code.
  if (pendingEmail) {
    return (
      <div
        data-testid="registration-screen"
        className="flex w-full flex-col gap-4.5"
      >
        <RegistrationConfirmation email={pendingEmail} />
      </div>
    );
  }

  return (
    <div
      data-testid="registration-screen"
      className="flex w-full flex-col gap-4.5"
    >
      {/* EARS-2 / EARS-3 — supplied or absent, never an empty frame. */}
      {returnContext ? (
        <div data-testid="registration-return-context">{returnContext}</div>
      ) : null}
      {attribution ? (
        <div data-testid="registration-attribution">{attribution}</div>
      ) : null}

      <AuthCard
        data-testid="registration-form-card"
        icon={<RegistrationGlyph />}
        // The route's single h1 — the shell layout carries none, because it
        // wraps many routes and must not own their heading (017 §1).
        title={<h1>Регистрация</h1>}
        // REQ-22 stated to the doctor, verbatim from the canvas card head.
        // This is the feature's promise, not a document request.
        description="Почта и пароль — этого достаточно. Документы на входе не нужны."
      >
        <Form {...form}>
          <form
            data-testid="registration-form"
            // EARS-3 — the server's landing decision, carried on the element the
            // command belongs to. A data attribute rather than a hidden input:
            // nothing submits it (the request contract has no return-target
            // field, and adding one before #1546 consumes it would be the
            // untracked seam AGENTS.md §6 forbids), and nothing on the client
            // recomputes it.
            data-registration-landing={landing}
            className="flex flex-col gap-4.5"
            noValidate
            // 021 EARS-19 — `RegisterDoctor`, run through react-hook-form so a
            // client-side validation miss surfaces in the field it belongs to
            // rather than as a form-level failure.
            onSubmit={form.handleSubmit(onValid)}
          >
            <FormField
              control={form.control}
              name="email"
              rules={{
                required:
                  "Введите рабочую почту — на неё придёт код подтверждения.",
                pattern: {
                  // UX affordance only: shape, not deliverability.
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message:
                    "Проверьте адрес: он должен быть вида doctor@clinic.ru.",
                },
              }}
              render={({ field }) => (
                <EmailField
                  field={field}
                  label="Рабочая почта"
                  placeholder="doctor@clinic.ru"
                  testId="register-email"
                />
              )}
            />

            <FormField
              control={form.control}
              name="password"
              rules={{
                required: "Придумайте пароль не короче 8 символов.",
                minLength: {
                  // 003 EARS-36 — the length-only baseline, 021 declares none.
                  value: 8,
                  message:
                    "Пароль слишком короткий — нужно не менее 8 символов.",
                },
              }}
              render={({ field }) => (
                <PasswordField
                  field={field}
                  purpose="new"
                  label="Пароль"
                  policyHint="Не менее 8 символов."
                  testId="register-password"
                />
              )}
            />

            <FormField
              control={form.control}
              name="promoCode"
              rules={{
                maxLength: {
                  value: 64,
                  message:
                    "Промокод длиннее 64 символов — проверьте, что скопировали только код.",
                },
              }}
              render={({ field }) => (
                // No semantic primitive exists for a promo code, and one
                // would be wrong: the code vocabulary belongs to a campaign,
                // not to the form (design §7), so there is nothing to bake
                // in beyond trim + a length bound. Composed from the
                // sanctioned `FormItem`/`Input` primitives, not hand-rolled.
                <FormItem>
                  <FormLabel>Промокод — если есть</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="DS-2026"
                      data-testid="register-promo"
                      {...field}
                      value={field.value ?? ""}
                      // Trim on BLUR, never per keystroke: stripping on
                      // every change makes an interior space untypable
                      // («DS » + «2» would land as «DS2»), silently
                      // rewriting what the doctor typed. Blur covers the
                      // paste case design §7 asks for, and the submit path
                      // trims again once the command is wired.
                      onBlur={(event) => {
                        field.onChange(event.target.value.trim());
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/*
              EARS-5 — TIER 1, the access conditions, framed together ABOVE the
              submit (F-021-1 «Б», the owner's pick).

              The frame is the whole point of the variant: the two tiers are
              distinguishable by their RENDERING and not by wording alone, so
              tier 1 is a bordered group under its own «Условия доступа» heading
              and tier 2 stands outside it, below the submit. The canvas draws
              exactly this — a 2px structural border with a tinted heading bar —
              and the alternatives the owner rejected are structurally absent:
              there is no flat single list (variant А) because these two lines
              are inside a frame the marketing line is not in, and no
              expandable-disclosure of the data composition (variant В) because
              the composition is rendered in full, in the statement, with
              nothing to open.
            */}
            <div
              data-testid="registration-consent-access"
              className="border-2 border-border"
              role="group"
              aria-labelledby="registration-consent-access-heading"
            >
              <p
                id="registration-consent-access-heading"
                className="border-b-2 border-border bg-muted px-3.5 py-2.5 text-xs font-extrabold uppercase tracking-widest"
              >
                {ACCESS_CONDITIONS_HEADING}
              </p>
              <div className="flex flex-col gap-3.5 px-3.5 py-4">
                {/*
              EARS-4 — the mandatory declaration, the first access condition,
              standing ABOVE the submit with the rest of tier 1 (EARS-5).
              Built from the design system's checkbox primitive, never a
              hand-assembled input: the box, its checked/focus/disabled states
              and the label association are the primitive's.

              There is deliberately NO «ask later» control, no «пропустить», no
              partial variant and no document affordance anywhere around it —
              the declaration is the only thing asked, and it is asked once.
            */}
                <FormField
                  control={form.control}
                  name="medicalWorkerDeclaration"
                  rules={{ required: MEDICAL_WORKER_DECLARATION_UNMET }}
                  render={({ field }) => (
                    <FormItem data-testid="register-medworker-item">
                      <FormControl>
                        <Checkbox
                          className="items-start"
                          data-testid="register-medworker"
                          name={field.name}
                          ref={field.ref}
                          checked={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) =>
                            field.onChange(event.target.checked)
                          }
                        >
                          <span className="flex flex-col gap-1">
                            {/*
                              Canvas вариант Б draws NO requirement tag on
                              either access condition (`design-source/auth.dc.html`,
                              «согласия · вариант Б»): in Б the requirement is
                              carried by the «Условия доступа» frame itself,
                              which is the point of the variant. The
                              `reqTagStyle` tag belongs to вариантs А and В, and
                              there it sits on BOTH rows — a tag on this row
                              alone would read as «only the first box is
                              mandatory». The declaration stays `required` and
                              its EARS-12 reason unchanged.
                            */}
                            <span>{MEDICAL_WORKER_DECLARATION_LABEL}</span>
                            <span
                              data-testid="register-medworker-help"
                              className="text-sm text-muted-foreground"
                            >
                              {MEDICAL_WORKER_DECLARATION_HELP}
                            </span>
                          </span>
                        </Checkbox>
                      </FormControl>
                      {/* EARS-12 — actionable, in the field where it occurred. */}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/*
                  EARS-5 — the partner-data consent, the SECOND access
                  condition. Same primitive as the declaration, same standing,
                  same frame; what differs is that its STATEMENT is not written
                  here. It arrives as data built from the declared composition
                  (`@ds/schemas` → `formatPartnerDataStatement`), so changing
                  what is shared changes the sentence the doctor reads and the
                  recorded purpose together — design §4's "data-driven, not a
                  copy blob".
                */}
                {partnerDataItem ? (
                  <FormField
                    control={form.control}
                    name="partnerDataSharing"
                    rules={{ required: PARTNER_DATA_UNMET }}
                    render={({ field }) => (
                      <FormItem data-testid="register-partner-data-item">
                        <FormControl>
                          <Checkbox
                            className="items-start"
                            data-testid="register-partner-data"
                            name={field.name}
                            ref={field.ref}
                            checked={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) =>
                              field.onChange(event.target.checked)
                            }
                          >
                            <span className="flex flex-col gap-1">
                              <span data-testid="register-partner-data-statement">
                                {partnerDataItem.statement}
                              </span>
                              <span
                                data-testid="register-partner-data-help"
                                className="text-sm text-muted-foreground"
                              >
                                {PARTNER_DATA_HELP}
                              </span>
                            </span>
                          </Checkbox>
                        </FormControl>
                        {/* EARS-12 — actionable, in the field where it occurred. */}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            </div>

            {/* EARS-9 — the promise, read from configuration by #1545. */}
            {pointsPromise ? (
              <div data-testid="registration-points-promise">
                {pointsPromise}
              </div>
            ) : null}

            <div className="flex flex-col gap-2.5">
              {/*
                    Natively `disabled` rather than `aria-disabled` + a no-op
                    submit: `@ds/design-system`'s Button carries its whole
                    inert appearance on the `disabled:` pseudo-class
                    (`disabled:opacity-40`, the flattened cast shadow), so an
                    aria-only variant would mean re-declaring that appearance
                    screen-locally — the adopt-first failure mode — and would
                    change a Stage-B-evidenced visual surface. The stronger
                    announcement path belongs in the primitive; folded into
                    #1663 with the hint/error slot. EARS-16 still holds here:
                    the reason is a visible paragraph in the form's reading
                    order, wired by `aria-describedby` on top of that.
                  */}
              <Button
                type="submit"
                className="w-full"
                // Disabled ONLY while a stated condition is unmet; once both
                // access conditions are granted the command is reachable and the
                // button is live. The in-flight guard is the challenge's own
                // `pending` — one registration attempt at a time, never two
                // tokens for one form.
                disabled={submitReason !== null || captcha.pending}
                {...(submitReason === null
                  ? {}
                  : { "aria-describedby": reasonId })}
                data-testid="register-submit"
              >
                Зарегистрироваться
              </Button>
              {/*
                    EARS-12: while a mandatory condition is unmet the control is
                    disabled with its reason stated beside it, so a silently dead
                    button exists in no state. The unmet condition is real and
                    product-shaped — registration cannot be accepted without the
                    two access-condition consents (EARS-4/EARS-5), which the
                    command validates as a precondition.
                  */}
              {submitReason ? (
                <p
                  id={reasonId}
                  data-testid="register-submit-reason"
                  className="text-sm font-medium text-muted-foreground"
                >
                  {submitReason}
                </p>
              ) : null}

              {/*
                003 EARS-17 / 021 EARS-12 — the challenge and command failures,
                stated at FORM level. `role="alert"` so a doctor who pressed the
                button and is looking at it hears why nothing happened; never a
                `FormMessage` on a field, because no field is wrong.
              */}
              {captchaError ? (
                <p
                  role="alert"
                  data-testid="register-captcha-error"
                  className="text-sm font-medium text-destructive"
                >
                  {captchaError}
                </p>
              ) : null}
              {commandError ? (
                <p
                  role="alert"
                  data-testid="register-command-error"
                  className="text-sm font-medium text-destructive"
                >
                  {commandError}
                </p>
              ) : null}

              {/*
                The invisible challenge itself. It renders nothing until a
                submit requests it and nothing at all without a site key — the
                dev-stand and CI default, where the pending action resumes
                tokenless and the guard no-ops in the same way.
              */}
              <BotProtectionField
                sitekey={botProtectionSiteKey()}
                {...captcha.fieldProps}
              />
            </div>

            {/*
              EARS-5 — TIER 2, the optional marketing opt-in, standing
              SEPARATELY BELOW the submit and outside tier 1's frame. Its
              optionality is stated on the control («необязательно») and carried
              by its rendering: it is not in the group the submit depends on.
              EARS-6 (#1542) owns the guarantees about what its state does and
              does not change downstream.
            */}
            {marketingItem ? (
              <div data-testid="registration-consent-marketing">
                <FormField
                  control={form.control}
                  name="marketingCommunications"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Checkbox
                          className="items-start"
                          data-testid="register-marketing"
                          name={field.name}
                          ref={field.ref}
                          checked={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) =>
                            field.onChange(event.target.checked)
                          }
                        >
                          <span className="flex flex-col gap-1">
                            <span className="text-muted-foreground">
                              {marketingItem.statement}
                              <Badge
                                variant="label"
                                className="ml-1.5 align-middle"
                                data-testid="register-marketing-optional-tag"
                              >
                                {MARKETING_OPTIONAL_TAG}
                              </Badge>
                            </span>
                            <span
                              data-testid="register-marketing-help"
                              className="text-sm text-muted-foreground"
                            >
                              {MARKETING_HELP}
                            </span>
                          </span>
                        </Checkbox>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            {/*
              EARS-7 — the withdrawal statement that belongs to the block, and
              the ONLY thing this surface says about changing a consent: a
              request handled by a platform manager. No toggle, no «отозвать»
              control, nowhere on the screen.
            */}
            {consentTiers?.length ? (
              <p
                data-testid="registration-consent-manager-note"
                className="text-xs text-muted-foreground"
              >
                {CONSENT_MANAGER_NOTE}
              </p>
            ) : null}
          </form>
        </Form>
      </AuthCard>
    </div>
  );
}

/**
 * The RHF resolver for the confirmation code, hand-rolled over the 003
 * `VerifyRequestSchema` SSOT.
 *
 * Hand-rolled and not `@hookform/resolvers/zod`: the doctor storefront does not
 * carry that dependency, and adding a package to translate three lines of issue
 * mapping would be the heavier change. It stays a projection of the SCHEMA all
 * the same — the shape is never re-declared here, only its issues are given the
 * screen's Russian wording, which is exactly the split the block's `resolver`
 * prop exists for (copy is the host's, the contract is `@ds/schemas`').
 */
const confirmResolver: Resolver<EmailConfirmValues> = (values) => {
  const parsed = VerifyRequestSchema.safeParse(values);
  const result: ResolverResult<EmailConfirmValues> = parsed.success
    ? { values: parsed.data, errors: {} }
    : {
        values: {},
        errors: { code: { type: "validate", message: CONFIRM_CODE_INVALID } },
      };
  return result;
};

/**
 * 021 EARS-19 / 003 EARS-3 + EARS-25 — the post-submit state, and the SECOND
 * bot-protected surface this Issue owns.
 *
 * The composition is not written here: `<EmailConfirmCard>` is the ONE canonical
 * email-confirmation block both storefronts mount (#1902, AGENTS.md §6
 * cross-front reuse), so this is a host projection of it — RU copy, the resolver
 * above, and the transport. The engine is 003's shipped one, unchanged: the code
 * goes to `/v1/auth/verify` and a resend to `@BotProtected("verify-resend")`
 * `/v1/auth/verify/resend`, which is why every resend mints its own token
 * through the same challenge the registration submit ran.
 *
 * Its own `useBotProtectedAction`, separate from the registration form's: the
 * form is gone by the time this renders, and a resend is a different protected
 * action with a different failure channel.
 *
 * WHAT THIS SLICE DOES NOT DECIDE (#1549, EARS-13): the co-equal
 * already-registered affordances the block renders point at this storefront's
 * own `/login` and `/reset` — same-site relative, never a hand-off to the
 * Academy origin, which is a separate site. Whether those two routes exist yet,
 * and the enumeration-safe parity assertions around them, belong to #1549.
 * #1546 (EARS-10) owns where a confirmed doctor lands after «Код принят».
 */
function RegistrationConfirmation({ email }: { email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const destination = maskDestination(email);

  const captcha = useBotProtectedAction({
    onVerified: () => setCaptchaError(null),
    onChallengeError: (failure) =>
      setCaptchaError(
        botProtectionFailureMessage(failure, BOT_PROTECTION_MESSAGES),
      ),
    onActionError: () => setResendError(CONFIRM_RESEND_FAILED),
  });

  const { resendNonce, onResend } = useResendCooldown({
    resend: async (captchaToken) => {
      await resendVerification({ identifier: email }, captchaToken);
    },
    onError: (err) => {
      if (isBotProtectionRejected(err)) {
        setCaptchaError(BOT_PROTECTION_MESSAGES.rejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setCaptchaError(BOT_PROTECTION_MESSAGES.required);
        return;
      }
      setResendError(CONFIRM_RESEND_FAILED);
    },
    onBeforeResend: () => {
      setResendError(null);
      setNotice(null);
    },
    // 003 EARS-16 — the acknowledgement is conditionally phrased, so it is the
    // same sentence for a registrant, a stranger and an already-verified owner.
    onSuccess: () => setNotice(CONFIRM_RESEND_ACKNOWLEDGED(destination)),
  });

  async function onSubmit(values: EmailConfirmValues) {
    setError(null);
    try {
      // Mapped field by field rather than cast: a future field on the 003
      // contract must fail typecheck here instead of shipping a silent omission.
      await verifyEmail({ email: values.email, code: values.code });
      setSucceeded(true);
    } catch {
      setSucceeded(false);
      setError(CONFIRM_FAILED);
    }
  }

  return (
    <EmailConfirmCard
      icon={<ConfirmationGlyph />}
      copy={CONFIRM_COPY}
      email={email}
      destination={destination}
      resolver={confirmResolver}
      onSubmit={onSubmit}
      onInvalid={() => setError(CONFIRM_CODE_INVALID)}
      error={error}
      succeeded={succeeded}
      // Same-site, relative: the doctor storefront is its own site and hands a
      // visitor off to no other one.
      links={{ login: "/login", reset: "/reset" }}
      resend={{
        nonce: resendNonce,
        onResend: () => captcha.request(onResend),
        error: captchaError ?? resendError,
        pending: captcha.pending,
        notice,
        captchaSlot: (
          <BotProtectionField
            sitekey={botProtectionSiteKey()}
            {...captcha.fieldProps}
          />
        ),
      }}
    />
  );
}

/**
 * The confirmation card's glyph — an envelope, drawn inline for the same reason
 * the registration glyph is: `apps/doctor` ships no icon dependency. Decorative
 * only; the heading carries the meaning.
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

/**
 * The card-head glyph of the canvas's `auth-card` unit. Drawn inline rather than
 * pulled from an icon package: `apps/doctor` ships no icon dependency today, and
 * adding one for a single decorative mark is a heavier change than the mark.
 * Purely decorative — the heading carries the meaning.
 */
function RegistrationGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
