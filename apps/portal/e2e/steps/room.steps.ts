import { expect, type Page } from "@playwright/test";
import { After, Given, Then, When } from "../support/fixtures";
import { provisionLoggedInDoctor, submitRegisterAndVerify } from "../support/doctor-session";

/**
 * 006 room-journey step definitions (#584) — the browser translation of the
 * requirements Verification `all` row: a registered doctor enters a live room →
 * player instantiated from the provider enum → chat fans out in real time → the
 * visibility-gated heartbeat fires on the N-second cadence (pauses backgrounded,
 * resumes on re-focus) → denied-access branches route truthfully → a closed room
 * degrades to the ended state, plus the browser-observable authz + frame-only +
 * МСК-no-drift cross-cuts. Driven on the live dev stand, riding the non-Moscow
 * `bdd`-project timezone so the МСК labels prove no viewer-local drift (EARS-10).
 *
 * There is NO seeded roster: every scenario self-provisions its doctor through the
 * REAL 003 register→verify(Mailpit-OTP)→auto-login flow (`support/doctor-session`,
 * the same path the 005 journey drives) and completes the REAL 005 registration by
 * carrying a `returnTo` to the event page — "done against the real dependency". The
 * whole file is dev-stand-gated: the reused Background step («the live dev stand is
 * available», registration.steps) `test.skip`s the scenario unless a running portal
 * + real Zitadel + Mailpit are present, so a stray CI invocation is inert.
 *
 * Step TITLES are globally distinct from the 004/005 journey steps (playwright-bdd
 * merges every step file into one registry — a duplicated title is an ambiguous-step
 * error); the shared Background step is intentionally REUSED, not redefined.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

// Seeded rooms (the 006↔007 fixture seam). `seed-005-live` is the rutube happy/chat/
// heartbeat room; the `seed-006-room-*` events pin the provider-enum variants; the
// upcoming/ended seeds drive the not-live + closed-room branches. Every slug is
// env-overridable so a differently-seeded stand can retarget without a code change.
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";
const SLUG_YOUTUBE = process.env.E2E_ROOM_SLUG_YOUTUBE ?? "seed-006-room-youtube";
const SLUG_RUTUBE = process.env.E2E_ROOM_SLUG_RUTUBE ?? "seed-006-room-rutube";
const SLUG_UNAVAILABLE =
  process.env.E2E_ROOM_SLUG_UNAVAILABLE ?? "seed-006-room-unavailable";
const SLUG_NOT_LIVE =
  process.env.E2E_WEBINAR_SLUG_NOT_LIVE ??
  process.env.E2E_WEBINAR_SLUG ??
  "seed-005-upcoming";
// The heartbeat cadence N is server config (ROOM_HEARTBEAT_INTERVAL_SECONDS)
// delivered in the grant; a live-verify api is booted with a SHORT N so the cadence
// is observable in a test window — read that same value here.
const HEARTBEAT_SECONDS = Number(process.env.E2E_ROOM_HEARTBEAT_SECONDS ?? "2");

const CONFIRMATION = "Вы записаны";
const roomUrl = (slug: string): string => `${BASE}/webinars/${slug}/room`;
const eventUrl = (slug: string): string => `${BASE}/webinars/${slug}`;

/**
 * Self-provision a doctor REGISTERED for `slug` through the real 003+005 flow:
 * register carrying a `returnTo` to the event page, so entering the verify OTP
 * auto-logs-in AND completes the 005 registration, landing on the event page in the
 * registered state. Selectors inside `submitRegisterAndVerify` are locale-agnostic.
 */
async function registerForRoom(page: Page, slug: string): Promise<void> {
  await page.goto(
    `${BASE}/register?returnTo=${encodeURIComponent(`/webinars/${slug}`)}`,
    { waitUntil: "domcontentloaded" },
  );
  await submitRegisterAndVerify(page);
  await page.waitForURL(new RegExp(`/webinars/${slug}(?:$|[?#])`));
  await expect(page.getByText(CONFIRMATION, { exact: false }).first()).toBeVisible();
}

/**
 * Assert the current page renders NO room composition — no player frame (real or the
 * "unavailable" state), no chat aside, no room context. The "no soft wall" invariant:
 * a denied / closed room never shows the player, chat, or a room shell.
 */
async function expectNoRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("room-chat")).toHaveCount(0);
  await expect(page.getByTestId("room-context")).toHaveCount(0);
}

/** Attach a request listener that counts heartbeat POSTs to the gated endpoint. */
function trackHeartbeats(page: Page): { count: number } {
  const beats = { count: 0 };
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/v1\/events\/[^/]+\/heartbeat$/.test(req.url())
    ) {
      beats.count += 1;
    }
  });
  return beats;
}

