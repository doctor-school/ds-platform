import { expect, test, type Page } from "@playwright/test";

/**
 * 019 EARS-14 (#1529) — the feed is EVENTS AND ONLY EVENTS.
 *
 * Every rendered state of the one events page (upcoming, past, month, empty,
 * filtered), for a guest and for a signed-in doctor, at 1440 and 390 px, in
 * light and dark, is scanned for every doctor-facing string of the 019
 * surface — the page's `<main>` (the shell footer is 017's) and, at 390 px,
 * the facet sheet opened from «Фильтры» (a closed Radix sheet is unmounted; an
 * open one is portalled to `<body>`, outside `<main>`): every text node in
 * them (`script`/`style` excluded, the CSS-hidden ≥1024 px column included),
 * every accessible-name / tooltip / placeholder attribute, the document title
 * and the meta description — plus every link target in them:
 *
 *  1. no Academy podcast episode, Academy / partner news item, project card or
 *     backstage entry — neither as copy nor as a link into those sections — and
 *     no «проект» in any string (NG-2, REQ-24);
 *  2. no rouble price, cart, subscription or payment affordance (REQ-48, NG-5);
 *  3. no statement of who finances an event, and no «партнёр» at all — the
 *     glossary canon names the organisation «инвестор (организация)» /
 *     «первоинвестор», so «партнёр» is never the money-carrier;
 *  4. НМО only as a badge (the card's `data-event-nmo` chip — the fixture's
 *     evt-3 is accredited) and a facet (the `EventsFilter` panel) — never a
 *     heading, the document title or the panel's first (primary) field — read
 *     from the visible panel: the column at 1440, the opened sheet at 390.
 *     The «Только с НМО» switch itself cannot render on today's contract:
 *     `DoctorEventFacetOptionsSchema` is strict (`city`, `kind`) and the
 *     storefront adapter parses the read with it, so an upstream `nmo` option
 *     block fails the whole feed read (007 carries no НМО flag yet). The first
 *     field is read from the real field list either way, so the rule holds the
 *     day the contract names НМО.
 *
 * A podcast BROADCAST event is an event of this feed, so «подкаст» alone is
 * not noise; the Academy entity is the EPISODE, which is what the scan names.
 *
 * Upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs` (the
 * September 2026 fixtures); a signed-in reader rides the `__Host-ds_session`
 * cookie as a request HEADER, as in `events-guest.spec.ts`.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;

const FORBIDDEN: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  // 1. Academy noise and the project entity.
  { rule: "«проект»", pattern: /проект/i },
  { rule: "news item", pattern: /новост/i },
  { rule: "podcast episode", pattern: /эпизод|выпуск подкаста/i },
  { rule: "backstage entry", pattern: /бэкстейдж|backstage|закулис/i },
  // 2. Commerce.
  {
    rule: "rouble price",
    pattern: /₽|руб(\.|л|ей|ля)|(^|[^a-z])rub([^a-z]|$)/i,
  },
  { rule: "cart", pattern: /корзин/i },
  { rule: "subscription", pattern: /подписк/i },
  {
    rule: "payment affordance",
    pattern: /оплат|купить|к оплате|цена|стоимост/i,
  },
  // 3. Payer statement and the money-carrier «партнёр».
  {
    rule: "payer statement",
    pattern: /спонсор|финансир|при поддержке|за сч[её]т/i,
  },
  { rule: "«партнёр»", pattern: /партн[её]р/i },
];

/** Link targets into the Academy media / project sections. */
const NOISE_HREF =
  /(^|\/)(news|novosti|podcasts?|episodes?|projects?|backstage)(\/|$|\?)/i;

const NMO = /НМО/;

const STATES = [
  { name: "upcoming", path: "/events", ready: "events-feed" },
  { name: "past", path: "/events?tense=past", ready: "events-feed" },
  {
    name: "month",
    path: "/events?view=month&month=2026-09",
    ready: "events-month-view",
  },
  // A specific specialty no fixture event targets reads empty.
  {
    name: "empty",
    path: "/events?specialty=nevrologiya",
    ready: "events-feed-view",
  },
  {
    name: "filtered",
    path: "/events?format=online&kind=vebinar&nmo=true",
    ready: "events-feed",
  },
] as const;

