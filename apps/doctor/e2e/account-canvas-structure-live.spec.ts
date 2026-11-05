import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

import { loginAsDoctor } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * #3758 — the signed-in doctor cabinet `/account` is compared, as a structure,
 * with its vendored canvas: every visible control of the page body, by kind +
 * visible label, count and order (`diffSlots` chrome — the page repeats no
 * card), at 390 and 1440.
 *
 * WHICH canvas. `/account` ships the R1 account surface — `@ds/account`
 * mounting `<AccountProfileCard>` — whose canon is `account-profile.dc.html`,
 * variant «Разделы», host «витрина врача» (design-source/README.md, the
 * `doctor-cabinet` row and the consolidation table; the wave-4 entry gate
 * `specs/tech/2026-10-20-account-room-wave-4-entry-gate-en.md` §1 «Canvas
 * precondition» and §2.3). `doctor-cabinet.dc.html` is the 022 (R5) canvas —
 * poster with roles, tabs, verification row, points, my events, documents,
 * «разбор врачебных ошибок» — and none of its sections is built («Nothing of
 * 022 is built or decided here», gate §2.3), so it has no section to connect
 * until 022 replaces this projection.
 *
 * The canvas's phone row and congress row are STATE switches, not data: the
 * spec reads which state the signed-in account is in from the api the cabinet
 * itself reads (`GET /v1/me/profile`, `GET /v1/me/congress-submissions`), never
 * from the rendered page, and draws the canvas in that state. Sample values
 * (the canvas's name, email, phone number) are never compared — they are
 * text, not controls.
 *
 * ENV SET: as `shell-live.spec.ts` (`playwright.shell.config.ts`).
 */

requireLiveStandEnv(["E2E_DOCTOR_URL", "E2E_DOCTOR_EMAIL", "E2E_DOCTOR_PASSWORD"]);

/** The canvas's phone `phase` for an account, as the app's `initialPhase`. */
type CanvasPhonePhase = "none" | "app" | "unconfirmed" | "confirmed";

interface AccountState {
  phase: CanvasPhonePhase;
  congress: "есть заявка" | "нет заявки";
}

for (const width of [390, 1440]) {
  test.describe(`#3758 /account ≡ account-profile canvas · signed-in · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the cabinet body has the canvas structure (controls by kind + label)", async ({
      page,
    }) => {
      await loginAsDoctor(page);
      await page.goto("/account", { waitUntil: "domcontentloaded" });
      await page.getByTestId("logout").waitFor();

      const state = await page.evaluate(async (): Promise<AccountState> => {
        const res = await fetch("/v1/me/profile", { credentials: "same-origin" });
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
          section.ok && ((await section.json()) as { registered?: boolean }).registered === true;
        return { phase, congress: registered ? "есть заявка" : "нет заявки" };
      });
      // The congress row is read after the profile resolves; let it settle.
      if (state.congress === "есть заявка") {
        await page.getByRole("link", { name: /Мои заявки на Конгресс/ }).waitFor();
      }

      await expectSlotSectionMatchesCanvas(page, {
        canvas: "account-profile.dc.html",
        input: {
          props: { host: "витрина врача", variant: "Разделы", congress: state.congress },
          // `isMobile` is the canvas's own `(max-width: 1023px)` query. The
          // canvas constructor seeds `phase` from its `phone` prop; the
          // check evaluates `renderVals()` on state, so the phase goes there.
          state: { isMobile: width <= 1023, phase: state.phase },
        },
        section: { section: ["data-screen-label", "Профиль · Разделы"], cards: [] },
        rendered: { root: "main" },
      });
    });
  });
}
