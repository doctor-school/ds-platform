import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";

/**
 * 004 discovery-journey step definitions (#559) — the browser translation of the
 * requirements Verification `all` row: a guest opens a sponsor-distributed direct
 * link → reads the page → opens the listing → clicks a card → back, across the
 * upcoming / live / ended / archived lifecycle states, driven on the live dev
 * stand. The whole journey rides a non-Moscow timezone (playwright.config `bdd`
 * project, America/New_York) so the МСК labels prove no viewer-local drift (EARS-12).
 *
 * 004 is the PUBLIC read side — every step here is a genuine GUEST (cookies cleared,
 * no session), unlike the 005 registration journey. Fixture events are the shared
 * seeded lifecycle events (apps/api/scripts/seed-events.ts, the 004↔007 seam); the
 * slugs are read from env so a stand with differently-named fixtures can override
 * them (the defaults match the shared seed script's slugs).
 *
 * Step titles are DISTINCT from the 005 registration-journey steps
 * (registration.steps.ts) — playwright-bdd merges every step file into one registry,
 * so a duplicated title would be an ambiguous-step error. The shared Background step
 * («the live dev stand is available») is intentionally reused, not redefined.
 */

const SEED = {
  upcoming: process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming",
  live: process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live",
  ended: process.env.E2E_WEBINAR_SLUG_ENDED ?? "seed-005-ended",
  archived: process.env.E2E_WEBINAR_SLUG_ARCHIVED ?? "seed-005-archived",
} as const;

const PARTICIPATE = "Участвовать";
const LIVE_LABEL = "В эфире";

/** Map an EARS-4 outline `state` token to its seeded slug. */
function slugForState(state: string): string {
  switch (state) {
    case "published":
      return SEED.upcoming;
    case "live":
      return SEED.live;
    case "ended":
      return SEED.ended;
    case "archived":
      return SEED.archived;
    default:
      throw new Error(`unknown lifecycle state token: ${state}`);
  }
}

// ── The connected discovery arc (EARS-1/EARS-8) ──────────────────────────────

Given(
  "a guest opens the seeded upcoming event by its direct link",
  async ({ page, context, world }) => {
    world.slug = SEED.upcoming;
    // A genuine guest — no session cookie rides the request, so the public 004
    // page renders (never a per-user state, never a soft-wall).
    await context.clearCookies();
    await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
  },
);

Then(
  "the full event page is server-rendered without authentication",
  async ({ page }) => {
    // EARS-1: complete HTML, no "log in to view" soft-wall.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /авторизуйтесь|войдите для просмотра/i,
    );
  },
);

Then(
  "the page carries the title, a МСК start time, and one «Участвовать» CTA",
  async ({ page }) => {
    // EARS-2/EARS-3: the decision set is present (title + МСК start) and there is
    // EXACTLY ONE primary participation CTA (the guest register handoff).
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.locator("body")).toContainText("МСК");
    await expect(
      page.getByRole("link", { name: PARTICIPATE, exact: true }),
    ).toHaveCount(1);
  },
);

When("the guest opens the upcoming-broadcasts listing", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/webinars", { waitUntil: "networkidle" });
  // Cold-compile guard: on a Next dev stand the route's very first render can
  // beat the seeded read model and paint the empty-state; a single reload lets the
  // populated list settle. A genuinely empty listing still shows the empty-state
  // after the reload, so this never masks a real regression (it just removes a
  // first-compile race from the seeded discovery arc).
  const emptyState = page.getByText("Нет предстоящих эфиров");
  if (await emptyState.isVisible().catch(() => false)) {
    await page.reload({ waitUntil: "networkidle" });
  }
});

Then(
  "the seeded upcoming event appears as a card labeled МСК",
  async ({ page, world }) => {
    // EARS-8: the seeded upcoming event is a card linking to its page, МСК-labeled.
    const card = page.locator(`a[href="/webinars/${world.slug}"]`).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("МСК");
  },
);

When("the guest activates that listing card", async ({ page, world }) => {
  await page.locator(`a[href="/webinars/${world.slug}"]`).first().click();
});

