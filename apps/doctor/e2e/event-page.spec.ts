import { withoutPresignNonces } from "@ds/e2e";
import { submitSignInHostForm } from "@ds/e2e/sign-in";
import { expect, test, type Page } from "@playwright/test";

/**
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — `doctor.school/events/:slug`.
 *
 * The doctor storefront mounts the SAME event page the academy does: one read
 * model (`EventPageView`), one composition (the slice-2 blocks), one CTA policy
 * (server-resolved). This tier pins the guest subset of
 * `020-scenarios.feature` L26–46 on THIS host, plus the L102–109 cross-host
 * identity row: the two storefronts must answer with content-identical public
 * bodies and differ only in header, route envelope and copy defaults.
 *
 * Live-stand-gated: it needs a running doctor app whose `/v1/*` reads reach a
 * running api + Postgres seeded with a `published` event, and (for the identity
 * row) the api itself. The import-scan test below is a pure source scan and runs
 * unconditionally — it is the structural half of EARS-18 and needs no stand.
 */

const BASE = process.env.E2E_DOCTOR_URL;
const API = process.env.E2E_API_URL;
const SLUG = process.env.E2E_WEBINAR_SLUG;

// Gate row 30 (D9, 004 «Amendment — 2026-10-02»): the browser runs in Asia/Yekaterinburg.
// After hydration an online or hybrid event states its time in that zone with
// its label; an offline event stays МСК. The server bytes stay МСК.
async function expectedZoneLabel(page: Page): Promise<string> {
  const kicker =
    (await page.getByTestId("event-page-kicker").textContent()) ?? "";
  return /Очно/u.test(kicker) ? "МСК" : "GMT+5";
}

test.describe("020 EARS-1 — the doctor storefront event page", () => {
  test.use({ timezoneId: "Asia/Yekaterinburg" });
  test.skip(!BASE || !SLUG, "requires a live doctor app + a seeded event slug");

  test("020 EARS-1: a guest reads the whole event server-side on doctor.school, composed from the shared blocks", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const response = await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId("event-page-shell")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("event-page-hero")).toContainText(
      `(${await expectedZoneLabel(page)})`,
    );
    await expect(page.getByTestId("event-page-hero-chips")).toBeVisible();
    await expect(page.getByTestId("event-about")).toBeVisible();
    await expect(page.getByTestId("event-speaker-card").first()).toBeVisible();

    // 017's shell owns the header; the route envelope owns the breadcrumb back
    // to the 019 feed. Nothing was added to the header for this route.
    await expect(page.getByTestId("event-page-hero-breadcrumb")).toContainText(
      "События",
    );

    await expect(page.locator("body")).not.toContainText(
      /авторизуйтесь|войдите для просмотра/i,
    );
  });

  test("020 EARS-1: the doctor page carries exactly one primary «Участвовать» CTA, resolved by the server against THIS host's routes", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("event-signup-card")).toHaveCount(1);
    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toHaveCount(1);
    // The href is the api's, built from the doctor host's own route table — the
    // page computes no eligibility and builds no href of its own.
    await expect(cta).toHaveAttribute("href", /returnTo=/);
  });

  test("020 EARS-4: the right column holds exactly one card, the CTA is the only participation control, and «Ведёт» sits in the open part", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // One column, one card: the aside carries the sign-up card and nothing
    // else. EARS-4 adds data to that card's conditions line — never a second
    // card, never a parallel participation surface.
    const asideChildren = page.locator('[data-testid="event-page-aside"] > *');
    await expect(asideChildren).toHaveCount(1);
    await expect(asideChildren.first()).toHaveAttribute(
      "data-testid",
      "event-signup-card",
    );

    // «Ведёт» belongs to the open part, not the aside: every speaker card on
    // the page is inside `event-page-open-part`.
    const speakers = page.getByTestId("event-speaker-card");
    const speakerCount = await speakers.count();
    expect(speakerCount).toBeGreaterThanOrEqual(1);
    await expect(
      page.locator(
        '[data-testid="event-page-open-part"] [data-testid="event-speaker-card"]',
      ),
    ).toHaveCount(speakerCount);

    // Exactly one participation control page-wide, and no commerce copy that
    // would imply a second path (buy / request / download).
    await expect(page.getByRole("link", { name: /Участвовать/ })).toHaveCount(
      1,
    );
    await expect(page.getByRole("button", { name: /Участвовать/ })).toHaveCount(
      0,
    );
    await expect(page.locator("body")).not.toContainText(
      /купить|оставить заявку|скачать/i,
    );
  });

  test("020 EARS-1: the doctor page is complete HTML from the server (no client gate)", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/events/${SLUG}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("МСК");
    expect(html).toContain("О чём событие");
  });
});

