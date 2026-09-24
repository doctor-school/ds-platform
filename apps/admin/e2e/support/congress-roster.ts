import { expect, type Browser, type Page } from "@playwright/test";
import { bootstrapDoctorSession } from "./admin-session";
import { ADMIN_ORIGIN } from "./sign-in";

/**
 * Seeding for the 044 roster specs, through the PRODUCTION writers only — no
 * database access, no fixture endpoint.
 *
 * The event is created and published through the real 007 admin form and
 * lifecycle bar. A roster row is written by the platform registration path
 * (EARS-16): a freshly registered doctor signs in, sets a display name and
 * registers for the published event. Such a row carries no congress answers, so
 * the roster renders it from the account's profile — ФИО from the display name,
 * the email from the account, every other cell empty.
 */

/** A `datetime-local` value for the МСК wall clock `offsetMs` from now. */
function mskInput(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

/** A real, PUBLISHED event through the admin create form + lifecycle bar; returns its id. */
export async function createPublishedEvent(
  page: Page,
  title: string,
): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill(mskInput(7 * 24 * 60 * 60 * 1000));
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const id = page.url().split("/").pop()!;

  await page.getByTestId("action-publish").click();
  await expect(page.getByTestId("state-published")).toBeVisible({
    timeout: 20_000,
  });
  return id;
}

/**
 * The event's public slug, read from the roster route itself with the signed-in
 * admin's session (the registration endpoint addresses an event by slug).
 */
export async function eventSlugFromRoster(
  page: Page,
  eventId: string,
): Promise<string> {
  // In-page, like the admin's own data provider: the browser's request carries
  // the same session and device headers the signed-in UI does.
  const read = await page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/events/${id}/roster`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return {
      status: res.status,
      slug: res.ok
        ? ((await res.json()) as { event: { slug: string } }).event.slug
        : "",
    };
  }, eventId);
  expect(read.status, "roster route for the admin").toBe(200);
  return read.slug;
}

/**
 * Register one doctor for the event through the platform path. Runs in its OWN
 * browser context, so the doctor's session never touches the admin's cookie jar.
 */
export async function registerDoctorThroughPlatform(
  browser: Browser,
  eventSlug: string,
  displayName: string,
): Promise<{ email: string }> {
  const { email, password } = await bootstrapDoctorSession(
    ADMIN_ORIGIN,
    "roster",
  );
  const context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    const outcome = await page.evaluate(
      async (input) => {
        const json = { "content-type": "application/json" };
        const login = await fetch("/v1/auth/login", {
          method: "POST",
          credentials: "include",
          headers: json,
          body: JSON.stringify({
            identifier: input.email,
            password: input.password,
          }),
        });
        if (!login.ok) return `login HTTP ${login.status}`;
        const named = await fetch("/v1/me/display-name", {
          method: "PUT",
          credentials: "include",
          headers: json,
          body: JSON.stringify({ displayName: input.displayName }),
        });
        if (!named.ok) return `display-name HTTP ${named.status}`;
        const registered = await fetch(
          `/v1/events/${encodeURIComponent(input.eventSlug)}/registration`,
          { method: "POST", credentials: "include" },
        );
        if (!registered.ok) return `registration HTTP ${registered.status}`;
        return "ok";
      },
      { email, password, displayName, eventSlug },
    );
    expect(outcome, `platform registration of ${email}`).toBe("ok");
  } finally {
    await context.close();
  }
  return { email };
}
