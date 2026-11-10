import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3889 — the doctor event page `/events/[slug]` is compared, as a structure,
 * with the vendored canvas `design-source/event-page.dc.html` (`header`
 * «витрина врача», `auth` «гость»): each compared section's controls by kind +
 * visible label, in order, in each phase the seeded slugs reach — an upcoming
 * `doctors` эфир (`E2E_WEBINAR_SLUG`, phase «до начала») and an ended one with
 * a published montage (`E2E_WEBINAR_SLUG_ENDED`, phase «прошло», recording
 * «монтаж»). The page is the one `@ds/event-page` core the Academy check
 * (`apps/portal/e2e/event-page-canvas-structure.e2e.spec.ts`, #3829) compares,
 * so the sections are the same:
 * - «d-event · постер-шапка» ↔ the hero, both phases;
 * - «d-event · блок записи» ↔ the signup card, «до начала»;
 * - «d-event · прошло · плеер записи» ↔ the player card (a guest's login
 *   gate), «прошло · монтаж».
 *
 * Live tier `live/doctor/event-page` (`playwright.event-page.config.ts`),
 * beside `event-page.spec.ts`: a slot hands it the golden slugs
 * (`tools/staging/live-tiers.mjs` → `seededEnv`); each case skips when its
 * slug is absent, so a stray CI invocation is inert.
 *
 * Not compared (every other section the canvas labels):
 * - «d-event · блок записи» in «прошло» — the canvas turns it into a «К записи ↓»
 *   jump link the app does not build (no such control in `@ds/event-page`);
 *   the fix is tracked in #3869.
 * - «d-event · прошло · нижний CTA» — the app renders no closing CTA band on a
 *   past event (`@ds/event-page` builds none); the fix is tracked in #3868.
 * - «d-event · прошло · таймкоды» — the app builds no chapter list on a past
 *   event; the fix is tracked in #3867.
 * - «d-event · после события» (rating, «Отправить отзыв», «Зашла / Не зашла»)
 *   — the canvas draws the post-event feedback form for a guest on «прошло»;
 *   the app builds no such form, a deliberate wave-2 deferral (#1784,
 *   020 EARS-16).
 * - «d-event · открытая часть», «d-event · связи» — program, speaker cards,
 *   partner rows and school / expert links are drawn from the canvas's sample
 *   event (the `speakers` / `format` props), so their controls are the event's
 *   data, not the page's structure.
 * - «d-event · блок формата · эфир», «d-event · прошло · материалы» — drawn
 *   with no control for a guest (the reader has nothing to compare).
 * - «d-event · билет / QR», «· блок формата · офлайн», «· гибрид · выбор
 *   участия», «· в архиве», «· загрузка», «· ошибка», «· прошло · запись
 *   готовится», «· прошло · оригинал трансляции» — absent from the canvas in
 *   both seeded phases (another format, phase, recording kind or page state;
 *   no golden slug reaches it as a guest).
 * - the stand boards «d-event · стенд · …» — design notes, not screens.
 *
 * The canvas is rendered by the real Claude Design runtime, offline
 * (`@ds/e2e/canvas-runtime`, #3798).
 */
const POSTER = {
  name: "the poster",
  label: "d-event · постер-шапка",
  root: '[data-testid="event-page-hero"]',
};
const SIGNUP = {
  name: "the signup block",
  label: "d-event · блок записи",
  root: '[data-testid="event-signup-card"]',
};
const PLAYER = {
  name: "the recording player",
  label: "d-event · прошло · плеер записи",
  root: '[data-testid="player-card"]',
};

const CASES = [
  {
    name: "до начала",
    slug: process.env.E2E_WEBINAR_SLUG,
    props: { phase: "до начала" },
    sections: [POSTER, SIGNUP],
  },
  {
    name: "прошло · монтаж",
    slug: process.env.E2E_WEBINAR_SLUG_ENDED,
    props: { phase: "прошло", recording: "монтаж" },
    sections: [POSTER, PLAYER],
  },
] as const;

test.skip(!process.env.E2E_DOCTOR_URL, "requires a live doctor storefront");

for (const width of [390, 1440]) {
  test.describe(`#3889 doctor event page ≡ event-page canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const c of CASES) {
      for (const section of c.sections) {
        test(`${c.name}: ${section.name} has the canvas structure`, async ({
          page,
          context,
        }) => {
          test.skip(!c.slug, `requires a seeded slug for «${c.name}»`);
          await context.clearCookies();
          await page.goto(`/events/${c.slug}`, {
            waitUntil: "domcontentloaded",
          });
          await page.locator(section.root).waitFor();
          await expectSlotSectionMatchesCanvas(page, {
            canvas: "event-page.dc.html",
            props: {
              header: "витрина врача",
              auth: "гость",
              format: "эфир",
              pageState: "обычно",
              ...c.props,
            },
            section: { section: ["data-screen-label", section.label] },
            rendered: { root: section.root },
          });
        });
      }
    }
  });
}