test.describe("020 EARS-1 / EARS-18 — cross-host identity", () => {
  test("020 EARS-1: the two storefronts render the same event from one core — the public bodies are content-identical", async ({
    request,
  }) => {
    test.skip(!API || !SLUG, "requires the api and a seeded event slug");

    const [academy, doctor] = await Promise.all([
      request.get(`${API}/v1/public/events/${SLUG}`),
      request.get(`${API}/v1/storefront/doctor/events/${SLUG}`),
    ]);
    expect(academy.status()).toBe(200);
    expect(doctor.status()).toBe(200);

    // Deep equality, not a field spot-check: a second projection anywhere in the
    // doctor read path would surface here as a diff. A speaker photo is a
    // presigned object-storage URL minted per request, so two reads a second
    // apart carry a different signing instant and signature (#3521); those
    // request nonces are blanked, every other byte — the object key included —
    // must still match.
    const body = async (res: typeof academy) =>
      JSON.parse(withoutPresignNonces(await res.text())) as unknown;
    expect(await body(doctor)).toEqual(await body(academy));
  });
});

const BOTH_CUTS = process.env.E2E_DOCTOR_RECORDING_BOTH_CUTS_SLUG;
const EDITED_ONLY = process.env.E2E_WEBINAR_SLUG_ENDED;
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
// The playable montage from the golden both-cuts fixture (#4119).
const MONTAGE_ID = "1766d2bce7049428166252d02a41f8da";
const RUTUBE_ORIGIN = "https://rutube.ru";

function observeRutubeRecording({
  origin,
  videoId,
}: {
  origin: string;
  videoId: string;
}) {
  if (window !== window.top) return;
  window.addEventListener("message", (event) => {
    if (event.origin !== origin) return;
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[data-testid="recording-player-rutube"]',
    );
    if (!frame || event.source !== frame.contentWindow) return;

    // The RuTube embed API reports distinct content and ad events.
    // https://rutube.ru/info/embed/
    let message: {
      type?: string;
      data?: { videoId?: string; video_id?: string; time?: number };
    } | null;
    try {
      message =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (message?.type === "player:ready" && message.data?.videoId === videoId) {
      frame.dataset.e2eRecordingReady = videoId;
    }
    if (
      message?.type === "player:playStart" &&
      message.data?.video_id === videoId
    ) {
      frame.dataset.e2eRecordingStarted = videoId;
    }
    if (
      frame.dataset.e2eRecordingStarted === videoId &&
      message?.type === "player:currentTime" &&
      typeof message.data?.time === "number" &&
      message.data.time > 0
    ) {
      frame.dataset.e2eRecordingPlaying = videoId;
    }
  });
}