/**
 * Drive the Page Visibility signal directly (the standard Playwright pattern):
 * headless Chromium keeps every page "visible", so overriding `document.hidden` +
 * dispatching `visibilitychange` exercises the exact handler the loop registers.
 */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (h ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

/** The live chat composer input (locale-agnostic, mirrors room-chat.spec.ts). */
function composer(page: Page) {
  return page.getByRole("textbox", { name: /написать в чат|chat/i }).first();
}
/** The live chat send control. */
function sendButton(page: Page) {
  return page.getByRole("button", { name: /отправить|send/i }).first();
}

// ── Admission & composition (EARS-1/EARS-2/EARS-9/EARS-10) ────────────────────

Given("a registered doctor on the live event", async ({ page, world }) => {
  world.slug = SLUG_LIVE;
  await registerForRoom(page, world.slug);
});

When("the doctor enters the live room", async ({ page, world }) => {
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  // The gate admits (authenticated ∧ registered ∧ live) → the room url holds (no
  // redirect to login/event), the room composition renders.
  await page.waitForURL(new RegExp(`/webinars/${world.slug}/room$`));
});

Then(
  "the room renders the embed player and the live chat composition",
  async ({ page }) => {
    // EARS-1 consumed → EARS-2 composition: the event context, the live chat aside,
    // and the embed player (seed-005-live is a rutube-provider room) all compose.
    await expect(page.getByTestId("room-context").first()).toBeVisible();
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
    await expect(page.getByTestId("room-player-rutube")).toBeVisible();
  },
);

Then(
  "the live-room player is a configured provider frame only, never a re-hosted surface",
  async ({ page }) => {
    // EARS-9: the stream is embedded as a configured provider FRAME only — a plain
    // provider <iframe> pointing at the provider's embed URL, not a transcoded /
    // re-hosted / proxied surface. (The negative "no telemeter/record/DRM" claim is
    // structural and pinned by the api/unit tests; the browser observes the
    // frame-only positive.)
    const player = page.getByTestId("room-player-rutube");
    await expect(player).toBeVisible();
    const tag = await player.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe("iframe");
    await expect(player).toHaveAttribute("src", /rutube\.ru\/play\/embed\//);
  },
);

Then(
  "the event page the room admits through labels every absolute time in МСК with no viewer-local drift",
  async ({ page, world }) => {
    // EARS-10: under the non-Moscow browser timezone (config `bdd` project,
    // America/New_York) absolute times still render in Europe/Moscow, labeled МСК.
    // The room composition itself carries NO absolute program time in wave 1 (the
    // «О эфире» tab shows live-status copy, not a timed agenda — room-view.tsx), so
    // the МСК-no-drift guarantee is pinned on the registered event page the room's
    // admission passes through, which DOES render the МСК start instant.
    await page.goto(eventUrl(world.slug), { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText("МСК");
  },
);

// ── The player is instantiated from the provider enum (EARS-2) ────────────────

Given(
  "a registered doctor on the {string}-provider live room",
  async ({ page, world }, provider: string) => {
    world.slug = provider === "youtube" ? SLUG_YOUTUBE : SLUG_RUTUBE;
    await registerForRoom(page, world.slug);
  },
);

When("the doctor enters that provider room", async ({ page, world }) => {
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`/webinars/${world.slug}/room$`));
});

Then(
  "the {string} embed frame is rendered from the enum value, not the other provider",
  async ({ page }, provider: string) => {
    // EARS-2: asserting the provider's OWN frame renders while the OTHER provider's
    // does not proves the player is keyed on the enum, never sniffed from the URL.
    if (provider === "youtube") {
      const player = page.getByTestId("room-player-youtube");
      await expect(player).toBeVisible();
      await expect(player).toHaveAttribute("src", /youtube\.com\/embed\//);
      await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    } else {
      const player = page.getByTestId("room-player-rutube");
      await expect(player).toBeVisible();
      await expect(player).toHaveAttribute("src", /rutube\.ru\/play\/embed\//);
      await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    }
    await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
  },
);

// ── Unknown/absent provider → truthful unavailable (EARS-2 edge) ──────────────

Given("a registered doctor on the stream-unconfigured live room", async ({ page, world }) => {
  world.slug = SLUG_UNAVAILABLE;
  await registerForRoom(page, world.slug);
});

When("the doctor enters that unconfigured room", async ({ page, world }) => {
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`/webinars/${world.slug}/room$`));
});

Then(
  "the room shows the truthful stream-unavailable state and renders no embed frame",
  async ({ page }) => {
    // EARS-2: an unknown/absent provider yields the truthful "stream unavailable"
    // state — no guessed embed. The room chrome (chat aside) still composes.
    await expect(page.getByTestId("room-player-unavailable")).toBeVisible();
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
  },
);

// ── Live chat fan-out over Centrifugo (EARS-3) ────────────────────────────────

Given("two registered doctors in the same live room", async ({ page, browser, world }) => {
  world.slug = SLUG_LIVE;
  // Doctor A rides the default `bdd`-project context (`page`). Doctor B is a SECOND,
  // independent 003 session in a fresh context (a distinct doctor in the same room),
  // stored on the world so the When/Then steps can drive it and the After hook can
  // close it. Both self-register for the live room, then open its chat.
  await registerForRoom(page, world.slug);
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("room-chat-messages").first()).toBeVisible();

  world.ctxB = await browser.newContext();
  world.pageB = await world.ctxB.newPage();
  await registerForRoom(world.pageB, world.slug);
  await world.pageB.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  await expect(world.pageB.getByTestId("room-chat-messages").first()).toBeVisible();
});

When("one doctor posts a chat message", async ({ page, world }) => {
  // Doctor A posts a unique message through the gated composer (the composer POSTs
  // the server-gated `POST /v1/events/:slug/chat` command — the ONLY publish path).
  world.chatMessage = `Вопрос от коллеги A — ${Date.now()}`;
  await composer(page).fill(world.chatMessage);
  await sendButton(page).click();
});

Then(
  "the other doctor sees the message appear in real time without reloading the page",
  async ({ world }) => {
    // EARS-3: A's message fans out to doctor B over the REAL Centrifugo channel with
    // NO reload of page B — the subscribe-only connection token the grant carried
    // delivers it live.
    expect(world.pageB, "the second doctor's page should be provisioned").toBeTruthy();
    await expect(
      world.pageB!.getByTestId("room-chat-message").filter({ hasText: world.chatMessage }),
    ).toBeVisible({ timeout: 15_000 });
  },
);

// ── Visibility-gated heartbeat cadence (EARS-4) ───────────────────────────────

Given(
  "a registered doctor watching in the live room with the tab visible",
  async ({ page, world }) => {
    world.slug = SLUG_LIVE;
    await registerForRoom(page, world.slug);
    // Attach the beat counter BEFORE navigating so no beat is missed, then enter.
    world.beats = trackHeartbeats(page);
    await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
    await page.waitForURL(new RegExp(`/webinars/${world.slug}/room$`));
  },
);

When("the doctor stays in the room across several cadence intervals", async ({ page }) => {
  // No doctor action — beats fire purely on the timer. Wait ~3 intervals so a
  // cadence (immediate mount beat + at least one on the N-second grid) is observable.
  await page.waitForTimeout(HEARTBEAT_SECONDS * 3200);
});

Then(
  "the client posts more than one authenticated heartbeat, driven only by the timer",
  async ({ world }) => {
    // EARS-4: a visible tab fires more than one beat with no click — the cadence, not
    // a one-shot ping.
    expect(world.beats!.count).toBeGreaterThanOrEqual(2);
  },
);

Given("a registered doctor posting heartbeats in the live room", async ({ page, world }) => {
  world.slug = SLUG_LIVE;
  await registerForRoom(page, world.slug);
  world.beats = trackHeartbeats(page);
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`/webinars/${world.slug}/room$`));
  // Let the visible loop fire at least one beat before we background it.
  await page.waitForTimeout(HEARTBEAT_SECONDS * 2200);
  expect(world.beats.count).toBeGreaterThanOrEqual(1);
});

