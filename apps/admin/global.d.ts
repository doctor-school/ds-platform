import type ruMessages from "./messages/ru.json";

/**
 * Type-safe i18n (007 EARS-10). next-intl reads the `Messages` interface from the
 * global `IntlMessages` augmentation to type-check translation keys at compile
 * time, so a typo in `t("events.titel")` is a build error, not a silent
 * missing-message at runtime. `ru` is the canonical catalog (the only locale
 * today), so its shape is the source of truth for the key space.
 */
type Messages = typeof ruMessages;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
