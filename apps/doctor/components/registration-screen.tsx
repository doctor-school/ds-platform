"use client";

import { useCallback, useState, type ReactNode } from "react";
import { type Resolver, type ResolverResult } from "react-hook-form";

import type { ConsentAcceptance, ConsentItem, ConsentTier } from "@ds/schemas";
import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";

import {
  BotProtectionField,
  botProtectionFailureMessage,
  EmailConfirmCard,
  isBotProtectionRejected,
  isBotProtectionRequired,
  maskDestination,
  RegisterCard,
  RegistrationSuccessCard,
  useBotProtectedAction,
  useResendCooldown,
  type EmailConfirmCardCopy,
  type EmailConfirmValues,
  type RegisterCardConsentItem,
  type RegisterCardValues,
} from "@ds/design-system/blocks";

import {
  BOT_PROTECTION_MESSAGES,
  botProtectionSiteKey,
} from "@/lib/bot-protection";
import {
  REGISTER_FIELD_MESSAGES,
  registerFieldHint,
  registerFieldRules,
  resolveVerificationCode,
} from "@/lib/register-fields";
import {
  confirmDoctorEmail,
  registerDoctor,
  resendVerification,
} from "@/lib/storefront-auth-client";
import {
  resolveRegistrationSuccess,
  type RegistrationSuccessView,
} from "@/lib/registration-success";

/**
 * 021 EARS-1 — the doctor registration screen (`design-source/auth.dc.html`,
 * the `#d-register` branch of the split composition).
 *
 * This file is the HOST PROJECTION, not the composition. The registration form
 * itself is `<RegisterCard>` — the ONE canonical registration block both
 * storefronts mount (#1934, AGENTS.md §6 cross-front reuse), which owns the
 * structure the Academy `/register` and this door must not drift apart on: the
 * two consent tiers told apart by their rendering (F-021-1 «вариант Б»), the
 * EARS-12 reason beside a disabled submit, the form-level statements held
 * apart. What stays here is everything that is genuinely this host's — RU copy,
 * the consent read model, the transport, and the post-submit confirmation.
 *
 * This is still the ENVELOPE and not the whole feature: it is the CONTENT of
 * the auth frame's form column, and the frame itself (wordmark, brand panel,
 * the vertical centring, the `layout:` collapse) belongs to `<AuthShell>`,
 * which the route wraps this in. Per EARS-3's honest-empty rule an unsupplied
 * slot renders NOTHING — no wrapper, no reserved frame, no dashed placeholder;
 * the block enforces that for every slot below.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 * • **No header, nav or footer.** The route is chromeless by design — it sits
 *   in the `(auth)` route group, outside the 017 shell, because the canvas draws
 *   the door with no site chrome and the shell's onward links would lead the
 *   doctor away from the single CTA. EARS-1 forbids 021 defining or duplicating
 *   any of the three.
 *
 * • **No password policy of its own.** 021 design §7 and 003 EARS-36 make the
 *   rule length-only and forbid 021 declaring a second one. The canvas's
 *   «Минимум 8 символов, буквы и цифры.» would be exactly that second policy,
 *   so the hint states the length baseline only. Deliberate canvas deviation.
 *
 * • **The show-password toggle is the primitive's** (canvas + 003 EARS-38,
 *   #1663). `<PasswordField>` ships the reveal affordance itself — the canvas
 *   «Показать» / «Скрыть» control, its RU labels and its masked default — so
 *   this screen renders none of it and inherits the behaviour by adopting the
 *   shared field, which is what the adopt-first gate asks for.
 *
 * Tokens only, from `@ds/design-system`; the split's `layout:` breakpoint
 * (901px) — the canvas's 900px collapse — is the frame's business.
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
   * decision (`lib/registration-landing.ts`).
   *
   * REQUIRED, and CONSUMED: the post-confirmation success state of EARS-10
   * (#1546) renders this value as its primary action whenever the confirmation
   * response carries no honoured target of its own, instead of recomputing the
   * decision on the far side of the hop — so the landing the doctor is promised
   * on the door is the landing they get. It is not optional precisely so that no
   * future caller can render the door without having decided.
   */
  landing: string;
  /**
   * 021 EARS-10 (#1546) — the arrival target to CARRY THROUGH the confirmation,
   * in the doctor host's own vocabulary (`/events/<slug>`).
   *
   * Not the raw `returnTo` param and not {@link landing}: the confirm command's
   * server-side guard (`parseDoctorHostReturnTarget`) speaks the doctor-host
   * shapes and rejects the canonical academy `/webinars/<slug>` the gate emits,
   * so the route hands over the projection it already resolved (#1945). Absent
   * on a direct arrival and on an arrival whose target did not resolve — the
   * server then answers with a landing rather than a return.
   *
   * It is re-validated server-side against the live эфир (EARS-10), so nothing
   * about this value is trusted across the hop; carrying it is what lets the
   * server tell «still live» from «went stale» and name WHICH.
   */
  returnTarget?: string;
  /** The resolved representative/organisation line (EARS-8, #1544). */
  attribution?: ReactNode;
  /** The pre-submission points promise read from configuration (EARS-9, #1545). */
  pointsPromise?: ReactNode;
  /**
   * The F-021-1 «вариант Б» consent block, as DATA (021 requirements —
   * `RegistrationScreen { …, consentTiers: ConsentTier[] }`).
   *
   * Deliberately not `ReactNode` slots: every consent line is a control of the
   * form — the submit's precondition, its react-hook-form field and its
   * validation message — so a pre-rendered node handed in from the server route
   * could not be one. The route supplies the read model (purposes, required
   * flags, the composition-derived statements from the `@ds/schemas` SSOT); the
   * block renders the controls.
   *
   * Absent, the screen still renders the EARS-4 declaration — that one is a
   * precondition of the command this screen owns, never a slot.
   */
  consentTiers?: readonly ConsentTier[];
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
 *
 * Canvas вариант Б draws NO requirement tag on either access condition: in Б
 * the requirement is carried by the «Условия доступа» frame itself, which is the
 * point of the variant.
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
 * account-existence signal the contract removes. The mapping stays HOST-side for
 * that reason — the block takes an already-localized statement and makes no
 * outcome branch of its own.
 */
