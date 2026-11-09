import { test } from "@playwright/test";
import { HOSTS } from "@ds/e2e/hosts";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";
import { signInWithPassword } from "@ds/e2e/sign-in";

import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * #3829 — the signed-in Academy cabinet `/account` is compared, as a
 * structure, with its vendored canvas `design-source/account-profile.dc.html`,
 * variant «Разделы», `host` «Академия» (the R1 account canon, the
 * `account-profile` row of design-source/README.md): every visible control of
 * the page body, by kind + visible label, count and order, at 390 and 1440 —
 * the Academy twin of the doctor check `apps/doctor/e2e/account-canvas-structure-live.spec.ts`
 * (#3758), over the same `@ds/account` surface.
 *
 * The canvas's phone row and congress row are STATE switches, not data: the
 * spec reads which state the signed-in account is in from the api the cabinet
 * itself reads (`GET /v1/me/profile`, `GET /v1/me/congress-submissions`), never
 * from the rendered page, and draws the canvas in that state. Sample values
 * (name, email, phone number) are text, not controls, and are never compared.
 *
 * Not compared: `/account/events` ↔ `account-my-events.dc.html` — that canvas
 * labels no section (no `data-screen-label`), so the slot reader has no
 * section to read; it is compared once a vendoring pass labels it.
 *
 * Live tier `live/academy/default`, signed in as the run's golden doctor
 * (`E2E_DOCTOR_EMAIL` / `E2E_DOCTOR_PASSWORD`), so it is a `golden-account`
 * spec (`playwright.config.ts`) and a gated entry of the leg
 * (`tools/staging/live-tiers.mjs`). Unset, the spec is inert; half-set, it
 * fails by variable name.
 */

requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
]);

/** The canvas's phone `phase` for an account, as the app's `initialPhase`. */
type CanvasPhonePhase = "none" | "app" | "unconfirmed" | "confirmed";

/** The canvas's `phone` prop that seeds each phase (its constructor's map). */
const PHONE_PROP: Record<CanvasPhonePhase, string> = {
  none: "не указан",
  app: "из заявки",
  unconfirmed: "не подтверждён",
  confirmed: "подтверждён",
};

interface AccountState {
  phase: CanvasPhonePhase;
  congress: "есть заявка" | "нет заявки";
}

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy /account ≡ account-profile canvas · signed-in · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the cabinet body has the canvas structure (controls by kind + label)", async ({
      page,
    }) => {
      await signInWithPassword(page, HOSTS.academy, {
        email: process.env.E2E_DOCTOR_EMAIL!,
        password: process.env.E2E_DOCTOR_PASSWORD!,
      });
      await page.goto("/account", { waitUntil: "domcontentloaded" });
      await page.getByTestId("logout").waitFor();

      const state = await page.evaluate(async (): Promise<AccountState> => {
        const res = await fetch("/v1/me/profile", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`GET /v1/me/profile → ${res.status}`);
        const p = (await res.json()) as {
          phone: string | null;
          phoneVerified: boolean | null;
          suggestedPhone: string | null;
        };
        const phase: CanvasPhonePhase =
          p.phone && p.phoneVerified
            ? "confirmed"
            : p.phone
              ? "unconfirmed"
              : p.suggestedPhone
                ? "app"
                : "none";
        // The cabinet hides the row on any failed read (account-cabinet.tsx).
        const section = await fetch("/v1/me/congress-submissions", {
          credentials: "same-origin",
        });
        const registered =
          section.ok &&
          ((await section.json()) as { registered?: boolean }).registered ===
            true;
        return { phase, congress: registered ? "есть заявка" : "нет заявки" };
      });
      if (state.congress === "есть заявка") {
        await page
          .getByRole("link", { name: /Мои заявки на Конгресс/ })
          .waitFor();
      }

      await expectSlotSectionMatchesCanvas(page, {
        canvas: "account-profile.dc.html",
        props: {
          host: "Академия",
          variant: "Разделы",
          congress: state.congress,
          phone: PHONE_PROP[state.phase],
        },
        section: {
          section: ["data-screen-label", "Профиль · Разделы"],
          cards: [],
        },
        rendered: { root: "main" },
      });
    });
  });
}
