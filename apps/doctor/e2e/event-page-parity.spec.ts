import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * 020 EARS-20 (#1777) — the event page at BOTH breakpoints, in BOTH themes,
 * under this host's storefront header, with the accessibility bar the clause
 * names (020-requirements-en, EARS-20 + invariants).
 *
 * What this file proves, and why none of it is proven anywhere else on main:
 *
 *   1. PARITY of the ONE shared page, not a mobile smoke test. Every «Витрина
 *      R1» state of `doctor.school/events/:slug` is driven at 1440x900 AND at
 *      390x844, in the light theme AND in the dark one: the three lifecycle
 *      phases the storefront ships (upcoming, live, ended) crossed with the
 *      guest and signed-in arms and, for the signed-in doctor, with and without
 *      an existing registration. Each row asserts what only a real browser can
 *      see — the intended theme is the one actually painted, the document does
 *      not scroll sideways and nothing reaches past the viewport's right edge,
 *      the header landmark is on screen, the page has exactly one non-empty
 *      `h1`, and the participation control the SERVER resolved is the one the
 *      card carries, visible and operable from the keyboard.
 *   2. The DARK theme against axe on this route. Nothing on main scans the
 *      event page in dark, and the hero is a theme-INVARIANT navy band whose
 *      links and chips are exactly the surface a theme swap breaks.
 *   3. The MOBILE reflow of the two-column shell. At 390 the sign-up card and
 *      the open part are one column — the canvas puts the card FIRST
 *      (`event-page-shell.tsx`, the aside's `order-first`) — the card is no
 *      longer pinned, and the participation control is hit-testable rather than
 *      merely painted under something else.
 *   4. The LIVE signal is carried in WORDS. «В эфире» reaches the accessibility
 *      tree as the text of `event-page-hero-status`, and the room entry's
 *      accessible name does not depend on the decorative arrow
 *      (`event-signup-card.tsx` marks it `aria-hidden`) — colour alone is never
 *      the signal.
 *
 * NOT in the matrix, each swept by the Issue that ships the block (the owner
 * scoped this sweep to what «Витрина R1» actually renders — a parity case for a
 * slot that does not exist would pin a surface that has not been built):
 *   • the F-020-2 Б hybrid-format TABS — EARS-8, #1771 (`event-format-block.tsx`
 *     states the tabs are that clause's deliverable; nothing to drive here);
 *   • `soldOut` — #1772; the med-gate — #1774; the loading and error page
 *     states — #1776; the cancelled/moved phase — #1773; the social-proof count
 *     — #1767. None of them is renderable on main today.
 *   • `ended` × REGISTERED — the upstream withholds registration for `ended`
 *     (005 `REGISTRABLE_EVENT_STATES` = published/live), so there is no fixture
 *     and no product state to drive; both ended rows are the withheld one.
 *
 * Why this file rides the RETURN-CONTEXT tier
 * (`playwright.return-context.config.ts`, the `return-context-api.mjs` double)
 * rather than the backend-free one: the lifecycle state, the participation
 * policy AND the caller's registration are all resolved on the SERVER before
 * the first byte of HTML (`app/(storefront)/events/[slug]/page.tsx` issues three
 * parallel reads), so no browser-level interception can reach them. The double
 * answers them as the upstream does — a test DOUBLE of the api, never a stub in
 * product code.
 *
 * ENV SET: none. The tier boots its own app and its own upstream double.
 * Optional: `E2E_SHOT_DIR` — when set, each row writes
 * `host-doctor-<phase>-<auth>-<viewport>-<theme>.png` there. The shots are
 * evidence for the PR, never repository content.
 *
 * TEST-ONLY slice. If a row fails against the unchanged surface the finding is
 * annotated and reported, never patched away and never weakened here.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The slugs `e2e/support/return-context-api.mjs` answers for. */
const UPCOMING_SLUG = "prp-pri-gonartroze";
const REGISTERED_SLUG = "registered-revmatologiya-obzor";
const LIVE_SLUG = "live-nevrologiya-praktikum";
const ENDED_SLUG = "ended-vedenie-hronicheskoy-boli";

/**
 * The live session value the double accepts (`SESSION_VALUE` there). Carried by
 * literal agreement rather than an import, exactly as `login-arrival.spec.ts`
 * carries it: an import would pull the whole double into the Playwright type
 * graph.
 */
const SESSION_VALUE = "e2e-signed-in-doctor";

/** The `layout` breakpoint of the shared shell — below it the grid is one column. */
const LAYOUT_BREAKPOINT = 901;

const SHOT_DIR = process.env.E2E_SHOT_DIR;

/**
 * Put the double's live session on the doctor origin. `__Host-` requires
 * `secure` + path `/` + no domain; Chromium accepts a secure cookie on
 * `localhost`, which is why this tier's base URL is `localhost` and not an IP
 * (`login-arrival.spec.ts` establishes the session the same way).
 */
async function signIn(context: BrowserContext, baseURL: string): Promise<void> {
  const origin = new URL(baseURL);
  await context.addCookies([
    {
      name: "__Host-ds_session",
      value: SESSION_VALUE,
      domain: origin.hostname,
      path: "/",
      secure: true,
      httpOnly: true,
    },
  ]);
}

/**
 * The app's theme is class-based and persisted (`apps/doctor/lib/theme.ts`): the
 * FOUC guard reads `localStorage["ds-theme"]` before paint, so the ONLY way to
 * ask for a theme is to have that key present before the first navigation.
 * Playwright's `colorScheme` option is a no-op for this app.
 */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
}

/**
 * No horizontal overflow: the document itself does not scroll sideways, and the
 * page shell's own box does not reach past the viewport's right edge. Both,
 * because a child that overflows a clipping ancestor leaves the document width
 * intact while still being unreachable.
 */
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

/**
 * The control is operable, not merely painted: visible, named, reachable by the
 * keyboard, and — once the keyboard put it in `:focus-visible` — wearing an
 * indicator the eye can find. The DS primitives draw the ring with `box-shadow`;
 * a bare `outline` satisfies the same contract, so either counts.
 */
async function expectOperable(page: Page, control: Locator, label: string) {
  await expect(control, `${label} is visible`).toBeVisible();
  const name = (await control.innerText()).replace(/\s+/g, " ").trim();
  expect(name, `${label} has a non-empty accessible name`).not.toBe("");
  await tabTo(page, control, label);
  const ring = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  });
  expect(
    ring.outlineStyle !== "none" || ring.boxShadow !== "none",
    `${label} draws no focus indicator when reached by keyboard (${JSON.stringify(ring)})`,
  ).toBe(true);
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
    `axe violations on the doctor event page (${label})`,
  ).toEqual([]);
}