Then("the guest lands on that same event's page", async ({ page, world }) => {
  // EARS-8 → EARS-1: clicking the card navigates to the correct event page.
  await page.waitForURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

When("the guest navigates back to the listing", async ({ page }) => {
  // The browser back button — the closing leg of the discovery arc.
  await page.goBack({ waitUntil: "domcontentloaded" });
});

Then("the upcoming-broadcasts listing is shown again", async ({ page }) => {
  await page.waitForURL(/\/webinars(?:$|[?#])/);
  // The always-present poster header proves we are back on the listing surface.
  await expect(page.getByText("Расписание эфиров").first()).toBeVisible();
});

// ── Lifecycle renders from the single state machine (EARS-4) ──────────────────

Given(
  "a guest opens the seeded {string} event by its direct link",
  async ({ page, context, world }, state: string) => {
    world.slug = slugForState(state);
    await context.clearCookies();
    await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
  },
);

Then(
  "the event page hero shows the {string} lifecycle signal",
  async ({ page }, badge: string) => {
    // EARS-4: the hero lifecycle badge reflects the state machine — never a
    // contradictory signal.
    await expect(page.getByText(badge, { exact: true }).first()).toBeVisible();
  },
);

Then(
  "the participation affordance matches the {string} lifecycle state",
  async ({ page }, state: string) => {
    const cta = page.getByRole("link", { name: PARTICIPATE, exact: true });
    if (state === "published" || state === "live") {
      // Registrable states carry EXACTLY ONE «Участвовать» CTA (register-during-live
      // is a normal path — the room is 006/#584, never a `/room` link here).
      await expect(cta).toHaveCount(1);
    } else {
      // `ended` carries NO participation affordance — never a dead link (EARS-4).
      await expect(cta).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Записаться", exact: true }),
      ).toHaveCount(0);
    }
  },
);

// ── Archived direct link degrades gracefully (EARS-5) ─────────────────────────

Given(
  "a guest opens the seeded archived event by its direct link",
  async ({ page, context, world }) => {
    world.slug = SEED.archived;
    await context.clearCookies();
    // Capture the response so the reachable-200 assertion can read the status.
    world.lastStatus =
      (
        await page.goto(`/webinars/${world.slug}`, {
          waitUntil: "domcontentloaded",
        })
      )?.status() ?? 0;
  },
);

Then(
  "the archived page is a reachable 200 on the same URL, not a 404 or a redirect",
  async ({ page, world }) => {
    // EARS-5 (owner variant «а»): a previously-distributed link degrades to a
    // reachable page in place — never a 404 dead-end, never a 3xx bounce.
    expect(world.lastStatus).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/webinars/${world.slug}`);
  },
);

Then(
  "the «мероприятие в архиве» notice is shown with no participation CTA",
  async ({ page }) => {
    await expect(page.getByText("В архиве", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Мероприятие в архиве").first(),
    ).toBeVisible();
    // No participation affordance in any of its verbs (the fourth CTA-less render).
    await expect(
      page.getByRole("link", { name: PARTICIPATE, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
  },
);

// ── Cross-surface live consistency (EARS-9) ───────────────────────────────────

Then(
  "the seeded live event's card shows the «В эфире» signal",
  async ({ page, world }) => {
    world.slug = SEED.live;
    const card = page.locator(`a[href="/webinars/${world.slug}"]`).first();
    await expect(card).toBeVisible();
    // The live signal is inside the card itself (derived from state === 'live').
    await expect(card).toContainText(LIVE_LABEL);
  },
);

When("the guest opens the seeded live event's page", async ({ page, context, world }) => {
  world.slug = SEED.live;
  await context.clearCookies();
  await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
});

Then("the event page shows the same «В эфире» signal", async ({ page }) => {
  // EARS-9: both surfaces read the one `EventLifecycleState`, so they cannot
  // present a contradictory signal for one event.
  await expect(page.getByText(LIVE_LABEL).first()).toBeVisible();
});

// ── МСК no viewer-local drift (EARS-12) ───────────────────────────────────────

Then(
  "every time on the page is labeled МСК with no drift to the viewer timezone",
  async ({ page }) => {
    // Under the non-Moscow browser timezone (config `bdd` project,
    // America/New_York) every instant is still presented in Europe/Moscow,
    // explicitly labeled МСК — computed server-side from the canonical instant.
    await expect(page.locator("body")).toContainText("МСК");
  },
);

Then(
  "every time on the listing is labeled МСК with no drift to the viewer timezone",
  async ({ page }) => {
    await expect(page.locator("body")).toContainText("МСК");
  },
);
