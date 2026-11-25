import type { Metadata } from "next";

import { AcademyHomeView } from "./academy-home-view";

export const metadata: Metadata = {
  title: "Academy home demo — Doctor.School",
  description:
    "Статичная демонстрация утверждённой главной страницы Academy без данных и отправки форм.",
};

/**
 * The runtime env the public SmartCaptcha site key is read from (#2981 — one
 * image serves every environment; the root layout's `connection()` makes this
 * a per-request read). The same variable the `@ds/auth-flow` door mounts read.
 */
const SMARTCAPTCHA_SITE_KEY_ENV = "SMARTCAPTCHA_SITE_KEY";

export default function AcademyHomePage() {
  // 033 EARS-18 — the partnership form's invisible challenge; unset (the
  // dev-stand default) the form posts tokenless, as the api guard expects.
  const botProtectionSiteKey =
    process.env[SMARTCAPTCHA_SITE_KEY_ENV]?.trim() || undefined;
  return <AcademyHomeView botProtectionSiteKey={botProtectionSiteKey} />;
}
