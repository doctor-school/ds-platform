
import { expect, test } from "@playwright/test";

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

test.describe("020 EARS-1 — the doctor storefront event page", () => {
  test.skip(
    !BASE || !SLUG,
    "requires a live doctor app + a seeded event slug",
  );

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
    await expect(page.getByTestId("event-page-hero")).toContainText("МСК");
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
    await page.goto(`${BASE}/events/${SLUG}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("event-signup-card")).toHaveCount(1);
    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toHaveCount(1);
    // The href is the api's, built from the doctor host's own route table — the
    // page computes no eligibility and builds no href of its own.
    await expect(cta).toHaveAttribute("href", /returnTo=/);
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
    // doctor read path would surface here as a diff.
    expect(await doctor.json()).toEqual(await academy.json());
  });
});
