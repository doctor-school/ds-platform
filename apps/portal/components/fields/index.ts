/**
 * Semantic auth field primitives (#197) — the registry the ESLint gate
 * (`local/no-raw-auth-field-input`) points call sites at. Each primitive bakes in
 * the validation + (where relevant) mask + a11y + RU copy for one credential field
 * type, so a raw design-system `<Input>` is never wired by hand on an auth surface
 * (the #192/#196 defect class). The per-field zod resolver fragments each primitive
 * owns live in `field-schemas.ts`; forms compose their RHF resolver from those.
 */
export { EmailField } from "./email-field";
export { PhoneField } from "./phone-field";
export { OtpField } from "./otp-field";
export { PasswordField } from "./password-field";
export { IdentifierField } from "./identifier-field";

export {
  EmailFieldSchema,
  PhoneFieldSchema,
  IdentifierFieldSchema,
  OtpCodeFieldSchema,
  NewPasswordFieldSchema,
  CurrentPasswordFieldSchema,
} from "./field-schemas";

export { maskPhoneInput } from "./phone-mask";