type ControlKind = "link" | "one-tap" | "none";

interface CaseSpec {
  /** The lifecycle phase, as the page's own state list names it. */
  readonly phase: "upcoming" | "live" | "ended";
  readonly auth: "guest" | "signed-in";
  /** Whether this tier's doctor already holds a registration for the slug. */
  readonly registered: boolean;
  readonly slug: string;
  /** The word the hero status plate must carry, in TEXT. */
  readonly statusWord: string;
  /** Which participation control the server-resolved policy renders, if any. */
  readonly control: ControlKind;
  /** The copy the card states when it carries no control. */
  readonly statement: string | null;
  /** The accessible name the control must carry, the decorative arrow excluded. */
  readonly controlName: string | null;
}

const CASES: readonly CaseSpec[] = [
  {
    phase: "upcoming",
    auth: "guest",
    registered: false,
    slug: UPCOMING_SLUG,
    statusWord: "Скоро",
    control: "link",
    statement: null,
    controlName: "Участвовать",
  },
  {
    phase: "upcoming",
    auth: "signed-in",
    registered: false,
    slug: UPCOMING_SLUG,
    statusWord: "Скоро",
    // 005 EARS-1: a signed-in doctor gets the in-place one-tap command instead
    // of the `/register` hand-off — the SAME server policy, a host rendering.
    control: "one-tap",
    statement: null,
    controlName: "Участвовать",
  },
  {
    phase: "upcoming",
    auth: "signed-in",
    registered: true,
    slug: REGISTERED_SLUG,
    statusWord: "Скоро",
    // 020 EARS-6: the registered card states the fact and carries NO control.
    control: "none",
    statement: "Вы записаны",
    controlName: null,
  },
  {
    phase: "live",
    auth: "guest",
    registered: false,
    slug: LIVE_SLUG,
    statusWord: "В эфире",
    control: "link",
    statement: null,
    controlName: "Участвовать",
  },
  {
    phase: "live",
    auth: "signed-in",
    registered: true,
    slug: LIVE_SLUG,
    statusWord: "В эфире",
    // 020 EARS-7: room entry, with the target the api resolved against THIS
    // host's route table.
    control: "link",
    statement: null,
    controlName: "Войти в эфир",
  },
  {
    phase: "ended",
    auth: "guest",
    registered: false,
    slug: ENDED_SLUG,
    statusWord: "Эфир завершён",
    control: "none",
    statement: "Регистрация закрыта",
    controlName: null,
  },
  {
    phase: "ended",
    auth: "signed-in",
    registered: false,
    slug: ENDED_SLUG,
    statusWord: "Эфир завершён",
    control: "none",
    statement: "Регистрация закрыта",
    controlName: null,
  },
];

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * The parity matrix: 28 rows, one `test()` each. Numbering is flat across the
 * clause (ADR-0006 §4) and deterministic in the loop order below, so a row keeps
 * its number as long as the matrix keeps its shape.
 */