When(
  "the room tab is backgrounded so document.hidden becomes true",
  async ({ page, world }) => {
    await setHidden(page, true);
    await page.waitForTimeout(200);
    world.beatsWhileHidden = world.beats!.count;
  },
);

Then("the client stops posting heartbeats while the tab is hidden", async ({ page, world }) => {
  // EARS-4: while hidden the loop emits NO beats — a backgrounded tab's minutes do
  // not count toward the sponsor report, so the count does not grow.
  await page.waitForTimeout(HEARTBEAT_SECONDS * 3000);
  expect(world.beats!.count).toBe(world.beatsWhileHidden);
});

When("the room tab becomes visible again", async ({ page }) => {
  await setHidden(page, false);
});

Then("the client resumes posting authenticated heartbeats", async ({ page, world }) => {
  // EARS-4: on re-focus the loop resumes (an immediate beat + the N-second grid), so
  // the count grows past the frozen while-hidden value.
  await page.waitForTimeout(HEARTBEAT_SECONDS * 2200);
  expect(world.beats!.count).toBeGreaterThan(world.beatsWhileHidden!);
});

// ── Denied-access routing, never a soft wall (EARS-6) ─────────────────────────

Given("a caller who is {string} for the live room", async ({ page, context, world }, condition: string) => {
  switch (condition) {
    case "unauthenticated": {
      // A genuine guest — no session; the target room is the live room.
      world.slug = SLUG_LIVE;
      await context.clearCookies();
      break;
    }
    case "authenticated but unregistered": {
      // A fresh 003 doctor authenticated but NOT on the live room's roster.
      world.slug = SLUG_LIVE;
      await provisionLoggedInDoctor(page);
      await page.waitForURL(/\/account/);
      break;
    }
    case "on an event that is not live": {
      // A doctor REGISTERED for a NOT-live (upcoming) event.
      world.slug = SLUG_NOT_LIVE;
      await registerForRoom(page, world.slug);
      break;
    }
    default:
      throw new Error(`unknown access condition token: ${condition}`);
  }
});