const VIEWERS = [
  { name: "guest", session: null, live: "unregistered" },
  { name: "signed-in", session: "e2e-doctor", live: "registered" },
] as const;

const PRESENTATIONS = [
  { name: "1440 light", size: { width: 1440, height: 900 }, theme: "light" },
  { name: "1440 dark", size: { width: 1440, height: 900 }, theme: "dark" },
  { name: "390 light", size: { width: 390, height: 844 }, theme: "light" },
  { name: "390 dark", size: { width: 390, height: 844 }, theme: "dark" },
] as const;

const SKELETONS = [
  "events-feed-skeleton",
  "events-live-skeleton",
  "events-month-skeleton",
  "events-my-events-skeleton",
];

type Scan = {
  strings: string[];
  hrefs: string[];
  headings: string[];
  nmoOutsideBadgeOrFacet: string[];
  nmoBadges: number;
  /** The visible facet panel's fields, in order — each field's whole text. */
  panelFields: string[];
};

/** The `EventsFilter` panel: `<section aria-label="Фильтры">` (events-filter.tsx). */
const PANEL = 'section[aria-label="Фильтры"]';
/** The facet sheet below 1024 px — mounted only while open, portalled to `<body>`. */
const SHEET = '[data-testid="events-filter-sheet"]';
const COLUMN = '[data-testid="events-column"]';

/**
 * Every doctor-facing string, link target and НМО placement of the 019
 * surface; `panelRoot` names where the VISIBLE facet panel mounts.
 */
async function scan(page: Page, panelRoot: string): Promise<Scan> {
  return page.evaluate(
    ({ PANEL, SHEET, panelRoot }) => {
      const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
      const strings: string[] = [];
      const nmoOutside: string[] = [];

      // The 019 surface is the page's <main>: the footer is the 017 shell's one
      // sanctioned crossing to the Academy (017 EARS-12, LD-4), not this
      // feature. An open facet sheet is portalled outside it and is part of it.
      const main = document.querySelector("main");
      if (!main) throw new Error("the events page renders no <main>");
      const sheet = document.querySelector(SHEET);
      const roots = sheet ? [main, sheet] : [main];

      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          const text = node.textContent?.trim() ?? "";
          if (!parent || SKIP.has(parent.tagName) || text === "") continue;
          strings.push(text);
          if (
            /НМО/.test(text) &&
            !parent.closest("[data-event-nmo]") &&
            !parent.closest(PANEL)
          ) {
            nmoOutside.push(text);
          }
        }
        for (const element of Array.from(root.querySelectorAll("*"))) {
          for (const name of [
            "aria-label",
            "aria-description",
            "aria-roledescription",
            "title",
            "alt",
            "placeholder",
          ]) {
            const value = element.getAttribute(name)?.trim();
            if (!value) continue;
            strings.push(value);
            if (
              /НМО/.test(value) &&
              !element.closest("[data-event-nmo]") &&
              !element.closest(PANEL)
            ) {
              nmoOutside.push(value);
            }
          }
        }
      }
      strings.push(document.title);
      const description = document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content");
      if (description) strings.push(description);

      const headings = [
        document.title,
        ...roots.flatMap((root) =>
          Array.from(
            root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'),
          ).map((heading) => (heading.textContent ?? "").trim()),
        ),
      ];

      // The visible panel's fields in order. The doctor `EventsFilter` is its
      // optional «Фильтры» header, then ONE container whose children are the
      // fields (query, specialty, format, kind, city, direction, «Только с
      // НМО»); its first child is the screen's primary filter.
      const panel = document.querySelector(`${panelRoot} ${PANEL}`);
      if (!panel) throw new Error(`no facet panel under ${panelRoot}`);
      const fields = panel.lastElementChild;
      const panelFields = fields
        ? Array.from(fields.children)
            .map((field) => (field.textContent ?? "").trim())
            .filter(Boolean)
        : [];

      return {
        strings,
        hrefs: roots.flatMap((root) =>
          Array.from(root.querySelectorAll("a[href]")).map(
            (link) => link.getAttribute("href") ?? "",
          ),
        ),
        headings,
        nmoOutsideBadgeOrFacet: nmoOutside,
        nmoBadges: document.querySelectorAll("[data-event-nmo]").length,
        panelFields,
      };
    },
    { PANEL, SHEET, panelRoot },
  );
}