let caseNumber = 0;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`020 EARS-20: doctor.school at ${viewport.label} × ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const spec of CASES) {
        caseNumber += 1;
        const arm = spec.registered ? `${spec.auth}-registered` : spec.auth;
        const label = `${viewport.label} / ${theme} / ${spec.phase} / ${arm}`;

        test(`020 EARS-20.${caseNumber}: ${label} — the painted theme, no horizontal overflow, the header, the server-resolved control and no axe violation`, async ({
          page,
          context,
          baseURL,
        }) => {
          await useTheme(page, theme);
          if (spec.auth === "signed-in") await signIn(context, baseURL!);

          const response = await page.goto(`/events/${spec.slug}`, {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status(), "the event page is a 200").toBe(200);

          // (a) the theme actually painted is the one asked for — every contrast
          // assertion below is worthless if it is not.
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

          // (c) this host's own storefront header, and the shared page under it.
          const header = page.getByRole("banner");
          await expect(
            header,
            "the storefront header landmark is present",
          ).toHaveCount(1);
          await expect(header, "the storefront header is visible").toBeVisible();
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
            (await status.innerText()).replace(/\s+/g, " ").trim(),
            `the status plate states "${spec.statusWord}" in words`,
          ).toContain(spec.statusWord);

          // (d) the participation control the SERVER resolved — and only it.
          const linkCta = page.getByTestId("event-signup-cta");
          const oneTap = page.getByTestId("event-register-one-tap");
          const statement = page.getByTestId("event-signup-statement");

          if (spec.control === "none") {
            // 020 invariant: where participation is withheld the card dead-ends
            // in WORDS — no control at all, never a disabled one.
            await expect(linkCta, "no participation link").toHaveCount(0);
            await expect(oneTap, "no one-tap command").toHaveCount(0);
            await expect(statement, "the card states the fact").toBeVisible();
            expect(
              (await statement.innerText()).replace(/\s+/g, " ").trim(),
              "the statement carries the server's own copy",
            ).toContain(spec.statement!);
          } else {
            const control = spec.control === "one-tap" ? oneTap : linkCta;
            const other = spec.control === "one-tap" ? linkCta : oneTap;
            // The single-CTA invariant: exactly ONE participation control.
            await expect(
              control,
              "exactly one participation control",
            ).toHaveCount(1);
            await expect(
              other,
              "and no second control of the other kind",
            ).toHaveCount(0);
            expect(
              (await control.innerText())
                .replace(/\s+/g, " ")
                .replace(/↗/g, "")
                .trim(),
              `the control names "${spec.controlName}" without leaning on the decorative arrow`,
            ).toContain(spec.controlName!);
            await expectOperable(page, control, "the participation control");

            // (e) it is HIT-TESTABLE where it is painted: nothing (a pinned
            // card, an overlay) sits between the doctor's finger and it.
            const box = await control.boundingBox();
            expect(box, "the control has a box").not.toBeNull();
            expect(
              Math.round(box!.x + box!.width),
              "the control is clipped by the viewport's right edge",
            ).toBeLessThanOrEqual(viewport.width);
            expect(
              box!.x,
              "the control is clipped by the viewport's left edge",
            ).toBeGreaterThanOrEqual(0);
            const onTop = await control.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
              return !!hit && (hit === node || node.contains(hit));
            });
            expect(
              onTop,
              "something is covering the participation control",
            ).toBe(true);
          }

          // The two-column shell's reflow. Below the `layout` breakpoint the
          // grid is ONE column and the canvas puts the sign-up card FIRST
          // (`event-page-shell.tsx`, the aside's `order-first`); at 1440 it is
          // the pinned right-hand column beside the reading flow.
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
                `host-doctor-${spec.phase}-${arm}-${viewport.label}-${theme}.png`,
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
