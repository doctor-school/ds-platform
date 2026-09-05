import { test, expect, type Page } from "@playwright/test";
import { loginAsDoctor, DOCTOR_BASE } from "./support/doctor-session";
import {
  requireLiveStandEnv,
  requireShortHeartbeat,
} from "./support/live-stand-env";

/**
 * 006 · 020 §6.1 (#1912, #1722 slice 4) — the DOCTOR host's live-stand room tier
 * for `doctor.school/events/:slug/room`.
 *
 * Slice 3 mounted the shared `@ds/room` unit on this host behind this host's own
 * route table, copy and chrome cluster. Unit and component tests pin those pieces
 * in isolation; what only a REAL stand can prove is that the mount composes end to
 * end — that the server-side EARS-1 grant admits a registered doctor over the
 * doctor origin's own `__Host-ds_session`, that the provider enum reaches the
 * rendered embed, that the presence loop actually beats, that the EARS-6 refusals
 * land on THIS host's targets (never an academy login, which does not exist here —
 * ADR-0015 §4 REQ-24 / 020 §6.1 D10), and that the room renders WITHOUT the
 * storefront shell.
 *
 * The academy twin is `apps/portal/e2e/room.spec.ts`. This file is not a copy of
 * it: the routes, the chrome and — above all — the way a session is minted differ,
 * because doctor.school ships no login form (`support/doctor-session.ts` explains
 * the same-origin BFF login it uses instead).
 *
 * Live-stand-gated tier: it needs the BUILT doctor app whose `/v1/*` rewrite
 * reaches a running api + Postgres seeded with the 006 live rooms and their stream
 * configs, plus a doctor already registered for them. It is inert-green only on a
 * BARE environment; a partially exported env set fails loudly (#1871 gate, twinned
 * here as `support/live-stand-env.ts`).
 *
 * ENV SET — export ALL of these to run this spec; exporting SOME of them fails
 * loudly naming the missing ones, while a completely bare environment stays
 * inert-green:
 *
 * | variable                     | value on the dev stand                      |
 * | ---------------------------- | ------------------------------------------- |
 * | `E2E_DOCTOR_URL`             | the running doctor storefront origin        |
 * | `E2E_DOCTOR_EMAIL`           | a doctor registered for the seeded rooms    |
 * | `E2E_DOCTOR_PASSWORD`        | that doctor's password                      |
 * | `E2E_ROOM_SLUG_YOUTUBE`      | `seed-006-room-youtube`                     |
 * | `E2E_ROOM_SLUG_RUTUBE`       | `seed-006-room-rutube`                      |
 * | `E2E_ROOM_SLUG_UNAVAILABLE`  | `seed-006-room-unavailable`                 |
 * | `E2E_ROOM_SLUG_NOT_LIVE`     | `seed-005-upcoming`                         |
 * | `E2E_ROOM_HEARTBEAT_SECONDS` | the api's cadence, at most 10 (see below)   |
 * | `IDP_ISSUER`                 | the real Zitadel issuer                     |
 * | `MAILPIT_URL`                | the Mailpit REST base (OTP sink)            |
 *
 * API PRECONDITION: the api under test MUST be booted with
 * `ROOM_HEARTBEAT_INTERVAL_SECONDS=2` (its default is 60). EARS-4 waits multiples
 * of the cadence, so the default pushes it past the Playwright timeout;
 * `E2E_ROOM_HEARTBEAT_SECONDS` must MIRROR the api value and is capped at 10 — a
 * larger value fails loudly by name instead of timing out.
 *
 * DOCTOR PROVISIONING: this host mints its session through the api, not through a
 * form (`support/doctor-session.ts` carries the one-time recipe: register → Mailpit
 * OTP verify → save a display name → register for each seeded event). Self-signup
 * throttles after ~4-5 attempts per window (429): mint ONE reusable pair.
 *
 * STAND PRECONDITIONS — beyond the variables above, the STAND itself must be
 * prepared; otherwise the tier fails against a CORRECT product render:
 *
 * - **Saved display name.** The reusable account must already have a display name
 *   saved. Without one, 006 EARS-14's JIT name prompt renders INSTEAD of the room
 *   composition and every in-room assertion fails. Unlike the academy specs, no
 *   spec here can satisfy the prompt inline: this tier never self-signs-up.
 * - **Raised rate-limit ceilings.** Boot the api with
 *   `RATE_LIMIT_PER_USER_15MIN=1000`, `RATE_LIMIT_PER_IP_15MIN=2000` and
 *   `RATE_LIMIT_PER_ASN_1H=5000`. The 003 EARS-13 defaults (10 per user per
 *   15 min, 20 per IP) are far below the logins one serial run drives from a
 *   single IP: at the defaults the suite hard-429s mid-run. These ceilings are
 *   env-overridable BY DESIGN for exactly this window (#1076).
 */

