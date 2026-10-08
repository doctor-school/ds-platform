/**
 * The browser-tab title of each auth screen, «<Экран> — Doctor.School».
 *
 * #2470 — a screen is ONE thing on both storefronts, and its tab name is part
 * of it: both hosts mount the same doors, so both project these titles into
 * their page `metadata` instead of restating the words per app. A host's
 * `description` stays its own — that sentence genuinely differs by storefront.
 */
export const AUTH_FLOW_PAGE_TITLES = {
  login: "Вход — Doctor.School",
  register: "Регистрация — Doctor.School",
  verify: "Подтверждение почты — Doctor.School",
  reset: "Восстановление пароля — Doctor.School",
} as const;