const REGISTER_FAILED =
  "Не удалось завершить регистрацию. Попробуйте ещё раз.";

/** The RU copy the block renders. No copy lives in `@ds/design-system` (#235). */
const REGISTER_COPY = {
  title: "Регистрация",
  // REQ-22 stated to the doctor, verbatim from the canvas card head. This is
  // the feature's promise, not a document request.
  description:
    "Почта и пароль — этого достаточно. Документы на входе не нужны.",
  emailLabel: "Рабочая почта",
  emailPlaceholder: "doctor@clinic.ru",
  passwordLabel: "Пароль",
  // 021 EARS-11 — the PRE-SUBMIT half of the one-slot hint-OR-error contract
  // (003 EARS-37, decision Б), read from the FieldSpec SSOT so the hint the
  // doctor reads cannot drift from the rule that rejects them.
  passwordPolicyHint: registerFieldHint("password") ?? undefined,
  // 003 EARS-38 (#1663): the reveal control ships with `<PasswordField>`; this
  // door owns only its RU labels, stated here rather than inherited silently so
  // the storefront's copy stays in one place.
  passwordRevealLabels: {
    show: "Показать",
    hide: "Скрыть",
    showAria: "Показать пароль",
    hideAria: "Скрыть пароль",
  },
  submit: "Зарегистрироваться",
  accessGroupHeading: ACCESS_CONDITIONS_HEADING,
} as const;

