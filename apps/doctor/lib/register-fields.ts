import {
  DOCTOR_REGISTER_FIELD_SPECS,
  PASSWORD_MIN_LENGTH,
  PROMO_CODE_MAX_LENGTH,
  type DoctorRegisterFieldName,
} from "@ds/schemas";

/**
 * 021 EARS-11 (#1547) — the host projection of the per-field validation
 * contract.
 *
 * `DOCTOR_REGISTER_FIELD_SPECS` (`@ds/schemas`) is the SSOT: it owns the rule,
 * the mask and the hint of every field the registration flow renders. This
 * module owns the half that is the STOREFRONT's — the Russian wording — and
 * hands react-hook-form a `rules` object derived from the spec, so no bound is
 * ever typed twice. A literal `8` / `64` / `6` in `registration-screen.tsx` is
 * exactly the drift this module exists to prevent; the numbers that appear in
 * the copy below are interpolated from the same constants the rules use.
 */

interface RegisterFieldCopy {
  /** The empty-box message, for fields the form requires. */
  readonly required?: string;
  /** The rule-violation message. */
  readonly invalid: string;
}

/**
 * The RU catalog. Evidence-backed copy, kept verbatim from the screen it was
 * moved out of — the wording is a product decision (#1548 owns any rewording),
 * this module only stops it from being co-located with the bounds.
 */
export const REGISTER_FIELD_MESSAGES: Record<
  DoctorRegisterFieldName,
  RegisterFieldCopy
> = {
  email: {
    required: "Введите рабочую почту — на неё придёт код подтверждения.",
    invalid: "Проверьте адрес: он должен быть вида doctor@clinic.ru.",
  },
  password: {
    required: `Придумайте пароль не короче ${PASSWORD_MIN_LENGTH} символов.`,
    // 003 EARS-37 (owner decision Б) — the error RESTATES the rule the hint
    // states, because the shared slot shows one or the other, never both.
    invalid: `Пароль слишком короткий — нужно не менее ${PASSWORD_MIN_LENGTH} символов.`,
  },
  promoCode: {
    invalid: `Промокод длиннее ${PROMO_CODE_MAX_LENGTH} символов — проверьте, что скопировали только код.`,
  },
  code: {
    invalid: "Введите код из письма.",
  },
};

/** The react-hook-form `rules` object a field of this screen binds. */
export interface RegisterFieldRules {
  readonly required?: string;
  readonly validate: (value: unknown) => true | string;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

/**
 * Derives the RHF rules for one field from its {@link FieldSpec}.
 *
 * The blank case is deliberately delegated: a required field's empty box is
 * reported by `required` (one message, not two), and an optional field's empty
 * box is valid. Everything else is the spec's `rule`, which is why the message
 * is the only thing this function supplies.
 */
export function registerFieldRules(
  name: DoctorRegisterFieldName,
): RegisterFieldRules {
  const spec = DOCTOR_REGISTER_FIELD_SPECS[name];
  const copy = REGISTER_FIELD_MESSAGES[name];

  return {
    ...(copy.required === undefined ? {} : { required: copy.required }),
    validate: (value: unknown) => {
      if (isBlank(value)) {
        return true;
      }
      return spec.rule.safeParse(value).success ? true : copy.invalid;
    },
  };
}

/** The persistent pre-submit hint of a field, or `null` when it has none. */
export function registerFieldHint(name: DoctorRegisterFieldName): string | null {
  return DOCTOR_REGISTER_FIELD_SPECS[name].hint;
}

/**
 * Validates a typed confirmation code against the `code` FieldSpec, returning
 * the RU message or `null` when it passes.
 *
 * Case-insensitive by contract (LD-9/LD-1): the widget normalises the value to
 * upper case and the 003 engine normalises again server-side, so a
 * lowercase-typed code is a valid code and must not be refused here.
 */
export function resolveVerificationCode(value: unknown): string | null {
  const spec = DOCTOR_REGISTER_FIELD_SPECS.code;
  return spec.rule.safeParse(value).success
    ? null
    : REGISTER_FIELD_MESSAGES.code.invalid;
}
