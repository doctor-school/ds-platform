import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * 020 EARS-20 (#1777) — the Academy's mount of the ONE shared event page at BOTH
 * breakpoints, in BOTH themes, under the portal app-shell header, with the
 * accessibility bar the clause names.
 *
 * This is the SECOND host of the same clause; the doctor storefront's half is
 * `apps/doctor/e2e/event-page-parity.spec.ts`. EARS-20 is a PARITY clause, so a
 * matrix on one host proves nothing about the other: the page composition is
 * shared (`EventPageShell` / `EventSignupCard`), but the header, the route
 * envelope and the theme chrome around it are each host's own, and a reflow
 * defect can therefore live on exactly one of them.
 *
 * Each row asserts the same six things its doctor-host twin does — the intended
 * theme is the one actually painted; the document does not scroll sideways and
 * nothing reaches past the viewport's right edge; the header landmark is on
 * screen and inside the viewport; the page has exactly one non-empty `h1` and
 * the lifecycle signal reaches the accessibility tree as TEXT; the participation
 * control the SERVER resolved is the one the card carries, named without leaning
 * on the decorative arrow, keyboard-reachable and hit-testable; and axe reports
 * zero WCAG 2 A/AA violations.
 *
 * LIVE-STAND-GATED tier, exactly like `event-page-020.e2e.spec.ts`: it drives a
 * running portal whose `/v1/*` rewrite reaches a running api + Postgres with
 * seeded events. It cannot ride an upstream double the way the doctor half does,
 * because the Academy host has no double tier — its event page has only ever
 * been driven against the dev stand. Every arm skips individually when the
 * fixture it needs is absent, so a partial stand runs the part it can serve
 * rather than failing or, worse, passing vacuously.
 *
 * ENV SET (all optional except the first two; each row states what it needs):
 *   E2E_PORTAL_URL              — the running portal origin (required)
 *   E2E_WEBINAR_SLUG            — a `published` (upcoming) event (required)
 *   E2E_WEBINAR_SLUG_LIVE       — an event whose state is `live`
 *   E2E_WEBINAR_SLUG_ENDED      — an event whose state is `ended`
 *   E2E_WEBINAR_SLUG_REGISTERED — an upcoming event the doctor below is
 *                                 ALREADY registered for (the 020 EARS-6 card)
 *   E2E_DOCTOR_EMAIL / E2E_DOCTOR_PASSWORD — a provisioned doctor account; the
 *                                 signed-in arms skip loudly without them
 *   E2E_SHOT_DIR                — when set, each row writes
 *                                 `host-academy-<phase>-<auth>-<viewport>-<theme>.png`
 *                                 there. Evidence for the PR, never repository
 *                                 content.
 *
 * NOT in the matrix, each swept by the Issue that ships the block: the
 * hybrid-format TABS (EARS-8, #1771), `soldOut` (#1772), the med-gate (#1774),
 * the loading and error page states (#1776), the cancelled/moved phase (#1773)
 * and the social-proof count (#1767) — none is renderable on main today. The
 * `ended` × registered pair has no product state either: 005's
 * `REGISTRABLE_EVENT_STATES` is `published`/`live`, so registration is withheld
 * once an эфир has ended.
 *
 * TEST-ONLY slice. If a row fails against the unchanged surface the finding is
 * annotated and reported, never patched away and never weakened here.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG_UPCOMING = process.env.E2E_WEBINAR_SLUG;
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE;
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;
const SLUG_REGISTERED = process.env.E2E_WEBINAR_SLUG_REGISTERED;
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
const SHOT_DIR = process.env.E2E_SHOT_DIR;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG_UPCOMING,
  "requires a live portal (E2E_PORTAL_URL) and a seeded upcoming event slug (E2E_WEBINAR_SLUG)",
);

/** The `layout` breakpoint of the shared shell — below it the grid is one column. */
const LAYOUT_BREAKPOINT = 901;

/** The portal's theme is class-based and persisted under the same key the doctor host uses. */
const THEME_KEY = "ds-theme";

/**
 * The FOUC guard reads `ds-theme` before paint (`apps/portal/lib/theme.ts`), so
 * the only way to ask for a theme is to have the key present before the first
 * navigation. Playwright's `colorScheme` option is a no-op for this app.
 */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ([key, value]: [string, string]) => {
      window.localStorage.setItem(key, value);
    },
    [THEME_KEY, theme] as [string, string],
  );
}

/**
 * Sign the doctor in through the portal's own BFF, the way the app does: a
 * `POST /v1/auth/login` issued FROM the portal origin, so the `__Host-ds_session`
 * the api sets lands on the origin the page will be read from.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const outcome = await page.evaluate<
    { status: number; body: string },
    [string, string]
  >(async ([id, pw]) => {
    const response = await fetch("/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: id, password: pw }),
    });
    return { status: response.status, body: await response.text() };
  }, [DOCTOR_EMAIL!, DOCTOR_PASSWORD!]);

  expect(
    outcome.status,
    `POST /v1/auth/login through the portal BFF should authenticate — got ${outcome.status}: ${outcome.body}`,
  ).toBe(200);
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const measured = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
  expect(
    measured.scrollWidth,
    `document scrollWidth (${measured.scrollWidth}) exceeds the viewport (${measured.innerWidth})`,
  ).toBeLessThanOrEqual(measured.innerWidth);

  const box = await page.getByTestId("event-page-shell").boundingBox();
  expect(box, "event-page-shell has a box").not.toBeNull();
  expect(
    Math.round(box!.x + box!.width),
    "event-page-shell reaches past the viewport's right edge",
  ).toBeLessThanOrEqual(width);
}

/**
 * Reach `target` with the TAB key from the top of the document — the property a
 * keyboard user has, which `element.focus()` cannot demonstrate (and which alone
 * puts Chromium into `:focus-visible`, the state the ring is drawn in).
 */
async function tabTo(page: Page, target: Locator, label: string) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (let step = 0; step < 200; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`${label} was never reached by the TAB key within 200 steps`);
}

