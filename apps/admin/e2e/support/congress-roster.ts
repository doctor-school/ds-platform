import { expect, type Browser, type Page } from "@playwright/test";
import { ADMIN_ORIGIN, bootstrapDoctorSession } from "@ds/e2e/admin-events";

/**
 * Seeding for the 044 roster specs, through the PRODUCTION writers only — no
 * database access, no fixture endpoint.
 *
 * The event is created and published through the real 007 admin form and
 * lifecycle bar (`createPublishedEvent`, `@ds/e2e/admin-events`). A roster row
 * is written by the platform registration path (EARS-16): a freshly registered
 * doctor signs in, sets a display name and registers for the published event. Such a row carries no congress answers, so
 * the roster renders it from the account's profile — ФИО from the display name,
 * the email from the account, every other cell empty.
 */

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

/**
 * 044 EARS-35 — one walk-in through the registrar's desk entry panel on the
 * roster screen (the production desk route; origin `desk`, paper consent).
 * The phone is typed as given, so two entries can carry one phone in two
 * spellings (EARS-29/30 — the «возможный дубль» pair). Returns the desk
 * route's answer status (`accepted` / `existing`).
 */
export async function addDeskParticipant(
  page: Page,
  person: {
    surname: string;
    firstName: string;
    patronymic: string;
    email: string;
    phone: string;
  },
): Promise<"accepted" | "existing"> {
  await page.getByTestId("desk-entry-open").click();
  const panel = page.getByTestId("desk-entry-panel");
  await panel.getByTestId("desk-surname").fill(person.surname);
  await panel.getByTestId("desk-firstName").fill(person.firstName);
  await panel.getByTestId("desk-patronymic").fill(person.patronymic);
  await panel.getByTestId("desk-email").fill(person.email);
  await panel.getByTestId("desk-contactPhone").fill(person.phone);
  await page.getByTestId("desk-specialtyId").click();
  await page.getByRole("listbox").getByRole("option").first().click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await panel.getByTestId("desk-workplace").fill("ГКБ №1");
  await page.getByTestId("desk-city").click();
  await page
    .getByRole("combobox", { name: "Поиск населённого пункта", exact: true })
    .fill("Химки");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /^Химки/ })
    .first()
    .click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const consent = panel.getByTestId("desk-paperConsent");
  await consent.locator("xpath=ancestor::label[1]").click();
  await expect(consent).toBeChecked();
  const answered = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/v1\/admin\/events\/[^/]+\/registrations$/.test(
        new URL(res.url()).pathname,
      ),
  );
  await panel.getByTestId("desk-entry-submit").click();
  const res = await answered;
  expect(res.status(), "desk entry answered").toBeLessThan(300);
  const { status } = (await res.json()) as { status: "accepted" | "existing" };
  if (status === "accepted") await expect(panel).toHaveCount(0);
  return status;
}