test("014 EARS-6/8: a doctor returns to the past event, plays the montage and opens the original", async ({
  page,
  context,
}) => {
  test.skip(
    !BASE || !BOTH_CUTS || !EDITED_ONLY || !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
    "requires the live doctor storefront, two ended event shapes and a doctor account",
  );
  test.setTimeout(90_000);

  const eventPath = `/events/${BOTH_CUTS}`;
  const eventUrl = new URL(eventPath, BASE);
  const gate = page.getByTestId("recording-gate");
  const signIn = page.getByTestId("recording-gate-signin");
  const spoiler = page.getByTestId("recording-spoiler");
  const frames = page
    .locator("iframe")
    .and(page.getByTestId(/^recording-player-/));

  await context.clearCookies();
  // Subscribe before hydration mounts the cross-origin iframe after sign-in.
  await page.addInitScript(observeRutubeRecording, {
    origin: RUTUBE_ORIGIN,
    videoId: MONTAGE_ID,
  });
  const response = await page.goto(eventUrl.href, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  await expect(gate).toBeVisible();
  await expect(frames).toHaveCount(0);
  await expect(spoiler).toHaveCount(0);

  const encoded = encodeURIComponent(eventPath);
  await expect(signIn).toHaveAttribute("href", `/login?returnTo=${encoded}`);
  await expect(page.getByTestId("recording-gate-signup")).toHaveAttribute(
    "href",
    `/register?returnTo=${encoded}`,
  );
  await signIn.click();
  await submitSignInHostForm(
    page,
    { loginPath: "/login" },
    { email: DOCTOR_EMAIL!, password: DOCTOR_PASSWORD! },
    eventUrl.origin,
  );
  // The callback's redirect ends in an empty `#` that strips any fragment the
  // IdP left (storefront-oidc), so the landing is compared without it.
  await expect(page).toHaveURL(
    (url) =>
      url.origin === eventUrl.origin &&
      url.pathname === eventPath &&
      url.search === "",
  );
  await expect(gate).toHaveCount(0);

  await expect(frames).toHaveCount(1);
  const montage = page.getByTestId("recording-player-rutube");
  const rutubeEmbed =
    /^https:\/\/rutube\.ru\/play\/embed\/[\da-f]{32}\/?(?:\?.*)?$/;
  await expect(montage).toBeVisible();
  await expect(montage).toHaveAttribute("title", / — Монтаж$/);
  await expect(montage).toHaveAttribute(
    "src",
    `${RUTUBE_ORIGIN}/play/embed/${MONTAGE_ID}`,
  );
  const montageSrc = await montage.getAttribute("src");

  const summary = spoiler.locator("summary");
  await expect(
    summary.getByText("Смотреть оригинал трансляции", { exact: true }),
  ).toBeVisible();
  await expect(spoiler).not.toHaveAttribute("open");
  await expect(spoiler.locator("iframe")).toHaveCount(0);

  // Use RuTube's published embed controls, then prove content progress from
  // this iframe and a presented frame on the montage's own media timeline.
  await expect(montage).toHaveAttribute(
    "data-e2e-recording-ready",
    MONTAGE_ID,
    {
      timeout: 20_000,
    },
  );
  await montage.evaluate((frame: HTMLIFrameElement, origin) => {
    frame.contentWindow!.postMessage(
      JSON.stringify({ type: "player:mute", data: {} }),
      origin,
    );
    frame.contentWindow!.postMessage(
      JSON.stringify({ type: "player:play", data: {} }),
      origin,
    );
  }, RUTUBE_ORIGIN);
  await expect(montage).toHaveAttribute(
    "data-e2e-recording-playing",
    MONTAGE_ID,
    {
      timeout: 30_000,
    },
  );
  const presented = await montage
    .contentFrame()
    .getByTestId("video")
    .evaluate(
      (video: HTMLVideoElement) => {
        return new Promise<{ mediaTime: number; duration: number }>(
          (resolve, reject) => {
            const timeout = window.setTimeout(() => {
              video.cancelVideoFrameCallback(frame);
              reject(new Error("RuTube did not present a playing video frame"));
            }, 10_000);
            const frame = video.requestVideoFrameCallback((_now, metadata) => {
              window.clearTimeout(timeout);
              resolve({
                mediaTime: metadata.mediaTime,
                duration: video.duration,
              });
            });
          },
        );
      },
      undefined,
      { timeout: 10_000 },
    );
  expect(presented.mediaTime).toBeGreaterThan(0);
  expect(Math.round(presented.duration)).toBe(20);

  await summary.press("Enter");
  await expect(spoiler).toHaveAttribute("open", "");
  await expect(frames).toHaveCount(2);
  const original = spoiler.getByTestId("recording-player-rutube");
  await expect(original).toBeVisible();
  await expect(original).toHaveAttribute("title", / — Оригинал$/);
  await expect(original).toHaveAttribute("src", rutubeEmbed);
  const originalSrc = await original.getAttribute("src");
  expect(new URL(originalSrc!).pathname).not.toBe(
    new URL(montageSrc!).pathname,
  );
  expect(await frames.first().getAttribute("src")).toBe(montageSrc);
  await summary.press("Enter");
  await expect(spoiler).not.toHaveAttribute("open");
  await expect(frames).toHaveCount(1);

  await page.goto(new URL(`/events/${EDITED_ONLY}`, BASE).href, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("recording-meta")).toContainText("Монтаж");
  await expect(gate).toHaveCount(0);
  await expect(spoiler).toHaveCount(0);
});
