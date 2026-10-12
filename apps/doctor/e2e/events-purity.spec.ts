import { expect, test, type Page } from "@playwright/test";

/**
 * 019 EARS-14 (#1529) — the feed is EVENTS AND ONLY EVENTS.
 *
 * Every rendered state of the one events page (upcoming, past, month, empty,
 * filtered), for a guest and for a signed-in doctor, at 1440 and 390 px, in
 * light and dark, is scanned for every doctor-facing string of the 019 surface
 * (the page's `<main>`; the shell footer is 017's) — every text node in it (a
 * closed mobile sheet included, `script`/`style` excluded),
 * every accessible-name / tooltip / placeholder attribute, the document title
 * and the meta description — plus every link target in it:
 *
 *  1. no Academy podcast episode, Academy / partner news item, project card or
 *     backstage entry — neither as copy nor as a link into those sections — and
 *     no «проект» in any string (NG-2, REQ-24);
 *  2. no rouble price, cart, subscription or payment affordance (REQ-48, NG-5);
 *  3. no statement of who finances an event, and no «партнёр» at all — the
 *     glossary canon names the organisation «инвестор (организация)» /
 *     «первоинвестор», so «партнёр» is never the money-carrier;
 *  4. НМО only as a badge (the card's `data-event-nmo` chip — the fixture's
 *     evt-3 is accredited) and a facet — never a heading, the document title or
 *     the facet panel's first (primary) field.
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
  primaryFacetFields: string[];
};

/** Every doctor-facing string, link target and НМО placement on the page. */
async function scan(page: Page): Promise<Scan> {
  return page.evaluate(() => {
    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const FACET =
      '[data-testid="events-column"], [data-testid="events-filter-sheet"], [role="region"][aria-label="Фильтры"]';
    const strings: string[] = [];
    const nmoOutside: string[] = [];

    // The 019 surface is the page's <main>: the footer is the 017 shell's one
    // sanctioned crossing to the Academy (017 EARS-12, LD-4), not this feature.
    const root = document.querySelector("main");
    if (!root) throw new Error("the events page renders no <main>");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? "";
      if (!parent || SKIP.has(parent.tagName) || text === "") continue;
      strings.push(text);
      if (
        /НМО/.test(text) &&
        !parent.closest("[data-event-nmo]") &&
        !parent.closest(FACET)
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
          !element.closest(FACET)
        ) {
          nmoOutside.push(value);
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
      ...Array.from(
        root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'),
      ).map((heading) => (heading as HTMLElement).innerText ?? ""),
    ];

    // The facet panel's FIRST field — the screen's primary filter — read from
    // every rendered panel, past its «Фильтры» header and applied-count line.
    const primaryFacetFields = Array.from(root.querySelectorAll(FACET))
      .map((panel) =>
        ((panel as HTMLElement).innerText ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .find((line) => !/^(Фильтры|Применено.*|Сбросить)$/.test(line)),
      )
      .filter((line): line is string => typeof line === "string");

    return {
      strings,
      hrefs: Array.from(root.querySelectorAll("a[href]")).map(
        (link) => link.getAttribute("href") ?? "",
      ),
      headings,
      nmoOutsideBadgeOrFacet: nmoOutside,
      nmoBadges: document.querySelectorAll("[data-event-nmo]").length,
      primaryFacetFields,
    };
  });
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

        const read = await scan(page);

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
        expect(
          read.primaryFacetFields.filter((field) => NMO.test(field)),
          `${where}: НМО as the primary filter`,
        ).toEqual([]);

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
