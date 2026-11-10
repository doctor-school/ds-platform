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

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
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
  test.describe(`#3758 /account ≡ account-profile canvas · signed-in · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the cabinet body has the canvas structure (controls by kind + label)", async ({
      page,
    }) => {
      await loginAsDoctor(page);
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
      // The congress row is read after the profile resolves; let it settle.
      if (state.congress === "есть заявка") {
        await page
          .getByRole("link", { name: /Мои заявки на Конгресс/ })
          .waitFor();
      }

      await expectSlotSectionMatchesCanvas(page, {
        canvas: "account-profile.dc.html",
        // The runtime renders the canvas on this viewport (its own
        // `(max-width: 1023px)` query); `phone` seeds the phone row's phase.
        props: {
          host: "витрина врача",
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

/**
 * #3891 — the signed-in «Мои заявки на Конгресс» `/account/congress` against
 * its canvas `doctor-lk-congress.dc.html` (`@ds/congress-submissions`, whose
 * markup carries the canvas's own `data-screen-label` names), section by
 * section, at 390 and 1440, in the same live leg as the cabinet check.
 *
 * The canvas `screen` is a STATE switch, read from the api the section itself
 * reads (`GET /v1/me/congress-submissions`), never from the rendered page: no
 * registration → «нет регистрации»; registered with no submission → «пусто»
 * (the kind picker alone); registered with submissions → «список». Repeated
 * data compares by shape only (#3728): the picker's kind columns (`pk`), the
 * status filter chips (`f`) and the submission rows (`r`) — their labels,
 * counts and statuses are the account's data, the canvas's are samples.
 *
 * Compared: the poster band (`постер-шапка`, chrome by kind + label) and the
 * state's body section — `нет регистрации` (chrome), `выбор вида` (head chrome
 * + kind columns by shape), `список` (head chrome + chips and rows by shape).
 *
 * Not compared:
 * - `загрузка` / `ошибка` — transient read states the signed-in page passes
 *   through or never reaches on a healthy stand; the spec waits them out.
 * - an OPEN submission (`posterApp`, `заявка`, `сводка ошибок`, `панель
 *   отправки`, `подтверждение отправки`) — reached only by opening a row and
 *   editing; the shared account owns no submission the check may open or
 *   change, and the form's states are the axe tier's fixture rows
 *   (`congress-axe.e2e.spec.ts`, `playwright.congress.config.ts`).
 * - the `today` switch — the canvas's sample intake calendar; the app's
 *   intake is the stand's congress settings, so the kind columns compare by
 *   shape, never by which window is open.
 */

/** The canvas `screen` that draws the account's state. */
type CongressScreen = "нет регистрации" | "пусто" | "список";

const POSTER = "d-lk-congress · постер-шапка";
const BODY: Record<
  CongressScreen,
  { label: string; repeats: string[]; card?: string }
> = {
  "нет регистрации": { label: "d-lk-congress · нет регистрации", repeats: [] },
  пусто: {
    label: "d-lk-congress · выбор вида",
    repeats: ["pk"],
    card: '[data-testid^="congress-pick-"]',
  },
  список: {
    label: "d-lk-congress · список",
    repeats: ["f", "r"],
    card: '[data-screen-label="d-lk-congress · фильтр по статусу"] > button, [data-testid="congress-row"]',
  },
};

for (const width of [390, 1440]) {
  test.describe(`#3891 /account/congress ≡ doctor-lk-congress canvas · signed-in · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the section has the canvas structure (poster band + the state's body)", async ({
      page,
    }) => {
      await loginAsDoctor(page);
      await page.goto("/account/congress", { waitUntil: "domcontentloaded" });

      const screen = await page.evaluate(async (): Promise<CongressScreen> => {
        const res = await fetch("/v1/me/congress-submissions", {
          credentials: "same-origin",
        });
        if (!res.ok)
          throw new Error(`GET /v1/me/congress-submissions → ${res.status}`);
        const s = (await res.json()) as {
          registered: boolean;
          submissions: unknown[];
        };
        if (!s.registered) return "нет регистрации";
        return s.submissions.length === 0 ? "пусто" : "список";
      });
      const body = BODY[screen];
      // The section reads on the client: wait for the state's own section.
      await page.locator(`[data-screen-label="${body.label}"]`).waitFor();

      const props = { screen, showNotes: false };
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-lk-congress.dc.html",
        props,
        section: { section: ["data-screen-label", POSTER], cards: [] },
        rendered: { root: `[data-screen-label="${POSTER}"]` },
      });
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-lk-congress.dc.html",
        props,
        section: {
          section: ["data-screen-label", body.label],
          cards: [],
          repeats: body.repeats,
        },
        rendered: {
          root: `[data-screen-label="${body.label}"]`,
          ...(body.card ? { card: body.card } : {}),
        },
      });
    });
  });
}
