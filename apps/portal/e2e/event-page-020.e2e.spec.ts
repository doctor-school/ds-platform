import { expect, test } from "@playwright/test";

/**
 * 020 EARS-1 (#1764, slice 3) — the academy storefront's mount of the ONE shared
 * event page. `apps/portal/app/webinars/[slug]/page.tsx` no longer composes a
 * host-local page: it is `EventPageShell` / `EventPageHero` / `EventSignupCard` /
 * `EventSpeakerCard` / `EventFormatBlock` over `EventPageView` plus the
 * server-resolved `ParticipationCta`.
 *
 * This pins the `020-scenarios.feature` L26–46 subset a GUEST must get: the page
 * is server-rendered with no authentication, carries the title, the kicker, the
 * date + time «МСК» line, the specialty chips, the «О чём событие» body and the
 * speakers, and the right column is the sticky sign-up card with EXACTLY ONE
 * primary «Участвовать» CTA. The 021 round-trip / registered card / room entry
 * rows are EARS-5/6/7 and out of this slice.
 *
 * Live-stand-gated tier (mirrors `event-page.e2e.spec.ts`): a running portal
 * whose `/v1/*` rewrite reaches a running api + Postgres seeded with a
 * `published` event. `test.skip`s unless `E2E_PORTAL_URL` + `E2E_WEBINAR_SLUG`
 * are provided, so a stray CI invocation is inert.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG,
  "requires a live portal + a seeded event slug",
);

test("020 EARS-1: a guest reads the whole event server-side, composed from the shared blocks", async ({
  page,
  context,
}) => {
  await context.clearCookies();

  const response = await page.goto(`${BASE}/webinars/${SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  // The shared composition, not a host-local one.
  await expect(page.getByTestId("event-page-shell")).toBeVisible();
  await expect(page.getByTestId("event-page-hero")).toBeVisible();
  await expect(page.getByTestId("event-page-main")).toBeVisible();

  // Title + kicker + the date/time line, all in the hero.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("event-page-hero")).toContainText("МСК");

  // Specialty chips (the read model's `specialties`).
  await expect(page.getByTestId("event-page-hero-chips")).toBeVisible();

  // The body the guest came for.
  await expect(page.getByTestId("event-about")).toBeVisible();
  await expect(page.getByTestId("event-speaker-card").first()).toBeVisible();

  // No soft-wall of any kind — the page is public.
  await expect(page.locator("body")).not.toContainText(
    /авторизуйтесь|войдите для просмотра/i,
  );
});

test("020 EARS-1: the right column is the sign-up card with exactly one primary CTA for a guest", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto(`${BASE}/webinars/${SLUG}`, { waitUntil: "domcontentloaded" });

  const aside = page.getByTestId("event-page-aside");
  await expect(aside).toBeVisible();
  const card = page.getByTestId("event-signup-card");
  await expect(card).toHaveCount(1);
  // The server-resolved action the card renders verbatim.
  await expect(card).toHaveAttribute("data-cta-action", "register");

  // EXACTLY ONE «Участвовать» on the whole page, and it carries the event
  // context into the 003 registration entry — the href the SERVER resolved.
  const cta = page.getByRole("link", { name: "Участвовать", exact: true });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute(
    "href",
    `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG}`)}`,
  );
});

test("020 EARS-1: the page is complete HTML from the server — the CTA is in the raw bytes, not injected by client JS", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/webinars/${SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("МСК");
  expect(html).toContain("Участвовать");
  // The «О чём событие» heading the owner asked for at Stage B (#1779): both
  // hosts now default to it. Copy defaults stay per-host overridable — that is
  // what 020 EARS-18 (#1764) lets the two hosts differ on — the academy simply
  // no longer overrides this one.
  expect(html).toContain("О чём событие");
});

test("020 EARS-1: an ended event renders the same composition with NO participation control (never a dead link)", async ({
  page,
  context,
}) => {
  test.skip(!SLUG_ENDED, "requires a seeded ended event");
  await context.clearCookies();

  const response = await page.goto(`${BASE}/webinars/${SLUG_ENDED}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("event-page-shell")).toBeVisible();
  await expect(page.getByTestId("event-signup-card")).toHaveCount(1);
  // The server said `unavailable`; the shared card renders words, not a control.
  await expect(page.getByTestId("event-signup-cta")).toHaveCount(0);
  for (const dead of ["Участвовать", "Записаться", "Смотреть эфир"]) {
    await expect(page.getByRole("link", { name: dead, exact: true })).toHaveCount(
      0,
    );
  }
});