const SLUG_YOUTUBE = process.env.E2E_ROOM_SLUG_YOUTUBE;
const SLUG_RUTUBE = process.env.E2E_ROOM_SLUG_RUTUBE;
const SLUG_UNAVAILABLE = process.env.E2E_ROOM_SLUG_UNAVAILABLE;
const SLUG_NOT_LIVE = process.env.E2E_ROOM_SLUG_NOT_LIVE;

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_ROOM_SLUG_YOUTUBE",
  "E2E_ROOM_SLUG_RUTUBE",
  "E2E_ROOM_SLUG_UNAVAILABLE",
  "E2E_ROOM_SLUG_NOT_LIVE",
  "E2E_ROOM_HEARTBEAT_SECONDS",
  "IDP_ISSUER",
  "MAILPIT_URL",
]);
const HEARTBEAT_SECONDS = requireShortHeartbeat();

/** Enter the gated room of `slug` as the reusable doctor. */
async function enterRoom(page: Page, slug: string): Promise<void> {
  await loginAsDoctor(page);
  await page.goto(`${DOCTOR_BASE}/events/${slug}/room`, {
    waitUntil: "domcontentloaded",
  });
  // The stand precondition is a SAVED display name — if the JIT prompt renders,
  // the account was provisioned without one and every assertion below would fail
  // for the wrong reason. Name that cause here instead.
  await expect(
    page.getByTestId("display-name-prompt"),
    "the reusable doctor must already have a saved display name (STAND PRECONDITIONS)",
  ).toHaveCount(0);
}

// The leading `006 EARS-2 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-2 doctor-host room composition + embed player from the provider enum (e2e)", () => {
  test("006 EARS-2: the doctor host renders the YouTube embed frame + the chat aside composition", async ({
    page,
  }) => {
    await enterRoom(page, SLUG_YOUTUBE!);

    const player = page.getByTestId("room-player-youtube");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute("src", /youtube\.com\/embed\//);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);

    await expect(page.getByTestId("room-chat").first()).toBeVisible();
    await expect(page.getByTestId("room-context-strip")).toBeVisible();
  });

  test("006 EARS-2: the doctor host renders the Rutube embed frame from the enum", async ({
    page,
  }) => {
    await enterRoom(page, SLUG_RUTUBE!);

    // A DIFFERENT provider rendering a DIFFERENT frame is what proves the player
    // is keyed on the enum rather than sniffed from a URL.
    const player = page.getByTestId("room-player-rutube");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute("src", /rutube\.ru\/play\/embed\//);
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
  });

  test("006 EARS-2: an unconfigured provider renders the truthful stream-unavailable state, not a guessed embed", async ({
    page,
  }) => {
    await enterRoom(page, SLUG_UNAVAILABLE!);

    await expect(page.getByTestId("room-player-unavailable")).toBeVisible();
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
  });
});

