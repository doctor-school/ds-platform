import { botProtectionSiteKey } from "@ds/auth-flow/bot-protection";
import { withRuntimeBotProtection } from "@ds/auth-flow/bot-protection/server";
import { ACADEMY_AUTH_FLOW } from "@ds/auth-flow/hosts";
import type { Metadata } from "next";

import { AcademyHomeView } from "./academy-home-view";

export const metadata: Metadata = {
  title: "Academy home demo — Doctor.School",
  description:
    "Статичная демонстрация утверждённой главной страницы Academy без данных и отправки форм.",
};

export default function AcademyHomePage() {
  // 033 EARS-18 — the partnership form's invisible challenge. The key is read
  // per request through the same `@ds/auth-flow` server reader the auth doors
  // use (#2981); unset (the dev-stand default) the form posts tokenless, as the
  // api guard expects.
  const config = withRuntimeBotProtection(ACADEMY_AUTH_FLOW);
  return (
    <AcademyHomeView botProtectionSiteKey={botProtectionSiteKey(config)} />
  );
}