async function expectOperable(page: Page, control: Locator, label: string) {
  await expect(control, `${label} is visible`).toBeVisible();
  // The DOM text, not the CSS-transformed glyphs: the accessible name a
  // screen reader announces comes from `textContent`.
  const name = ((await control.textContent()) ?? "")
    .replace(/\s+/g, " ")
    .replace(/↗/g, "")
    .trim();
  expect(
    name,
    `${label} has a non-empty accessible name that does not lean on the decorative arrow`,
  ).not.toBe("");
  await tabTo(page, control, label);
  const ring = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  });
  expect(
    ring.outlineStyle !== "none" || ring.boxShadow !== "none",
    `${label} draws no focus indicator when reached by keyboard (${JSON.stringify(ring)})`,
  ).toBe(true);

  const box = await control.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  const onTop = await control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return !!hit && (hit === node || node.contains(hit));
  });
  expect(onTop, `something is covering ${label}`).toBe(true);
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target).flat(),
  }));
  expect(
    summary,
    `axe violations on the academy event page (${label})`,
  ).toEqual([]);
}

type ControlKind = "control" | "none";

interface CaseSpec {
  readonly phase: "upcoming" | "live" | "ended";
  readonly auth: "guest" | "signed-in";
  readonly registered: boolean;
  /** The slug this row needs; the row skips when the stand did not name one. */
  readonly slug: string | undefined;
  /** The env var that names it, quoted in the skip reason. */
  readonly slugVar: string;
  /** The word the hero status plate must carry, in TEXT. */
  readonly statusWord: string;
  readonly control: ControlKind;
  /** The copy the card states when it carries no control. */
  readonly statement: string | null;
}

