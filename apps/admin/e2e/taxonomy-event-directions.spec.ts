import { expect, test, type Page } from "@playwright/test";
import {
  searchRelationshipCombobox,
  selectRelationshipCombobox,
} from "./support/relationship-combobox";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 012 EARS-11 (#1293), browser half — the REAL Refine → NestJS → Postgres path
 * for the event↔direction relationship editor and the §3.1 preview→confirm gate.
 *
 * `apps/api/test/taxonomy/event-directions.e2e-spec.ts` proves the contract against
 * the API. This proves the OPERATOR-facing arc, which no API test can: that the
 * picker offers only directions the catalogue ALREADY holds (no inline creation),
 * that the confirmation dialog shows the affected rows BEFORE the transition
 * fires, that a stale envelope RELOADS the preview instead of retrying behind
 * the operator's back, that a retired link comes back as the SAME row — and
 * that the event's own `specialties` field is byte-for-byte untouched by the
 * whole arc (the EARS-11 axis fence: directions and specialties are two axes, and
 * the relationship editor must never write the other one).
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec. Run
 * against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-event-directions.spec.ts --config=playwright.flows.config.ts
 */

/** A real direction row authored through the current catalogue; returns its title. */
async function createDirection(page: Page, title: string): Promise<string> {
  await page.goto("/directions/create");
  await page.getByTestId("direction-form").waitFor({ state: "visible" });
  await page.getByTestId("direction-title").fill(title);
  await page.getByTestId("submit-direction").click();
  await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return title;
}

/** The `specialties` value an event is created with — the axis fence's subject. */
const SPECIALTIES = "кардиология, терапия";

/** A real event row carrying specialties; returns its detail URL. */
async function createEvent(page: Page, title: string): Promise<string> {
  await page.goto("/events/create");
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#specialties").fill(SPECIALTIES);
  await page.locator("#startsAtMsk").fill("2026-07-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url();
}

/** Open the «Направления» tab of an event detail and wait for the panel. */
async function openDirectionsTab(page: Page, eventUrl: string): Promise<void> {
  await page.goto(eventUrl);
  await page.getByTestId("tab-directions").click();
  await page.getByTestId("event-directions-panel").waitFor({ state: "visible" });
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-11 — event↔direction relationships in the live admin", () => {
  test("EARS-22: an operator authors an event↔direction link from the direction endpoint through the same relationship panel", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const eventTitle = `Обратный эфир направления ${stamp}`;
    await createDirection(page, `Обратное направление ${stamp}`);
    const directionUrl = page.url();
    await createEvent(page, eventTitle);

    await page.goto(directionUrl);
    await page.getByTestId("tab-events").click();
    await selectRelationshipCombobox(
      page,
      "event-direction-link-combobox",
      eventTitle,
      eventTitle,
    );
    await page.getByTestId("event-direction-link-submit").click();

    await expect(page.getByTestId("event-directions-notice")).toContainText(
      "Связь добавлена.",
    );
    await expect(page.getByTestId("event-directions-panel")).toContainText(
      eventTitle,
    );
  });

  test("012 EARS-11: an operator files an event under an existing direction, retires the link through the impact preview and restores it", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const directionA = await createDirection(
      page,
      `Связи направление A ${stamp}`,
    );
    const directionB = await createDirection(
      page,
      `Связи направление B ${stamp}`,
    );
    const eventUrl = await createEvent(page, `Связи направлений эфир ${stamp}`);

    // ── The tab starts empty and says so ───────────────────────────────────
    await openDirectionsTab(page, eventUrl);
    await expect(page.getByTestId("event-directions-empty")).toBeVisible();
    await expect(page.getByTestId("event-directions-panel")).toContainText(
      "Связи не удаляются",
    );

    // ── EARS-11: the picker offers EXISTING directions only ────────────────
    // A title that names no catalogue row yields no options and no way to
    // create one from here — a direction invented mid-link would enter the
    // taxonomy without ever passing the direction form.
    const missingDirectionPanel = await searchRelationshipCombobox(
      page,
      "event-direction-link-combobox",
      `Несуществующее направление ${stamp}`,
    );
    await expect(
      missingDirectionPanel.getByText(/Подходящих направлений/),
    ).toBeVisible();
    await expect(page.getByTestId("event-direction-link-form")).not.toContainText(
      "Создать",
    );

    // ── Add a link through the searchable selector ─────────────────────────
    // The search narrows SERVER-SIDE (`?q=`), so the option list is the API's
    // answer, not a client-side filter over one page of rows.
    const directionPanel = await searchRelationshipCombobox(
      page,
      "event-direction-link-combobox",
      directionA,
    );
    await expect(
      directionPanel.getByText(directionA, { exact: true }),
    ).toHaveCount(1);
    await directionPanel.getByText(directionA, { exact: true }).click();
    await page.getByTestId("event-direction-link-submit").click();
    await expect(page.getByTestId("event-directions-notice")).toContainText(
      "Связь добавлена.",
    );
    await expect(page.getByTestId("event-directions-panel")).toContainText(
      directionA,
    );
    // An already-linked direction is no longer offerable: a choice that could only
    // ever come back 409 is not a choice.
    const linkedDirectionPanel = await searchRelationshipCombobox(
      page,
      "event-direction-link-combobox",
      directionA,
    );
    await expect(
      linkedDirectionPanel.getByText(/Подходящих направлений/),
    ).toBeVisible();

    // ── The duplicate-pair refusal, reached the way it really happens ───────
    // Two operators on the same event: this tab's picker still offers direction B
    // while the other tab links it. The stale choice must produce the RU
    // sentence that names the retained-row remedy, not a generic failure.
    await selectRelationshipCombobox(
      page,
      "event-direction-link-combobox",
      directionB,
      directionB,
    );

    const otherTab = await page.context().newPage();
    await openDirectionsTab(otherTab, eventUrl);
    await selectRelationshipCombobox(
      otherTab,
      "event-direction-link-combobox",
      directionB,
      directionB,
    );
    await otherTab.getByTestId("event-direction-link-submit").click();
    await expect(otherTab.getByTestId("event-directions-notice")).toBeVisible();
    await otherTab.close();

    await page.getByTestId("event-direction-link-submit").click();
    await expect(page.getByTestId("event-directions-command-error")).toContainText(
      "Такая связь уже есть",
    );

    // ── Retire: the preview is READ, its rows are RENDERED, then it confirms ─
    await openDirectionsTab(page, eventUrl);
    // BOTH directions are linked by now (the duplicate arc above linked B from the
    // other tab), so the retired one is named from the row itself rather than
    // assumed — the list order is the API's to decide, not this spec's.
    const retiredTitle = (
      await page
        .locator('[data-testid^="event-direction-title-"]')
        .first()
        .innerText()
    ).trim();
    await page.locator('[data-testid^="event-direction-retire-"]').first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Снять связь с направлением?");
    // NO DELETE WORDING anywhere on the confirmation (§3.1 / EARS-14).
    await expect(dialog).not.toContainText("Удалить");
    // The affected list is the whole point of the gate: either concrete rows the
    // operator can read, or the explicit «ничего не изменится».
    await expect(dialog.locator('[data-testid$="-impact"]')).toBeVisible();

    // ── A stale envelope RELOADS the preview; it never auto-retries ─────────
    // Fault injection at the transport, because the refusal under test is the
    // CLIENT's: the API half (tampered/expired/wrong-transition → one
    // undifferentiated 412 `LIFECYCLE_IMPACT_STALE`) is proven in
    // `event-directions.e2e-spec.ts`. Corrupting the signed envelope on exactly one
    // confirmation is the only way to reach the browser branch deterministically.
    let previewReads = 0;
    await page.route("**/v1/admin/event-directions/**", async (route) => {
      const request = route.request();
      if (request.url().includes("lifecycle-impact")) {
        previewReads += 1;
        await route.fallback();
        return;
      }
      if (request.method() === "POST" && request.url().endsWith("/retire")) {
        const headers = await request.allHeaders();
        await route.fallback({
          headers: {
            ...headers,
            "lifecycle-impact-token": `${headers["lifecycle-impact-token"] ?? ""}x`,
          },
        });
        return;
      }
      await route.fallback();
    });
    const readsBefore = previewReads;
    await page.getByRole("dialog").locator('[data-testid$="-submit"]').click();
    await expect(
      dialog.locator('[data-testid$="-stale"]'),
      "a stale envelope must be SHOWN, not retried",
    ).toContainText("список затронутых записей обновлён");
    // The dialog stayed open on the NEW preview — the operator answers again.
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => previewReads, { timeout: 10_000 })
      .toBeGreaterThan(readsBefore);
    await page.unroute("**/v1/admin/event-directions/**");

    // ── The honest confirmation applies it ─────────────────────────────────
    await page.getByRole("dialog").locator('[data-testid$="-submit"]').click();
    await expect(page.getByTestId("event-directions-notice")).toContainText(
      "Связь снята.",
    );

    // ── The retired link is hidden by default and listed behind the toggle ──
    await expect(
      page.getByTestId("event-directions-panel").getByText(retiredTitle),
    ).toHaveCount(0);
    // The DS `Switch` is a real checkbox rendered `sr-only` behind its painted
    // track, so a user (and this spec) clicks the wrapping label, not the input —
    // `.check()` on the input is intercepted by the track, as a mouse would be.
    await page
      .getByTestId("event-directions-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("event-directions-retired")).toContainText(
      retiredTitle,
    );

    // ── Restore moves the SAME row back ────────────────────────────────────
    const rowTestId = await page
      .getByTestId("event-directions-retired")
      .locator('[data-testid^="event-direction-row-"]')
      .first()
      .getAttribute("data-testid");
    await page
      .getByTestId("event-directions-retired")
      .locator('[data-testid^="event-direction-restore-"]')
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Вернуть связь с направлением?",
    );
    await page.getByRole("dialog").locator('[data-testid$="-submit"]').click();
    await expect(page.getByTestId("event-directions-notice")).toContainText(
      "Связь возвращена.",
    );
    // Same row id ⇒ restored, not reinserted (the §2.1 retained-join contract).
    await expect(page.locator(`[data-testid="${rowTestId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid^="event-direction-row-"]')).toHaveCount(
      2,
    );

    // ── The axis fence: `specialties` survived the whole arc untouched ──────
    // EARS-11 keeps directions and specialties as two independent axes. After
    // link → duplicate-refusal → retire → restore, the event's own free-text
    // specialties field must read exactly what it was created with.
    await page.goto(eventUrl);
    await page.getByTestId("tab-main").click();
    await expect(page.locator("#specialties")).toHaveValue(SPECIALTIES);
  });
});