/**
 * Client validation is a UX affordance only (EARS-11) — the BFF and the IdP stay
 * the credential authority. Every rule is DERIVED from the `DOCTOR_REGISTER_FIELD_SPECS`
 * SSOT through `registerFieldRules()`; no bound (8 / 64) and no policy sentence
 * is re-typed on this screen, so the hint above and the rules below cannot
 * disagree, and the `PASSWORD_MAX_LENGTH` upper bound the SSOT carries applies
 * to this door too.
 */
const FIELD_RULES = {
  email: registerFieldRules("email"),
  password: registerFieldRules("password"),
  promoCode: registerFieldRules("promoCode"),
} as const;

/** The item of a tier carrying this purpose, or `undefined` when unsupplied. */
function findConsentItem(
  tiers: readonly ConsentTier[] | undefined,
  purpose: string,
): ConsentItem | undefined {
  return tiers
    ?.flatMap((tier) => tier.items)
    .find((item) => item.purpose === purpose);
}

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

/**
 * 021 EARS-11 — the code field's message, taken from the FieldSpec projection
 * so the rule that rejects and the copy that explains cannot drift apart.
 */
const CONFIRM_CODE_INVALID = REGISTER_FIELD_MESSAGES.code.invalid;
const CONFIRM_FAILED = "Код не подошёл. Попробуйте ещё раз.";
const CONFIRM_RESEND_FAILED =
  "Не удалось отправить код повторно. Попробуйте ещё раз.";
const CONFIRM_RESEND_ACKNOWLEDGED = (destination: string) =>
  `Если регистрация ещё не подтверждена, мы повторно отправили код на ${destination}.`;