const CASES: readonly CaseSpec[] = [
  {
    phase: "upcoming",
    auth: "guest",
    registered: false,
    slug: SLUG_UPCOMING,
    slugVar: "E2E_WEBINAR_SLUG",
    statusWord: "Скоро",
    control: "control",
    statement: null,
  },
  {
    phase: "upcoming",
    auth: "signed-in",
    registered: false,
    slug: SLUG_UPCOMING,
    slugVar: "E2E_WEBINAR_SLUG",
    statusWord: "Скоро",
    control: "control",
    statement: null,
  },
  {
    phase: "upcoming",
    auth: "signed-in",
    registered: true,
    slug: SLUG_REGISTERED,
    slugVar: "E2E_WEBINAR_SLUG_REGISTERED",
    statusWord: "Скоро",
    // 020 EARS-6: the registered card states the fact and carries NO control.
    control: "none",
    statement: "Вы записаны",
  },
  {
    phase: "live",
    auth: "guest",
    registered: false,
    slug: SLUG_LIVE,
    slugVar: "E2E_WEBINAR_SLUG_LIVE",
    statusWord: "В эфире",
    control: "control",
    statement: null,
  },
  {
    phase: "live",
    auth: "signed-in",
    registered: false,
    slug: SLUG_LIVE,
    slugVar: "E2E_WEBINAR_SLUG_LIVE",
    statusWord: "В эфире",
    control: "control",
    statement: null,
  },
  {
    phase: "ended",
    auth: "guest",
    registered: false,
    slug: SLUG_ENDED,
    slugVar: "E2E_WEBINAR_SLUG_ENDED",
    statusWord: "Эфир завершён",
    // 020 EARS-4: participation is withheld — the card dead-ends in words.
    control: "none",
    statement: null,
  },
];

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * The parity matrix: 24 rows, one `test()` each. Numbering is flat across the
 * clause (ADR-0006 §4) and deterministic in the loop order below, so a row keeps
 * its number as long as the matrix keeps its shape.
 */
