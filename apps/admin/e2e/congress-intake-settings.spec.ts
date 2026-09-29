import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createPublishedEvent } from "./support/congress-roster";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 046 EARS-2 / EARS-3 (#2432) — the platform administrator's congress intake
 * settings screen, driven against the real admin → api → Postgres chain (V-17,
 * the settings part). The event comes from the real 007 admin form; nothing is
 * mocked: every assertion on what was saved reads it back through
 * `GET /v1/admin/events/:id/congress-intake-settings`.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-intake-settings.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots of the approved non-canvas
 * route (Stage A «а», #2432): the defaults, saved and refused states at
 * 1440 and 390, light and dark.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The admin's dark palette is the `.dark` token block on the document root. */
async function setPalette(page: Page, palette: "light" | "dark") {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
  await page.waitForFunction((mode) => {
    const channels = getComputedStyle(document.body).backgroundColor.match(
      /[\d.]+/g,
    );
    if (!channels || channels.length < 3) return false;
    const [r, g, b] = channels.map(Number);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return mode === "dark" ? luminance < 128 : luminance >= 128;
  }, palette);
}

/** The state at both widths and both palettes; the page is left at 1440, light. */
async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  for (const [label, width] of [
    ["desktop", 1440],
    ["mobile", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const palette of ["light", "dark"] as const) {
      await setPalette(page, palette);
      // The controls fade their colours (`transition-colors`): a shot taken
      // mid-fade after a palette or width switch shows washed-out fields.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name}-${label}-${palette}.png`),
        fullPage: true,
      });
    }
  }
  await setPalette(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * The settings as the server holds them now — read in-page, like the admin's
 * own data provider, so the request carries the same session and device
 * headers the signed-in UI does (`eventSlugFromRoster`).
 */
async function readSettings(page: Page, eventId: string) {
  const read = await page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/events/${id}/congress-intake-settings`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }, eventId);
  expect(read.status, "intake settings read for the admin").toBe(200);
  return read.body as {
    configured: boolean;
    registrationUrl: string | null;
    firstAuthorCounts: boolean;
    kinds: Record<
      "oral" | "poster" | "abstract",
      {
        opensOn: string | null;
        lastDay: string | null;
        submitLimit: number | null;
        maxAgeYears: number | null;
      }
    >;
  };
}

test.describe.configure({ mode: "serial" });

test.describe("046 EARS-2 — the congress intake settings screen in admin", () => {
  let eventId = "";

  test("046 EARS-2: the administrator opens the screen from the event, finds the product defaults, saves, and the next read returns the saved settings", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-приём ${Date.now()}`);

    await page.getByTestId("event-congress-intake-link").click();
    await page.waitForURL(new RegExp(`/events/${eventId}/congress-intake$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Приём материалов Конгресса",
    );

    // EARS-2 — an event with no settings opens on the product defaults.
    await expect(page.getByTestId("congress-intake-defaults")).toBeVisible();
    await expect(page.getByTestId("intake-registrationUrl")).toHaveValue("");
    await expect(
      page.getByTestId("intake-firstAuthorCounts"),
    ).not.toBeChecked();
    // No congress-wide revision deadline: each submission's revision term is its own.
    await expect(page.getByText("Доработки принимаются до")).toHaveCount(0);
    for (const kind of ["oral", "poster", "abstract"]) {
      await expect(page.getByTestId(`intake-${kind}-opensOn`)).toHaveValue("");
      await expect(page.getByTestId(`intake-${kind}-lastDay`)).toHaveValue("");
    }
    await expect(page.getByTestId("intake-oral-submitLimit")).toHaveValue("");
    await expect(page.getByTestId("intake-poster-submitLimit")).toHaveValue("");
    await expect(page.getByTestId("intake-abstract-submitLimit")).toHaveValue(
      "3",
    );
    await expect(page.getByTestId("intake-oral-maxAgeYears")).toHaveValue("");
    await expect(page.getByTestId("intake-poster-maxAgeYears")).toHaveValue(
      "40",
    );
    await expect(page.getByTestId("intake-abstract-maxAgeYears")).toHaveValue(
      "",
    );
    expect((await readSettings(page, eventId)).configured).toBe(false);
    await shot(page, "intake-defaults");

    await page
      .getByTestId("intake-registrationUrl")
      .fill("https://orthobio.ru/congress/registration");
    // The switch is keyboard-operable: focus it and press Space.
    await page.getByTestId("intake-firstAuthorCounts").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("intake-firstAuthorCounts")).toBeChecked();
    await page.getByTestId("intake-oral-opensOn").fill("2027-02-01");
    await page.getByTestId("intake-oral-lastDay").fill("2027-02-28");
    await page.getByTestId("intake-oral-submitLimit").fill("2");
    await page.getByTestId("intake-poster-maxAgeYears").fill("35");

    // EARS-3 — a last day reads back as «до {дата} включительно».
    await expect(page.getByTestId("intake-kind-oral")).toContainText(
      "До 28.02.2027 включительно, по московскому времени.",
    );

    await page.getByTestId("intake-save").click();
    // The DS `Alert` leads with its tone glyph; the sentence is the copy.
    await expect(page.getByTestId("congress-intake-saved")).toContainText(
      "Настройки сохранены. Они действуют со следующего запроса.",
    );
    await expect(page.getByTestId("congress-intake-defaults")).toHaveCount(0);

    // The next read returns exactly what was entered (EARS-2: no release).
    const saved = await readSettings(page, eventId);
    expect(saved).toMatchObject({
      configured: true,
      registrationUrl: "https://orthobio.ru/congress/registration",
      firstAuthorCounts: true,
      kinds: {
        oral: {
          opensOn: "2027-02-01",
          lastDay: "2027-02-28",
          submitLimit: 2,
          maxAgeYears: null,
        },
        poster: {
          opensOn: null,
          lastDay: null,
          submitLimit: null,
          maxAgeYears: 35,
        },
        abstract: {
          opensOn: null,
          lastDay: null,
          submitLimit: 3,
          maxAgeYears: null,
        },
      },
    });
    await shot(page, "intake-saved");

    // A fresh load of the screen shows the saved settings, not the defaults.
    await page.reload();
    await expect(page.getByTestId("intake-oral-lastDay")).toHaveValue(
      "2027-02-28",
    );
    await expect(page.getByTestId("intake-poster-maxAgeYears")).toHaveValue(
      "35",
    );
    await expect(page.getByTestId("congress-intake-defaults")).toHaveCount(0);
  });

  test("046 EARS-2: a last day before the opening day is refused on that kind's last-day field, and nothing is saved", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    expect(eventId, "the first test creates the event").not.toBe("");
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    await page.goto(`/events/${eventId}/congress-intake`);
    await expect(page.getByTestId("intake-oral-lastDay")).toHaveValue(
      "2027-02-28",
    );
    const before = await readSettings(page, eventId);

    await page.getByTestId("intake-poster-opensOn").fill("2027-02-10");
    await page.getByTestId("intake-poster-lastDay").fill("2027-02-01");
    await page.getByTestId("intake-save").click();

    await expect(page.getByTestId("congress-intake-refused")).toContainText(
      "Настройки не сохранены: исправьте отмеченные поля.",
    );
    const lastDay = page.getByTestId("intake-poster-lastDay");
    await expect(lastDay).toHaveAttribute("aria-invalid", "true");
    await expect(lastDay).toBeFocused();
    await expect(page.getByTestId("intake-kind-poster")).toContainText(
      "Последний день приёма не может быть раньше даты открытия.",
    );
    await expect(page.getByTestId("congress-intake-saved")).toHaveCount(0);
    expect(await readSettings(page, eventId)).toEqual(before);
    await shot(page, "intake-refused");

    // Correcting the day and saving again clears the refusal.
    await lastDay.fill("2027-02-20");
    await page.getByTestId("intake-save").click();
    await expect(page.getByTestId("congress-intake-saved")).toBeVisible();
    await expect(lastDay).not.toHaveAttribute("aria-invalid", "true");
    expect((await readSettings(page, eventId)).kinds.poster).toMatchObject({
      opensOn: "2027-02-10",
      lastDay: "2027-02-20",
    });
  });
});