// The leading `006 EARS-4 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-4 server-authoritative heartbeat presence on the doctor host (e2e)", () => {
  test("006 EARS-4: the doctor-host room fires an authenticated heartbeat on the N-second cadence with no doctor action", async ({
    page,
  }) => {
    let beats = 0;
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/v1\/events\/[^/]+\/heartbeat$/.test(req.url())
      ) {
        beats += 1;
      }
    });

    await enterRoom(page, SLUG_YOUTUBE!);

    // NO doctor action — beats fire from mount purely on the timer. Over ~3
    // intervals a visible tab must fire more than one beat (an immediate beat on
    // mount + at least one on the N-second grid), proving the cadence rather than
    // a single one-shot ping. The beats travel the doctor origin's own `/v1/*`
    // rewrite, so this also proves the session cookie is carried by the room's
    // client transport on THIS host.
    await page.waitForTimeout(HEARTBEAT_SECONDS * 3200);
    expect(beats).toBeGreaterThanOrEqual(2);
  });
});

// The leading `006 EARS-6 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-6 denied-access routing on the doctor host (no academy login)", () => {
  test("006 EARS-6.1: an unauthenticated visitor is routed to THIS host's event page and never to a login URL", async ({
    page,
  }) => {
    // The whole navigation trail is recorded: D10's contract is not merely "where
    // the visitor ends up" but that no login URL is ever reached — a redirect that
    // bounced through one and back would satisfy a landing-URL assertion alone.
    const trail: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) trail.push(frame.url());
    });

    await page.goto(`${DOCTOR_BASE}/events/${SLUG_YOUTUBE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // The server page redirects BEFORE any upstream read (D16a) to this host's
    // own event page — the honest next step, where the participation card lives.
    await expect(page).toHaveURL(
      new RegExp(`/events/${SLUG_YOUTUBE}(?:$|[?#])`),
    );
    expect(
      trail.filter((url) => /\/login(?:$|[/?#])/.test(url)),
      `no login URL may appear in the trail (D10) — trail: ${trail.join(" -> ")}`,
    ).toEqual([]);

    // No soft wall: nothing of the room composition renders on the refusal.
    await expect(page.getByTestId("room-context-strip")).toHaveCount(0);
    await expect(page.getByTestId("room-chat")).toHaveCount(0);
  });

  test("006 EARS-6.2: a registered doctor reaching the room of a NOT-live event lands on the truthful event page, no watchable room", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto(`${DOCTOR_BASE}/events/${SLUG_NOT_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // The `notLive` refusal carries NO `?from=room` marker — that provenance
    // belongs to the register bounce alone (020 §6.1).
    await expect(page).toHaveURL(new RegExp(`/events/${SLUG_NOT_LIVE}$`));
    await expect(page.getByTestId("room-context-strip")).toHaveCount(0);
    await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("room-chat")).toHaveCount(0);
  });
});

// The leading `006 EARS-11 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-11 the doctor room renders outside the storefront shell", () => {
  test("006 EARS-11: the room route mounts no storefront header/footer and the document does not scroll", async ({
    page,
  }) => {
    await enterRoom(page, SLUG_YOUTUBE!);

    // The `(room)` route group is deliberately OUTSIDE `(storefront)`: the room is
    // a full-height surface, and the storefront chrome (017 EARS-1 landmarks,
    // pinned by `shell.spec.ts`) must not appear over it.
    await expect(page.getByTestId("storefront-header")).toHaveCount(0);
    await expect(page.getByTestId("storefront-footer")).toHaveCount(0);
    await expect(page.getByTestId("shell-action-cluster")).toHaveCount(0);

    // Full-height composition: the room fits its viewport rather than extending
    // the document into a page scroll.
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollHeight - root.clientHeight;
    });
    expect(
      overflow,
      "the room document must not scroll vertically",
    ).toBeLessThanOrEqual(0);
  });
});

// The leading `006 EARS-12 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-12 the room header carries this host's theme toggle", () => {
  test("006 EARS-12: the room header mounts the storefront theme toggle and it flips the dark class", async ({
    page,
  }) => {
    await enterRoom(page, SLUG_YOUTUBE!);

    // The SAME control the storefront header mounts (`shell.spec.ts` pins it
    // there), injected into the shared room header's one host slot — so the room's
    // header cannot drift from the storefront's.
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    const isDark = () =>
      page.evaluate(() => document.documentElement.classList.contains("dark"));
    const before = await isDark();
    await toggle.click();
    await expect.poll(isDark).toBe(!before);
  });
});