export function RegistrationScreen({
  returnContext,
  landing,
  returnTarget,
  attribution,
  pointsPromise,
  consentTiers,
}: RegistrationScreenProps) {
  const partnerDataItem = findConsentItem(
    consentTiers,
    PARTNER_DATA_SHARING_PURPOSE,
  );
  const marketingItem = findConsentItem(
    consentTiers,
    MARKETING_COMMUNICATIONS_PURPOSE,
  );

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
   * `RegisterDoctor` (021 design §2) — the command this host owns, run behind
   * the invisible challenge: `request()` mounts one fresh widget instance, and
   * the pending closure below resumes with the minted token (or, with no site
   * key configured, tokenless — exactly matching the guard's no-op when the
   * provider is disabled).
   */
  const onSubmit = useCallback(
    (values: RegisterCardValues) => {
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
        if (marketingItem && values.consents.marketingCommunications) {
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

  /**
   * EARS-4/EARS-5/EARS-6 — the consent read model, in the order the doctor
   * reads it. The statements of the two data-driven rows are NOT written here:
   * they arrive built from the declared composition (`@ds/schemas` →
   * `formatPartnerDataStatement`), so changing what is shared changes the
   * sentence the doctor reads and the recorded purpose together (design §4's
   * "data-driven, not a copy blob").
   */
  const consentItems: RegisterCardConsentItem[] = [
    {
      id: "medicalWorkerDeclaration",
      tier: "access",
      label: MEDICAL_WORKER_DECLARATION_LABEL,
      help: MEDICAL_WORKER_DECLARATION_HELP,
      unmetMessage: MEDICAL_WORKER_DECLARATION_UNMET,
      itemTestId: "register-medworker-item",
      testId: "register-medworker",
      helpTestId: "register-medworker-help",
    },
  ];
  if (partnerDataItem) {
    consentItems.push({
      id: "partnerDataSharing",
      tier: "access",
      label: partnerDataItem.statement,
      labelTestId: "register-partner-data-statement",
      help: PARTNER_DATA_HELP,
      helpTestId: "register-partner-data-help",
      unmetMessage: PARTNER_DATA_UNMET,
      itemTestId: "register-partner-data-item",
      testId: "register-partner-data",
    });
  }
  if (marketingItem) {
    consentItems.push({
      id: "marketingCommunications",
      tier: "marketing",
      label: marketingItem.statement,
      optionalTag: MARKETING_OPTIONAL_TAG,
      optionalTagTestId: "register-marketing-optional-tag",
      help: MARKETING_HELP,
      helpTestId: "register-marketing-help",
      testId: "register-marketing",
    });
  }

  return (
    <RegisterCard
      copy={REGISTER_COPY}
      icon={<RegistrationGlyph />}
      spacing="md"
      // The doctor door puts the button and its EARS-12 reason FIRST, so the
      // reason sits immediately under the control it explains. A Stage-B
      // evidenced order — it does not change without a re-confirmation.
      submitBlock="submit-first"
      // The button is already the EARS-12 disabled control; a spinner would add
      // a second, competing busy signal to the shipped render.
      pendingAffordance="inert"
      pending={captcha.pending}
      // EARS-3 — the server's landing decision, carried on the element the
      // command belongs to. A data attribute rather than a hidden input:
      // nothing submits it (the request contract has no return-target field),
      // and nothing on the client recomputes it.
      formDataAttributes={{ "data-registration-landing": landing }}
      returnContextSlot={returnContext}
      attributionSlot={attribution}
      aboveSubmitSlot={
        pointsPromise ? (
          <div data-testid="registration-points-promise">{pointsPromise}</div>
        ) : null
      }
      captchaSlot={
        // The invisible challenge itself. It renders nothing until a submit
        // requests it and nothing at all without a site key — the dev-stand and
        // CI default, where the pending action resumes tokenless and the guard
        // no-ops in the same way.
        <BotProtectionField
          sitekey={botProtectionSiteKey()}
          {...captcha.fieldProps}
        />
      }
      promo={{
        label: "Промокод — если есть",
        placeholder: "DS-2026",
        testId: "register-promo",
        // No `maxLength` literal: the bound and its message travel with
        // `fieldRules.promoCode`, derived from `PROMO_CODE_MAX_LENGTH`.
      }}
      fieldRules={FIELD_RULES}
      consentItems={consentItems}
      // EARS-12 — with an empty consent read model the partner-data row is not
      // rendered, but the server still refuses without that purpose, so the
      // reason names the unmet access condition rather than nothing at all.
      unmetPrecondition={partnerDataItem ? null : PARTNER_DATA_UNMET}
      consentNote={consentTiers?.length ? CONSENT_MANAGER_NOTE : null}
      errors={{ challenge: captchaError, command: commandError }}
      onSubmit={onSubmit}
      // 021 EARS-19 — a command that succeeded never shows nothing. The door
      // becomes the canonical 003 confirmation state, and the form's own
      // surroundings do NOT travel with it: the return context, the attribution
      // line and the points promise are pre-submission framing of a decision the
      // doctor has now made.
      confirmation={
        pendingEmail ? (
          <RegistrationConfirmation
            email={pendingEmail}
            landing={landing}
            returnTarget={returnTarget}
          />
        ) : null
      }
      testIds={{
        root: "registration-screen",
        card: "registration-form-card",
        form: "registration-form",
        returnContext: "registration-return-context",
        attribution: "registration-attribution",
        email: "register-email",
        password: "register-password",
        promo: "register-promo",
        submit: "register-submit",
        submitReason: "register-submit-reason",
        challengeError: "register-captcha-error",
        commandError: "register-command-error",
        accessGroup: "registration-consent-access",
        marketingGroup: "registration-consent-marketing",
        note: "registration-consent-manager-note",
      }}
    />
  );
}
/**
 * 021 EARS-11 — the RHF resolver for the confirmation code, hand-rolled over
 * the `code` FieldSpec.
 *
 * Hand-rolled and not `@hookform/resolvers/zod`: the doctor storefront does not
 * carry that dependency, and adding a package to translate three lines of issue
 * mapping would be the heavier change. It stays a projection of the SSOT all
 * the same — the shape is never re-declared here, only its failure is given the
 * screen's Russian wording, which is exactly the split the block's `resolver`
 * prop exists for (copy is the host's, the contract is `@ds/schemas`').
 *
 * The guard is deliberately CASE-INSENSITIVE (LD-9): the emitted code is
 * alphanumeric, the widget normalises the value to upper case and the 003
 * engine normalises again server-side, so a lowercase-typed code is a valid
 * code. The REQUEST contract stays loose (`DoctorConfirmRequestSchema.code` is
 * `z.string()`, LD-1) — this length/charset vocabulary is the client guard
 * only.
 */
const confirmResolver: Resolver<EmailConfirmValues> = (values) => {
  const message = resolveVerificationCode(values.code);
  const result: ResolverResult<EmailConfirmValues> =
    message === null
      ? { values, errors: {} }
      : { values: {}, errors: { code: { type: "validate", message } } };
  return result;
};

/**
 * 021 EARS-19 / 003 EARS-3 + EARS-25 — the post-submit state, and the SECOND
 * bot-protected surface this Issue owns.
 *
 * The composition is not written here: `<EmailConfirmCard>` is the ONE canonical
 * email-confirmation block both storefronts mount (#1902, AGENTS.md §6
 * cross-front reuse), so this is a host projection of it — RU copy, the resolver
 * above, and the transport. The code ENGINE is 003's shipped one, unchanged: the
 * storefront confirm command delegates to it and a resend goes straight to
 * `@BotProtected("verify-resend")` `/v1/auth/verify/resend`, which is why every
 * resend mints its own token through the same challenge the registration submit
 * ran.
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
 *
 * WHERE A CONFIRMED DOCTOR LANDS (#1546, EARS-10) is decided here, which is why
 * the code goes to the STOREFRONT confirm command rather than 003's
 * `/v1/auth/verify`: that command runs the same 003 engine and answers with the
 * 021 success state, so ONE round trip both accepts the code and names the
 * destination — a client that called both routes would verify the code twice.
 *
 * On success this surface is REPLACED by `<RegistrationSuccessCard>` rather than
 * annotated: the canvas «Успех» artboard is its own screen, so the confirmation
 * card and the success state never stand on the page together. A rejected code
 * stays on the EARS-16 generic failure — the confirm command is no more of an
 * oracle than the 003 route it delegates to.
 */
function RegistrationConfirmation({
  email,
  landing,
  returnTarget,
}: {
  email: string;
  landing: string;
  returnTarget?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<RegistrationSuccessView | null>(null);
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
      // Mapped field by field rather than cast: a future field on the confirm
      // contract must fail typecheck here instead of shipping a silent omission.
      // `returnTo` rides the SAME command as the code, so the server decides the
      // destination with the verification it just performed — there is no second
      // hop in which the target could go stale unobserved.
      const confirmed = await confirmDoctorEmail({
        email: values.email,
        code: values.code,
        ...(returnTarget ? { returnTo: returnTarget } : {}),
      });
      setSuccess(resolveRegistrationSuccess(confirmed, landing));
    } catch {
      setSuccess(null);
      setError(CONFIRM_FAILED);
    }
  }

  // EARS-10 — the success state REPLACES the code screen rather than annotating
  // it: the code has been accepted, so the surface the doctor is looking at is
  // no longer «введите код», and leaving the code form behind the outcome would
  // offer an action that can only fail from here.
  if (success) {
    return (
      <RegistrationSuccessCard
        icon={<SuccessGlyph />}
        title={success.title}
        accrual={success.accrual}
        {...(success.profileCompletion
          ? { profileCompletion: success.profileCompletion }
          : {})}
        {...(success.reason ? { reason: success.reason } : {})}
        primary={success.primary}
        secondary={success.secondary}
      />
    );
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
 * The success state's glyph — a check mark, drawn inline for the same reason the
 * envelope above is. Decorative only: «Почта подтверждена» carries the meaning,
 * and the outcome is also announced by the card's own copy rather than by a
 * mark a screen reader never sees.
 */
function SuccessGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M4 12l6 6L20 6" strokeWidth="2" strokeLinecap="square" />
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