test.afterEach(async ({ request }) => {
  await request.post(`${API}/__e2e/live`, { data: { scenario: "none" } });
});

for (const state of STATES) {
  for (const viewer of VIEWERS) {
    test(`019 EARS-14: the ${state.name} feed for a ${viewer.name} reader carries events only — no Academy noise, no commerce, no payer, НМО only as badge and facet`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000);
      await request.post(`${API}/__e2e/live`, {
        data: { scenario: viewer.live },
      });
      await context.clearCookies();
      if (viewer.session) {
        await page.setExtraHTTPHeaders({
          cookie: `__Host-ds_session=${viewer.session}`,
        });
      }

      for (const shot of PRESENTATIONS) {
        const where = `${state.name} · ${viewer.name} · ${shot.name}`;
        await page.setViewportSize(shot.size);
        await page.emulateMedia({ colorScheme: shot.theme });
        await page.goto(state.path, { waitUntil: "domcontentloaded" });
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, shot.theme);
        await expect(
          page.getByTestId(state.ready).first(),
          where,
        ).toBeVisible();
        for (const skeleton of SKELETONS) {
          await expect(page.getByTestId(skeleton), where).toHaveCount(0);
        }

        // Below 1024 px the column is display:none and the panel lives in the
        // sheet: open it, so the panel read is the one the doctor sees.
        const narrow = shot.size.width < 1024;
        if (narrow) {
          await page.getByTestId("events-filter-open").click();
          await expect(page.locator(SHEET), where).toBeVisible();
        }
        // The panel streams in behind its own Suspense slot.
        await expect(
          page.locator(`${narrow ? SHEET : COLUMN} ${PANEL}`),
          where,
        ).toBeVisible();
        const read = await scan(page, narrow ? SHEET : COLUMN);

        const hits = read.strings.flatMap((text) =>
          FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(
            ({ rule }) => `${rule}: «${text}»`,
          ),
        );
        expect(hits, `${where}: forbidden doctor-facing strings`).toEqual([]);

        expect(
          read.hrefs.filter((href) => NOISE_HREF.test(href)),
          `${where}: links into Academy media / project sections`,
        ).toEqual([]);

        expect(
          read.headings.filter((heading) => NMO.test(heading)),
          `${where}: НМО as a heading or the title`,
        ).toEqual([]);
        expect(
          read.nmoOutsideBadgeOrFacet,
          `${where}: НМО outside a badge or a facet`,
        ).toEqual([]);
        // The visible panel's FIRST field — the primary filter — is never НМО.
        // Not vacuous: the read lands on the real field list (specialty,
        // format, kind at least), so a НМО field placed first reads red.
        expect(
          read.panelFields.length,
          `${where}: the panel's fields`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          read.panelFields[0],
          `${where}: НМО as the primary filter`,
        ).not.toMatch(NMO);

        // The scan is not vacuous: the feed states render their cards, and the
        // accredited evt-3 shows НМО as its badge wherever it is served.
        if (state.name === "upcoming" || state.name === "filtered") {
          expect(read.nmoBadges, `${where}: evt-3's НМО badge`).toBe(1);
        }
        if (state.name === "empty") {
          await expect(page.locator("[data-webinar-card]"), where).toHaveCount(
            0,
          );
        } else if (state.name !== "month") {
          expect(
            await page.locator("[data-webinar-card]").count(),
            `${where}: cards rendered`,
          ).toBeGreaterThan(0);
        }
      }
    });
  }
}
