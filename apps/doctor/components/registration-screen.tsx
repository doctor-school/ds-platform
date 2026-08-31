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
import { EmailField, PasswordField } from "@ds/design-system/fields";
import { Input } from "@ds/design-system/input";

/**
 * 021 EARS-1 — the doctor registration screen (`design-source/auth.dc.html`,
 * the `#d-register` branch of the split composition).
 *
 * This is the ENVELOPE, not the whole feature. The canvas's split screen has a
 * navy brand panel on the left and the bordered form card on the right, and the
 * card is surrounded by four things this slice does not own: the return context
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
 * • **No header, nav or footer.** 017 owns all three in
 *   `app/(storefront)/layout.tsx`; EARS-1 forbids 021 defining or duplicating
 *   any of them. This component starts at the split and ends at the split.
 *
 * • **No submit.** The button renders, disabled, with its reason stated beside
 *   it (EARS-12). Design §2 is explicit that no public 021 form may reach a
 *   003 EARS-17-protected endpoint without the EARS-19 bot-protection client
 *   half — and that widget is portal-local (`apps/portal/components/bot-protection/`),
 *   so `apps/doctor` has none yet. Wiring `RegisterDoctor` here would ship the
 *   untracked seam design §2 names by name. The mandatory access-condition
 *   consents (EARS-4/EARS-5) are likewise a precondition of the command and
 *   land in #1540/#1541, so the reason line states the real unmet condition rather
 *   than a build-status note.
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
 * Tokens only, from the 017 storefront vocabulary (`bg-hero`,
 * `text-hero-foreground`, `text-hero-muted`, `max-w-container-content`) and the
 * `layout:` breakpoint (901px), which IS the canvas's 900px split collapse.
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
   * The two consent tiers — tier 1 carries the medical-worker declaration
   * (EARS-4, #1540) and the two-tier consent block (EARS-5, #1541); tier 2 is
   * the optional marketing opt-in (EARS-6, #1542).
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
};

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
    defaultValues: { email: "", password: "", promoCode: "" },
  });

  const reasonId = `${useId()}-register-submit-reason`;

  return (
    <div
      data-testid="registration-screen"
      className="grid grid-cols-1 layout:min-h-svh layout:grid-cols-2"
    >
      {/*
        Canvas `order:1` — the navy brand panel. Below the split's collapse the
        canvas drops it entirely rather than stacking it above the form, so this
        is `hidden` until `layout:` (901px) and never a squeezed mobile band.
        `aria-hidden` is NOT set: it carries real, readable positioning copy.
      */}
      <aside
        data-testid="registration-brand-panel"
        className="hidden flex-col justify-center bg-hero px-12 py-20 text-hero-foreground layout:flex"
      >
        <div className="max-w-prose">
          <p className="mb-5 text-xs font-extrabold uppercase tracking-widest text-hero-muted">
            Врачи учат врачей
          </p>
          <p className="text-4xl font-extrabold leading-tight tracking-tight text-balance">
            Учитесь у практикующих врачей
          </p>
          <p className="mt-6 text-base font-medium leading-relaxed text-hero-muted">
            {/*
              The canvas reads «… от практикующих врачей 38 школ.» The count has
              no source in the read model, and the 017 precedent
              (`storefront-hero.tsx` / `scale-counters.tsx`) omits a counter with
              no source rather than hardcoding one. Dropped, not zeroed.
            */}
            Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.
          </p>
        </div>
      </aside>

      {/* Canvas `order:2` — the form column. */}
      <div className="flex justify-center px-4 py-12 layout:px-12 layout:py-20">
        <div className="flex w-full max-w-lg flex-col gap-4.5">
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
                    required: "Введите рабочую почту — на неё придёт код подтверждения.",
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
                      message: "Пароль слишком короткий — нужно не менее 8 символов.",
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
                      message: "Промокод длиннее 64 символов — проверьте, что скопировали только код.",
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

                {/* Tier 1 — access conditions, ABOVE the submit (EARS-5). */}
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
                    Регистрацию нельзя отправить без обязательных согласий —
                    блок условий доступа встанет на форму следующим шагом.
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
      </div>
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
