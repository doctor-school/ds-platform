import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";
import { provisionLoggedInDoctor } from "./support/doctor-session";

/**
 * 006 EARS-18 — the player-failure state machine must never LIE about a stream
 * that is actually playing (#1314: «Перезапустить плеер» stood over a running
 * эфир; #1932 pins the fixed behaviour on the live stand).
 *
 * Two halves, one per provider-observability class (006 design §3.1) — the split
 * the state machine itself makes, so each half is driven against a REAL embed of
 * that class rather than a mocked signal:
 *
 * - **vk (parent-observable)** — `resolveEmbed` always appends `js_api=1`, so a
 *   really-playing stream produces a real `playing` signal and the watchdog never
 *   fires. Past the watchdog budget the room shows the embed and NOTHING else:
 *   no advisory, no failure overlay, no restart affordance. That is the #1314
 *   regression, pinned.
 * - **cdnvideo (structurally silent)** — the room subscribes to no provider
 *   channel at all, so it can never truthfully claim anything about the stream.
 *   Per the owner decision on #1929 (Stage-B, 2026-09-06) it therefore renders
 *   NOTHING of its own over a cdnvideo embed, from mount onward and forever: no
 *   advisory, no time box, no restart. The bare provider iframe is the whole
 *   surface.
 *
 * Live-stand-gated tier: it needs a running portal whose `/v1/*` rewrite reaches
 * a running api + Postgres + real Zitadel + Mailpit, seeded with the
 * `seed-006-room-vk` / `seed-006-room-cdnvideo` LIVE events
 * (`pnpm --filter @ds/api seed:events`). Each test SELF-PROVISIONS its doctor
 * through the real 003 register → verify → auto-login flow (Playwright gives
 * every test a fresh browser context, so a session never carries across — the
 * same per-test provisioning `room.spec.ts` drives), so the suite runs on the
 * live-stand env + the seeds alone. A completely bare environment stays
 * inert-green; a partially exported env set fails loudly naming the missing
 * variables (#1871, `support/live-stand-env.ts`).
 *
 * ENV SET — export ALL of these to run this spec:
 *
 * | variable                 | value on the dev stand            |
 * | ------------------------ | --------------------------------- |
 * | `E2E_PORTAL_URL`         | the running portal origin         |
 * | `IDP_ISSUER`             | the real Zitadel issuer           |
 * | `MAILPIT_URL`            | the dev-stand Mailpit REST origin |
 * | `E2E_ROOM_SLUG_VK`       | `seed-006-room-vk`                |
 * | `E2E_ROOM_SLUG_CDNVIDEO` | `seed-006-room-cdnvideo`          |
 *
 * STAND PRECONDITION: boot the api with the raised 003 EARS-13 ceilings
 * (`RATE_LIMIT_PER_USER_15MIN=1000`, `RATE_LIMIT_PER_IP_15MIN=2000`,
 * `RATE_LIMIT_PER_ASN_1H=5000`) — this file drives two real signups from one IP,
 * and at the defaults the second one hard-429s.
 *
 * These tests are wall-clock bound BY DESIGN: the watchdog budget (20 s) is a
 * real product budget and is never shortened in code to make a test faster
 * (AGENTS.md §6 — no workarounds).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG_VK = process.env.E2E_ROOM_SLUG_VK ?? "seed-006-room-vk";
const SLUG_CDNVIDEO =
  process.env.E2E_ROOM_SLUG_CDNVIDEO ?? "seed-006-room-cdnvideo";

/** `PLAYER_WATCHDOG_MS` (20 s) + margin — past this a stall would have surfaced. */
const PAST_WATCHDOG_MS = 32_000;
/** The cdnvideo dwell: long enough that a deferred room-owned surface would show. */
const CDNVIDEO_DWELL_MS = 40_000;

/**
 * Committed live-run evidence for #1932 (quoted in the PR body). Derived from the
 * Playwright config root (`apps/portal`) rather than a module-local `__dirname`,
 * which this ESM spec does not have.
 */
