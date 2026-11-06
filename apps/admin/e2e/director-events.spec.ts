import { Buffer } from "node:buffer";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  bootstrapDirectorAccount,
  chooseEventClassification,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { evidenceShot } from "./support/evidence-shot";

/**
 * 049 EARS-8 — the broadcast director's admin is «Мероприятия», driven against
 * the real admin → api → Postgres → Zitadel chain (V-8, V-9). A real Zitadel
 * account holding only `broadcast_director` signs in, lands on the event list,
 * creates an event through the 007 form, configures its stream, publishes it,
 * opens and closes the room; every other admin route shows the refusal page.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REFUSAL = "У этой учётной записи нет доступа к этому разделу.";
const RUTUBE_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

/** Every link the admin chrome draws — the nav is the only link group in the header. */
function headerLinks(page: Page) {
  return page.locator("header a");
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

/** A `datetime-local` value for the МСК wall clock `offsetMs` from now. */
function mskInput(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

test.describe.configure({ mode: "serial" });

test.describe("049 EARS-8 — the broadcast director's admin is «Мероприятия»", () => {
  test("049 EARS-8: a director lands on the event list, creates an event, configures the stream, publishes, opens and closes the room", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const director = await bootstrapDirectorAccount(ADMIN_ORIGIN);

    // Every sign-in lands on the event list — the director's own first link.
    await signInAsAdmin(page, director);
    await page.waitForURL(/\/events$/);
    await expect(page.getByTestId("access-refused")).toHaveCount(0);
    await expect(headerLinks(page)).toHaveCount(1);
    await expect(page.getByTestId("nav-events")).toHaveText("Мероприятия");
    expect(await axeViolations(page), "axe on the event list").toEqual([]);
    await evidenceShot(page, "director-events-list");

    // The create form, without the «Архивный эфир» option.
    await page.goto("/events/create");
    await expect(page.getByTestId("event-form")).toBeVisible();
    await expect(page.getByTestId("legacy-toggle")).toHaveCount(0);
    await page.locator("#title").fill(`Эфир режиссёра ${Date.now()}`);
    await page.locator("#school").fill("Кардиология");
    // Inside the air window, so the room can be opened right away.
    await page.locator("#startsAtMsk").fill(mskInput(5 * 60 * 1000));
    await page.locator("#durationMin").fill("90");
    await page.locator("#venue").fill("Москва, тестовая площадка");
    await page.getByTestId("program-pdf").setInputFiles({
      name: "program.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
    });
    await chooseEventClassification(page);
    await page.getByTestId("submit-event").click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByTestId("access-refused")).toHaveCount(0);

    // The card offers no roster / intake / submissions links and no recordings.
    await expect(page.getByTestId("event-roster-link")).toHaveCount(0);
    await expect(page.getByTestId("event-congress-intake-link")).toHaveCount(0);
    await expect(page.getByTestId("event-submissions-link")).toHaveCount(0);
    await expect(page.getByTestId("tab-recordings")).toHaveCount(0);
    await expect(page.getByTestId("tab-experts")).toBeVisible();

    await page.getByTestId("provider").selectOption("rutube");
    await page.getByTestId("embed-ref").fill(RUTUBE_ID);
    await page.getByTestId("save-stream").click();
    await expect(page.getByTestId("stream-ok")).toBeVisible();

    for (const [action, state] of [
      ["action-publish", "state-published"],
      ["action-open", "state-live"],
      ["action-close", "state-ended"],
    ] as const) {
      await page.getByTestId(action).click();
      await expect(page.getByTestId(state)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("transition-error")).toHaveCount(0);
    }
    expect(await axeViolations(page), "axe on the event card").toEqual([]);
    await evidenceShot(page, "director-event-card");

    // Taking it off the storefronts is the director's command too.
    await page.getByTestId("action-hide").click();
    await expect(page.getByTestId("state-hidden")).toBeVisible({
      timeout: 20_000,
    });

    // Any other admin route shows the refusal page, the chrome unchanged.
    const eventId = new URL(page.url()).pathname.split("/").pop()!;
    for (const route of [
      "/projects",
      "/experts",
      "/access",
      `/events/${eventId}/roster`,
    ]) {
      await page.goto(route);
      await expect(page.getByTestId("access-refused")).toHaveText(REFUSAL);
      await expect(headerLinks(page)).toHaveCount(1);
      if (route === "/projects") await evidenceShot(page, "director-refusal");
    }

    // The refusal is a projection; the server is the authority.
    const statuses = await page.evaluate(async () => {
      const read = async (url: string) =>
        (
          await fetch(url, {
            credentials: "include",
            headers: { accept: "application/json" },
          })
        ).status;
      return {
        events: await read("/v1/admin/events"),
        materials: await read("/v1/admin/materials"),
      };
    });
    expect(statuses).toEqual({ events: 200, materials: 403 });
  });
});