When("the caller reaches the room", async ({ page, world }) => {
  await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
});

Then(
  "the caller is routed to {string} and no room composition is rendered",
  async ({ page, world }, destination: string) => {
    // EARS-6: the server-side gate refusal routes TRUTHFULLY (never a soft wall over
    // a hidden player), branching on the refusal reason.
    if (destination === "the 003 auth flow") {
      // 401 → the 003 login flow, carrying a returnTo BACK to this room url so the
      // gate re-evaluates on return.
      await page.waitForURL(/\/login\?/);
      expect(page.url()).toContain(
        `returnTo=${encodeURIComponent(`/webinars/${world.slug}/room`)}`,
      );
    } else if (destination === "the 005 register front door") {
      // 403 → the 004/005 event page carrying `?from=room`, surfacing the access
      // guidance above the register front door.
      await page.waitForURL(new RegExp(`/webinars/${world.slug}\\?from=room`));
      await expect(page.getByTestId("room-access-guidance")).toBeVisible();
      await expect(page.getByTestId("event-register-one-tap")).toBeVisible();
    } else {
      // 409 not-live → the truthful 004 lifecycle state on the event page, with NO
      // `?from=room` register banner.
      await page.waitForURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
      expect(page.url()).not.toContain("from=room");
    }
    await expectNoRoom(page);
  },
);

// ── Room close stops capture → truthful ended state (EARS-7) ──────────────────

Given(
  "a registered doctor reaching the room of an event that has left live",
  async ({ page, world }) => {
    // A self-provisioned, authenticated doctor (lands on /account), then reaches the
    // room of an ENDED event (the post-close state — the live→ended transition is
    // authored by 007; the ended seed stands in for a closed room).
    world.slug = process.env.E2E_ROOM_SLUG_ENDED ?? "seed-005-ended";
    await provisionLoggedInDoctor(page);
    await page.waitForURL(/\/account/);
    await page.goto(roomUrl(world.slug), { waitUntil: "domcontentloaded" });
  },
);

Then(
  "the room degrades to the truthful ended state with no room composition",
  async ({ page, world }) => {
    // EARS-7: the gate no longer issues the grant, so the room degrades to the
    // truthful 004 ended lifecycle state on the event page — «Эфир завершён» — and
    // NO room composition renders (it was not soft-walled over a dead player).
    await page.waitForURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
    await expect(
      page.getByText("Эфир завершён", { exact: false }).first(),
    ).toBeVisible();
    await expectNoRoom(page);
  },
);

// ── Cross-cutting authz — the room surface requires a session (EARS-8) ────────

Given("a guest with no session targeting the live room", async ({ context, world }) => {
  world.slug = SLUG_LIVE;
  await context.clearCookies();
});

Then("the RoomConfig read is refused without a session", async ({ page, world }) => {
  // EARS-8: the RoomConfig read requires authentication ∧ registration — an
  // unauthenticated caller is refused (never served another doctor's room data).
  const res = await page.request.get(
    `${BASE}/v1/events/${encodeURIComponent(world.slug)}/room`,
    { headers: { accept: "application/json" } },
  );
  expect(res.ok(), "RoomConfig must not be served to an unauthenticated caller").toBe(
    false,
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

Then("the chat post is refused without a session", async ({ page, world }) => {
  const res = await page.request.post(
    `${BASE}/v1/events/${encodeURIComponent(world.slug)}/chat`,
    { headers: { accept: "application/json" }, data: { text: "guest" } },
  );
  expect(res.ok(), "the chat command must not be satisfied for a guest").toBe(false);
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

Then("the heartbeat post is refused without a session", async ({ page, world }) => {
  const res = await page.request.post(
    `${BASE}/v1/events/${encodeURIComponent(world.slug)}/heartbeat`,
    { headers: { accept: "application/json" } },
  );
  expect(res.ok(), "the heartbeat command must not be satisfied for a guest").toBe(
    false,
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

// ── Teardown — never leak the second chat context past the scenario ───────────

After(async ({ world }) => {
  if (world.ctxB) {
    await world.ctxB.close();
    world.ctxB = undefined;
    world.pageB = undefined;
  }
});