let caseNumber = 0;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`020 EARS-20: academy at ${viewport.label} × ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const spec of CASES) {
        caseNumber += 1;
        const arm = spec.registered ? `${spec.auth}-registered` : spec.auth;
        const label = `${viewport.label} / ${theme} / ${spec.phase} / ${arm}`;

        test(`020 EARS-20.${caseNumber}: ${label} — the painted theme, no horizontal overflow, the header, the server-resolved control and no axe violation`, async ({
          page,
          context,
        }) => {
          test.skip(
            !spec.slug,
            `this row needs ${spec.slugVar} — a ${spec.phase} event on the stand`,
          );
          test.skip(
            spec.auth === "signed-in" && !(DOCTOR_EMAIL && DOCTOR_PASSWORD),
            "the signed-in arms need E2E_DOCTOR_EMAIL / E2E_DOCTOR_PASSWORD",
          );

          await context.clearCookies();
          await useTheme(page, theme);
          if (spec.auth === "signed-in") await signIn(page);

          const response = await page.goto(`${BASE}/webinars/${spec.slug}`, {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status(), "the event page is a 200").toBe(200);

          // (a) the theme actually painted is the one asked for.
          const html = page.locator("html");
          if (theme === "dark") {
            await expect(html, "html carries the dark class").toHaveClass(
              /(^|\s)dark(\s|$)/,
            );
          } else {
            await expect(html, "html has no dark class").not.toHaveClass(
              /(^|\s)dark(\s|$)/,
            );
          }

          // (b) nothing is pushed off the side at either width.
          await expectNoHorizontalOverflow(page, viewport.width);

          // (c) the portal app-shell header, and the shared page under it.
          const header = page.getByRole("banner");
          await expect(header, "the app-shell header landmark").toHaveCount(1);
          await expect(header, "the app-shell header is visible").toBeVisible();
          const headerBox = await header.boundingBox();
          expect(headerBox, "the header has a box").not.toBeNull();
          expect(
            Math.round(headerBox!.x + headerBox!.width),
            "the header reaches past the viewport's right edge",
          ).toBeLessThanOrEqual(viewport.width);

          await expect(page.getByTestId("event-page-shell")).toBeVisible();
          await expect(page.getByTestId("event-page-main")).toBeVisible();

          const h1 = page.getByRole("heading", { level: 1 });
          await expect(h1, "the page has exactly one h1").toHaveCount(1);
          expect((await h1.innerText()).trim(), "the h1 is not empty").not.toBe(
            "",
          );

          // The lifecycle signal is TEXT in the accessibility tree, never colour
          // alone — the load-bearing case being «В эфире».
          const status = page.getByTestId("event-page-hero-status");
          await expect(status, "the hero carries a status plate").toBeVisible();
          expect(
            // `textContent`, not `innerText`: the plate is rendered through the
            // DS `uppercase` utility and `innerText` returns the transformed
            // glyphs («СКОРО»); a screen reader announces the DOM text.
            ((await status.textContent()) ?? "").replace(/\s+/g, " ").trim(),
            `the status plate states "${spec.statusWord}" in words`,
          ).toContain(spec.statusWord);

          // (d) the participation control the SERVER resolved — and only it.
          const linkCta = page.getByTestId("event-signup-cta");
          const oneTap = page.getByTestId("event-register-one-tap");
          const statement = page.getByTestId("event-signup-statement");
          const controls = await linkCta.count();
          const commands = await oneTap.count();

          if (spec.control === "none") {
            expect(
              controls + commands,
              "a withheld participation still renders a control",
            ).toBe(0);
            await expect(statement, "the card states the fact").toBeVisible();
            if (spec.statement) {
              expect(
                ((await statement.textContent()) ?? "").replace(/\s+/g, " ").trim(),
                "the statement carries the server's own copy",
              ).toContain(spec.statement);
            }
          } else {
            // The single-CTA invariant: exactly ONE participation control,
            // whichever kind this host's policy resolved for this viewer.
            expect(controls + commands, "exactly one participation control").toBe(
              1,
            );
            await expectOperable(
              page,
              commands === 1 ? oneTap : linkCta,
              "the participation control",
            );
          }

          // The two-column shell's reflow: below the `layout` breakpoint the
          // grid is ONE column with the sign-up card FIRST (the canvas's
          // `order-first`); at 1440 it is the pinned right-hand column.
          const asideBox = (await page
            .getByTestId("event-page-aside")
            .boundingBox())!;
          const openBox = (await page
            .getByTestId("event-page-open-part")
            .boundingBox())!;
          const position = await page
            .getByTestId("event-signup-card")
            .evaluate((node) => getComputedStyle(node).position);

          if (viewport.width < LAYOUT_BREAKPOINT) {
            expect(
              Math.round(asideBox.y + asideBox.height),
              "at 390 the sign-up card and the open part are not one column",
            ).toBeLessThanOrEqual(Math.round(openBox.y) + 1);
            expect(position, "the card is still pinned at 390").not.toBe(
              "sticky",
            );
            expect(
              Math.round(asideBox.x + asideBox.width),
              "the sign-up card reaches past the viewport's right edge",
            ).toBeLessThanOrEqual(viewport.width);
          } else {
            expect(
              Math.round(asideBox.x),
              "at 1440 the sign-up card is not beside the reading flow",
            ).toBeGreaterThanOrEqual(Math.round(openBox.x + openBox.width));
            expect(position, "the card is not pinned at 1440").toBe("sticky");
          }

          if (SHOT_DIR) {
            await page.screenshot({
              path: path.join(
                SHOT_DIR,
                `host-academy-${spec.phase}-${arm}-${viewport.label}-${theme}.png`,
              ),
              fullPage: true,
            });
          }

          // (f) the WCAG 2 A/AA bar, in THIS theme at THIS width.
          await expectAxeClean(page, label);
        });
      }
    });
  }
}
