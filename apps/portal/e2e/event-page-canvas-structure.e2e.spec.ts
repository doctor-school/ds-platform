import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3829 — the Academy event page `/webinars/[slug]` is compared, as a
 * structure, with the vendored canvas `design-source/event-page.dc.html`
 * (`header` «Академия», `auth` «гость»): each compared section's controls by
 * kind + visible label, in order, in each phase the seeded slugs reach — an
 * upcoming эфир (`E2E_WEBINAR_SLUG`, phase «до начала») and an ended one with a
 * published montage (`E2E_WEBINAR_SLUG_ENDED`, phase «прошло», recording
 * «монтаж»):
 * - «d-event · постер-шапка» ↔ the hero, both phases;
 * - «d-event · блок записи» ↔ the signup card, «до начала»;
 * - «d-event · прошло · плеер записи» ↔ the player card (a guest's login
 *   gate), «прошло · монтаж».
 *
 * Live tier `live/academy/event-page` (`playwright.event-page.config.ts`),
 * beside `event-page-020.e2e.spec.ts`: a slot hands it the golden slugs
 * (`tools/staging/live-tiers.mjs` → `seededEnv`); each case skips when its
 * slug is absent, so a stray CI invocation is inert.
 *
 * Not compared (every other section the canvas labels):
 * - «d-event · блок записи» in «прошло» — the canvas turns it into a «К записи ↓»
 *   jump link the app does not build (no such control in `@ds/event-page`);
 *   a deviation for #3829, not compared until decided.
 * - «d-event · прошло · нижний CTA» («Войти ↗») — the app renders no closing
 *   CTA band on a past event (`@ds/event-page` builds none); same.
 * - «d-event · после события» (rating, «Отправить отзыв», «Зашла / Не зашла»)
 *   — the canvas draws the post-event feedback form for a guest on «прошло»;
 *   the app builds no such form; same.
 * - «d-event · открытая часть», «d-event · связи», «d-event · прошло ·
 *   таймкоды» — program, speaker cards, partner rows, school / expert links
 *   and chapter buttons are drawn from the canvas's sample event (the
 *   `speakers` / `format` props, its sample chapters), so their controls are
 *   the event's data, not the page's structure.
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

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy event page ≡ event-page canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const c of CASES) {
      for (const section of c.sections) {
        test(`${c.name}: ${section.name} has the canvas structure`, async ({
          page,
          context,
        }) => {
          test.skip(!c.slug, `requires a seeded slug for «${c.name}»`);
          await context.clearCookies();
          await page.goto(`/webinars/${c.slug}`, {
            waitUntil: "domcontentloaded",
          });
          await page.locator(section.root).waitFor();
          await expectSlotSectionMatchesCanvas(page, {
            canvas: "event-page.dc.html",
            props: {
              header: "Академия",
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
