import { expect, test } from "@playwright/test";

/**
 * 019 EARS-6 (#1521) — the «Идёт сейчас» block above the doctor events feed.
 *
 * The four things only a real browser can evidence:
 *
 *  1. a registered doctor's action leads into the ROOM, and
 *  2. everyone else's leads to the event page — never the room, so an
 *     impossible affordance is absent rather than dead;
 *  3. nothing live ⇒ the block is ABSENT from the tree, not hidden by CSS; and
 *  4. the block CLEARS ITSELF when the эфир ends — on the bounded refresh, with
 *     no reload — which is the whole reason the read is polled (LD-6).
 *
 * Liveness is flipped on the upstream stand-in (`POST /__e2e/live`), never in
 * the page: if the browser could make the block appear, the test would be
 * evidencing a client-side liveness authority the design forbids.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const SLUG = "prp-questions";

async function setScenario(
  request: { post: (url: string, init: { data: unknown }) => Promise<unknown> },
  scenario: "registered" | "unregistered" | "none",
) {
  await request.post(`${API}/__e2e/live`, { data: { scenario } });
}

test.afterEach(async ({ request }) => {
  await setScenario(request, "none");
});

test("019 EARS-6: a registered doctor's live strip leads into the room", async ({
  page,
  request,
}) => {
  await setScenario(request, "registered");
  // The `__Host-` prefix is https-only in Chromium and this tier serves http,
  // so the session rides a request HEADER — exactly what the route reads.
  await page.setExtraHTTPHeaders({ cookie: "__Host-ds_session=e2e-doctor" });
  await page.goto("/events");

  const block = page.getByTestId("events-live-block");
  await expect(block).toBeVisible();
  await expect(block.getByRole("status")).toHaveText("Идёт сейчас");
  await expect(block.getByTestId("live-event-strip-meta")).toContainText(
    "412 в комнате",
  );
  const action = block.getByTestId("live-event-strip-action");
  await expect(action).toHaveText("Войти в комнату эфира");
  await expect(action).toHaveAttribute("href", `/events/${SLUG}/room`);
  // The title always points at the event's own page, whatever the action does.
  await expect(block.getByTestId("live-event-strip-title")).toHaveAttribute(
    "href",
    `/events/${SLUG}`,
  );
  // The block sits ABOVE the feed, as the canvas has it.
  await expect(
    block.locator("xpath=following-sibling::*[@data-events-feed]"),
  ).toHaveCount(0);
});

test("019 EARS-6: a guest sees the same эфир but is sent to the event page, never the room", async ({
  page,
  request,
}) => {
  await setScenario(request, "registered");
  await page.goto("/events");

  const block = page.getByTestId("events-live-block");
  await expect(block).toBeVisible();
  const action = block.getByTestId("live-event-strip-action");
  await expect(action).toHaveText("Открыть страницу события");
  await expect(action).toHaveAttribute("href", `/events/${SLUG}`);
  await expect(block.locator('a[href$="/room"]')).toHaveCount(0);
});

test("019 EARS-6: nothing live ⇒ the block is absent from the tree, not hidden", async ({
  page,
  request,
}) => {
  await setScenario(request, "none");
  await page.goto("/events");

  await expect(page.getByTestId("events-live-block")).toHaveCount(0);
  await expect(page.getByTestId("live-event-strip")).toHaveCount(0);
  // The feed itself is untouched by the absent block.
  await expect(page.locator("[data-events-feed]")).toBeVisible();
});

test("019 EARS-6: the block clears itself when the эфир ends — on the bounded refresh, with no reload", async ({
  page,
  request,
}) => {
  await page.clock.install();
  await setScenario(request, "registered");
  await page.setExtraHTTPHeaders({ cookie: "__Host-ds_session=e2e-doctor" });
  await page.goto("/events");

  const block = page.getByTestId("events-live-block");
  await expect(block).toBeVisible();
  // The cadence is the contract's, read off the rendered block rather than
  // re-typed here — a host that drifted from `DOCTOR_EVENTS_LIVE_REFRESH_SECONDS`
  // would fail this line rather than silently poll on its own schedule.
  await expect(block).toHaveAttribute("data-refresh-seconds", "30");

  // The room closes upstream. Nothing in the page knows yet — and nothing in
  // the page COULD know: there is no start time to compare a clock against.
  await setScenario(request, "none");
  await expect(block).toBeVisible();

  await page.clock.fastForward(31_000);
  await expect(page.getByTestId("events-live-block")).toHaveCount(0);
});