const evidencePath = (name: string): string =>
  path.resolve(
    test.info().config.rootDir,
    "..",
    "..",
    ".github",
    "ui-evidence",
    "1932",
    name,
  );

requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "IDP_ISSUER",
  "MAILPIT_URL",
  "E2E_ROOM_SLUG_VK",
  "E2E_ROOM_SLUG_CDNVIDEO",
]);

// Real signups against a shared Mailpit inbox: never race them.
test.describe.configure({ mode: "serial" });

// Relaxing Chromium's autoplay policy removes the browser as a confound; it is
// NOT sufficient on its own — VK's embed emits `inited` and then sits at
// `state: "unstarted"` until someone presses play (probed live, 2026-09-06), so
// the drive presses play explicitly (see `startPlayback`).
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

/**
 * Register the freshly-provisioned doctor for `slug` (the room admission gate
 * precondition) and enter the room, satisfying the 006 EARS-14 JIT display-name
 * prompt a brand-new doctor always gets on first room entry — without a name the
 * prompt renders INSTEAD of the room composition and no player exists to assert
 * on. Selectors are locale-agnostic (stable `data-testid`), never visible copy.
 */
async function enterRoom(page: Page, slug: string): Promise<void> {
  await page.goto(`${BASE}/webinars/${slug}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("event-register-one-tap").click();
  // The one-tap swaps to the registered confirmation via a server refresh — wait
  // for the register CTA to leave before entering the room.
  await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
  await page.goto(`${BASE}/webinars/${slug}/room`, {
    waitUntil: "domcontentloaded",
  });
  // Wait for the prompt AND for the page to finish loading before submitting:
  // the form degrades to a plain GET before hydration, which re-renders the
  // prompt instead of saving the name (observed live, 2026-09-06).
  await expect(page.getByTestId("display-name-prompt")).toBeVisible();
  await page.waitForLoadState("load");
  await page.getByTestId("display-name-input").fill("Тест Врачов");
  await page.getByTestId("display-name-submit").click();
  await expect(page.getByTestId("room-context-strip")).toBeVisible();
}

/**
 * Mirror every parent-directed `postMessage` into the page console BEFORE any app
 * script runs, so the drive records the RAW provider payloads as evidence. Pure
 * observation — it never injects a message, so it cannot manufacture a `playing`
 * signal the product did not actually receive.
 */
async function recordProviderMessages(page: Page): Promise<string[]> {
  const log: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[1932-raw]")) log.push(text);
  });
  await page.addInitScript(() => {
    window.addEventListener("message", (event: MessageEvent) => {
      let payload: string;
      try {
        payload =
          typeof event.data === "string"
            ? event.data
            : JSON.stringify(event.data);
      } catch {
        payload = String(event.data);
      }

      console.log(`[1932-raw] ${event.origin} :: ${payload?.slice(0, 400)}`);
    });
  });
  return log;
}

/**
 * Press play the way a doctor does, and wait until the embed CONFIRMS it started.
 *
 * VK never autoplays: the embed reports its `inited` handshake and then stays at
 * `state: "unstarted"` until a real gesture starts playback. A doctor opening a
 * room does exactly that, so the click is the product path rather than a test
 * crutch — and dwelling without it would pin a stream nobody ever started, which
 * is not the #1314 false positive at all.
 *
 * The click waits for the handshake first: an iframe that is merely VISIBLE is
 * not yet a player, and a click landing before `inited` is swallowed by VK
 * (observed live, 2026-09-06 — the drive then sat at `unstarted` until the
 * watchdog re-created the embed). Both waits read VK's OWN events out of the
 * recorded traffic, so «is it ready?» and «is it playing?» are answered by the
 * provider rather than assumed from a timer.
 */
async function startPlayback(
  player: Locator,
  raw: readonly string[],
): Promise<void> {
  await expect
    .poll(() => raw.some((line) => line.includes('"event":"inited"')), {
      message: "the vk embed must complete its `inited` handshake before play",
      timeout: 45_000,
    })
    .toBe(true);
  await player.click();
  await expect
    .poll(() => raw.some((line) => line.includes('"event":"started"')), {
      message: "the vk embed must report `started` after the doctor presses play",
      timeout: 45_000,
    })
    .toBe(true);
}

/**
 * Assert the room renders NOTHING of its own over the embed: none of the four
 * room-owned player controls, and no «Перезапустить плеер» copy anywhere (the
 * visible-text check catches a re-labelled or re-tagged affordance that the
 * testid list alone would miss).
 */
async function expectNoRoomOwnedControl(page: Page): Promise<void> {
  await expect(page.getByTestId("room-player-suspected")).toHaveCount(0);
  await expect(page.getByTestId("room-player-failure")).toHaveCount(0);
  await expect(page.getByTestId("room-player-restart")).toHaveCount(0);
  await expect(page.getByTestId("room-player-unverified-restart")).toHaveCount(
    0,
  );
  await expect(page.getByText("Перезапустить плеер")).toHaveCount(0);
}

test.describe("006 EARS-18 the player advisory never stands over a live embed", () => {
  test("006 EARS-18.2: a vk stream that is actually playing leaves no advisory and no «Перезапустить плеер» past the watchdog budget", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const raw = await recordProviderMessages(page);
    await provisionLoggedInDoctor(page);
    await enterRoom(page, SLUG_VK);

    // EARS-18.2 — the embed is built parent-observable: `js_api=1` rides the src.
    const player = page.getByTestId("room-player-vk");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute("src", /vk\.com\/video_ext\.php\?/);
    await expect(player).toHaveAttribute("src", /[?&]js_api=1(?:&|$)/);

    // The stream is genuinely playing (VK said `started`, not the test): past the
    // watchdog budget — counted from the mount that armed it — the room still
    // shows only the embed. The #1314 false positive is gone.
    const mountedAt = Date.now();
    await startPlayback(player, raw);
    const remaining = PAST_WATCHDOG_MS - (Date.now() - mountedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    await expect(player).toBeVisible();
    await expectNoRoomOwnedControl(page);

    await page.screenshot({
      path: evidencePath("vk-playing-no-advisory.png"),
    });

    // The recorded raw traffic is the evidence that the observable channel is
    // actually open (attached, not asserted key-by-key — the VK wire shape is
    // theirs, not ours).
    await test.info().attach("vk-postmessage-raw.log", {
      body: raw.join("\n"),
      contentType: "text/plain",
    });
    expect(
      raw.some((line) => line.includes("vk.com")),
      "the vk embed should talk to the parent at all once js_api=1 rides the src",
    ).toBe(true);
  });

  test("006 EARS-18.3: a cdnvideo stream renders no room-owned element over the embed — at mount and after 40 s", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await provisionLoggedInDoctor(page);
    await enterRoom(page, SLUG_CDNVIDEO);

    // A structurally silent provider gives the room no signal to reason from, so
    // the room says nothing at all: the bare provider iframe is the whole surface
    // from mount onward (owner decision on #1929).
    const player = page.getByTestId("room-player-cdnvideo");
    await expect(player).toBeVisible();
    const srcAtMount = await player.getAttribute("src");
    expect(srcAtMount, "the cdnvideo embed carries a src").toBeTruthy();
    await expectNoRoomOwnedControl(page);

    // …and it is still saying nothing well past the watchdog budget: no deferred
    // advisory, no time box, and no re-mount of the embed behind one.
    await page.waitForTimeout(CDNVIDEO_DWELL_MS);
    await expect(player).toBeVisible();
    await expectNoRoomOwnedControl(page);
    await expect(player).toHaveAttribute("src", srcAtMount!);

    await page.screenshot({
      path: evidencePath("cdnvideo-nothing-rendered.png"),
    });
  });
});
