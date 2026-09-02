"use client";

import { useId, type ReactNode } from "react";
import { useForm } from "react-hook-form";

import { AuthCard } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import { Checkbox } from "@ds/design-system/checkbox";
import { EmailField, PasswordField } from "@ds/design-system/fields";
import { Input } from "@ds/design-system/input";

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
 * (#1538), the attribution line (#1544), the points promise (#1545) and the two
 * consent tiers (#1541/#1542). They arrive here as props, and — per EARS-3's
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
 *   than a build-status note. EARS-4 has since landed (#1540): the declaration
 *   is on the form, and the reason line now names IT while it is unticked, and
 *   the partner-data consent once it is not.
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
  /** The resolved representative/organisation line (EARS-8, #1544). */
  attribution?: ReactNode;
  /** The pre-submission points promise read from configuration (EARS-9, #1545). */
  pointsPromise?: ReactNode;
  /**
   * The remaining consent tiers. Tier 1's medical-worker declaration (EARS-4,
   * #1540) is NOT a slot — it is a precondition of the command this screen
   * owns, so it is rendered here unconditionally; `accessConditions` carries
   * what stands beside it, the partner-data consent of the two-tier block
   * (EARS-5, #1541). Tier 2 is the optional marketing opt-in (EARS-6, #1542).
   */
  consentTiers?: {
    /** Tier 1 — access conditions, rendered ABOVE the submit. */
    accessConditions?: ReactNode;
    /** Tier 2 — the optional marketing opt-in, rendered BELOW the submit. */
    marketing?: ReactNode;
  };
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

export function RegistrationScreen({
  returnContext,
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
    },
  });

  const reasonId = `${useId()}-register-submit-reason`;

  // EARS-12 — the reason beside the disabled submit names the SPECIFIC unmet
  // condition. While the declaration is unticked that is the declaration, in the
  // canvas's own words; once it is ticked the next real obstacle is stated
  // instead. The submit stays disabled either way in this slice because the
  // command is still unreachable — the partner-data consent (EARS-5, #1541) and
  // the bot-protection client half (EARS-19, #1558) are both preconditions of it,
  // and wiring the button past them would ship the untracked seam design §2
  // names by name.
  const declared = form.watch("medicalWorkerDeclaration");
  const submitReason = declared
    ? "Регистрацию нельзя отправить без согласия на передачу данных партнёрам — этот блок встанет на форму следующим шагом."
    : MEDICAL_WORKER_DECLARATION_UNMET;

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
            className="flex flex-col gap-4.5"
            noValidate
            // The command is not wired in this slice (see the header note);
            // the browser must not fall back to a native GET submission.
            onSubmit={(event) => event.preventDefault()}
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
                        <span className="flex flex-wrap items-center gap-2">
                          {MEDICAL_WORKER_DECLARATION_LABEL}
                          {/*
                            The canvas's «обязательно» tag: the requirement is
                            stated on the control itself, not inferred from an
                            asterisk.
                          */}
                          <span className="border border-border px-1 text-xs uppercase text-muted-foreground">
                            обязательно
                          </span>
                        </span>
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

            {/* Tier 1 — the remaining access conditions, ABOVE the submit (EARS-5). */}
            {consentTiers?.accessConditions ? (
              <div data-testid="registration-consent-access">
                {consentTiers.accessConditions}
              </div>
            ) : null}

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
                disabled
                aria-describedby={reasonId}
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
              <p
                id={reasonId}
                data-testid="register-submit-reason"
                className="text-sm font-medium text-muted-foreground"
              >
                {submitReason}
              </p>
            </div>

            {/* Tier 2 — the optional marketing opt-in, BELOW the submit. */}
            {consentTiers?.marketing ? (
              <div data-testid="registration-consent-marketing">
                {consentTiers.marketing}
              </div>
            ) : null}
          </form>
        </Form>
      </AuthCard>
    </div>
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
