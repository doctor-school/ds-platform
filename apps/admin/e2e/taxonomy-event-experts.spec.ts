import { expect, test, type Page } from "@playwright/test";
import { selectRelationshipCombobox } from "./support/relationship-combobox";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 012 EARS-7 (#1289), browser half — the REAL Refine → NestJS → Postgres path for
 * the event↔expert link editor.
 *
 * The API e2e suites (`apps/api/test/taxonomy/event-experts*.e2e-spec.ts`) prove
 * the contract against the API directly. This proves the operator-facing arc on
 * the running admin: sign in, open the «Эксперты» tab of a real event, link an
 * expert through the search-narrowed selector, watch the two server refusals that
 * only a second row can produce (an occupied slot and a duplicate pair) come back
 * as RU sentences, and retire/restore the link through the confirmations. The
 * reject branches for every field kind ride along and must surface RU inline
 * errors BEFORE any request leaves the browser.
 *
 * NOT driven here, because no control produces them: the legacy-speaker MATCH
 * (`LEGACY_SPEAKER_CONFLICT`, the cross-event id and the already-matched row) and
 * the UNMATCH round-trip. Choosing a legacy speaker needs an admin read of the
 * event's retained speaker rows, which no route exposes yet — that control is
 * tracked at #1426, `blocked_by` #1306. What ships here is the matched/unmatched
 * BADGE, whose unmatched state is asserted below.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-event-experts.spec.ts --config=playwright.flows.config.ts
 */

/** A real event through the real 007 create form; returns its id. */
async function createEvent(page: Page, title: string): Promise<string> {
  await page.goto("/events/create");
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-07-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split("/").pop()!;
}

/** A draft expert authored through the current structured-name form. */
async function createExpert(
  page: Page,
  familyName: string,
  givenName: string,
  patronymic: string,
): Promise<{ name: string; url: string }> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill(givenName);
  await page.getByTestId("expert-patronymic").fill(patronymic);
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return {
    name: `${familyName} ${givenName} ${patronymic}`,
    url: page.url(),
  };
}

/** Open the add dialog and choose an expert through the search-narrowed selector. */
async function openAddDialog(page: Page, expertName: string): Promise<void> {
  await page.getByTestId("event-expert-add").click();
  await page.getByTestId("event-expert-add-form").waitFor({ state: "visible" });
  // The narrowing runs on the API (`?q=`), not over a page held in the browser,
  // so the assertion is that the SERVER's answer reached the dropdown.
  await selectRelationshipCombobox(
    page,
    "event-expert-combobox",
    expertName.split(" ")[0]!,
    expertName,
  );
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-7 — event↔expert links in the live admin", () => {
  test("EARS-22: an operator authors an event↔expert link from the expert endpoint through the same relationship panel", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const eventTitle = `Эфир для эксперта ${stamp}`;
    const expert = await createExpert(
      page,
      `Обратная-${stamp}`,
      "Связь",
      "Ильинична",
    );
    await createEvent(page, eventTitle);

    await page.goto(expert.url);
    await expect(
      page.getByTestId("tab-events"),
      "expert detail must expose the reverse Event↔Expert authoring surface",
    ).toBeVisible();
    await page.getByTestId("tab-events").click();
    await expect(page.getByTestId("event-experts-panel")).toBeVisible();
    await page.getByTestId("event-expert-add").click();
    await selectRelationshipCombobox(
      page,
      "event-expert-event-combobox",
      eventTitle,
      eventTitle,
    );
    await page.getByTestId("event-expert-add-role").fill("Докладчик");
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();

    await expect(page.getByTestId("event-experts-notice")).toContainText(
      "Эксперт привязан к мероприятию.",
    );
    await expect(page.getByTestId("event-experts-panel")).toContainText(
      eventTitle,
    );
  });

  test("012 EARS-7: an operator links, corrects, retires and restores an expert on a real event", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const firstExpert = await createExpert(
      page,
      `Петров-${stamp}`,
      "Иван",
      "Ильич",
    );
    const secondExpert = await createExpert(
      page,
      `Орлова-${stamp}`,
      "Мария",
      "Игоревна",
    );
    const eventId = await createEvent(page, `Кардиофорум ${stamp}`);

    // ── Reach the editor through the chrome, on the event it belongs to ────
    await page.goto(`/events/${eventId}`);
    await page.getByTestId("tab-experts").click();
    await page.getByTestId("event-experts-panel").waitFor({ state: "visible" });
    await expect(page.getByTestId("event-experts-empty")).toBeVisible();
    // The retired rows stay hidden until asked for.
    await expect(
      page.getByTestId("event-experts-show-retired"),
    ).not.toBeChecked();

    // ── Reject branch: garbage never leaves the browser ────────────────────
    await page.getByTestId("event-expert-add").click();
    await page
      .getByTestId("event-expert-add-form")
      .waitFor({ state: "visible" });
    await page.getByTestId("event-expert-add-submit").click();
    // Nothing chosen, no role, no slot — three RU sentences, three fixes.
    await expect(page.getByText("Выберите эксперта из списка.")).toBeVisible();
    await expect(page.getByText("Обязательное поле.")).toBeVisible();
    await expect(
      page.getByText("Место — целое число от 0 до 32767."),
    ).toBeVisible();
    await expect(page.getByTestId("event-expert-add-form")).toBeVisible();

    // Role over the 80-character bound is its own sentence, not «обязательное».
    await page.getByTestId("event-expert-add-role").fill("х".repeat(81));
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();

    // The slot box is TEXT holding an integer: a word, a blank and an exponent
    // are one fix; over the cap is another. `Number(" ")` is 0 and `Number("1e3")`
    // is 1000, so both would otherwise pass as a slot nobody typed.
    await page.getByTestId("event-expert-add-role").fill("Модератор");
    for (const bad of ["не число", "   ", "1e3", "-1"]) {
      await page.getByTestId("event-expert-add-position").fill(bad);
      await page.getByTestId("event-expert-add-submit").click();
      await expect(
        page.getByText("Место — целое число от 0 до 32767."),
      ).toBeVisible();
    }
    await page.getByTestId("event-expert-add-position").fill("32768");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(
      page.getByText("Место не может быть больше 32767."),
    ).toBeVisible();
    await expect(page.getByTestId("event-expert-add-form")).toBeVisible();
    await page.keyboard.press("Escape");

    // ── Accept branch: the link is authored through the selector ───────────
    await openAddDialog(page, firstExpert.name);
    await page.getByTestId("event-expert-add-role").fill("Модератор");
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(page.getByTestId("event-experts-notice")).toContainText(
      "Эксперт привязан к мероприятию.",
    );
    const row = page.getByTestId("event-experts-active").locator("section");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(firstExpert.name);
    await expect(row).toContainText("Модератор");
    await expect(row).toContainText("Активна");
    // No legacy speaker was chosen (no control ships — #1426), so the badge must
    // say so rather than leaving the state unnamed.
    await expect(row).toContainText("Не сопоставлен");

    // ── Server refusal 1: the slot is taken (SPEAKER_POSITION_OCCUPIED) ────
    await openAddDialog(page, secondExpert.name);
    await page.getByTestId("event-expert-add-role").fill("Докладчик");
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(page.getByTestId("event-experts-command-error")).toContainText(
      "Это место в списке спикеров уже занято",
    );
    await expect(
      page.getByTestId("event-experts-active").locator("section"),
    ).toHaveCount(1);

    // ── Server refusal 2: the pair already exists (RELATIONSHIP_CONFLICT) ──
    await openAddDialog(page, firstExpert.name);
    await page.getByTestId("event-expert-add-role").fill("Докладчик");
    await page.getByTestId("event-expert-add-position").fill("2");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(page.getByTestId("event-experts-command-error")).toContainText(
      "Этот эксперт уже привязан к мероприятию",
    );

    // ── Edit: the expert is a FACT, only role and slot are authored ────────
    await page.locator('[data-testid^="event-expert-edit-"]').first().click();
    const editForm = page.locator('[data-testid$="-form"]').last();
    await editForm.waitFor({ state: "visible" });
    await expect(editForm).toContainText(firstExpert.name);
    await expect(
      page.getByText("Мероприятие и эксперта у существующей связи изменить", {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .locator('[data-testid^="event-expert-edit-"][data-testid$="-role"]')
      .fill("Модератор секции");
    await page
      .locator('[data-testid^="event-expert-edit-"][data-testid$="-submit"]')
      .click();
    await expect(page.getByTestId("event-experts-notice")).toContainText(
      "Изменения сохранены.",
    );
    await page.reload();
    await page.getByTestId("tab-experts").click();
    await expect(
      page.getByTestId("event-experts-active").locator("section"),
    ).toContainText("Модератор секции");

    // ── Retire → restore round-trip, both behind an answered confirmation ──
    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-retire"]')
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-retire-submit"]')
      .click();
    await expect(page.getByTestId("event-experts-notice")).toContainText(
      "Связь отозвана.",
    );
    // The row leaves the active list but is NOT deleted — it is behind the toggle.
    await expect(page.getByTestId("event-experts-empty")).toBeVisible();
    // The DS Switch keeps its input `sr-only` under the label that carries the
    // visible track, so a user's click lands on the LABEL — `check()` would aim
    // at the hidden input and be intercepted by the track it draws.
    const showRetired = page.getByTestId("event-experts-show-retired");
    await showRetired.locator("xpath=ancestor::label[1]").click();
    await expect(showRetired).toBeChecked();
    const retiredRow = page
      .getByTestId("event-experts-retired")
      .locator("section");
    await expect(retiredRow).toHaveCount(1);
    await expect(retiredRow).toContainText("Отозвана");

    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-restore"]')
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-restore-submit"]')
      .click();
    await expect(page.getByTestId("event-experts-notice")).toContainText(
      "Связь возвращена.",
    );
    await expect(
      page.getByTestId("event-experts-active").locator("section"),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("event-experts-active").locator("section"),
    ).toContainText("Активна");
  });

  test("012 EARS-7: a failed collection read shall render the RU error state, never a white screen (#1590)", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const eventId = await createEvent(
      page,
      `Эксперты — сбой чтения ${Date.now()}`,
    );

    // Fault injection at the transport: the failure under test is the BROWSER's
    // rendering of a read that has no answer. Refine's `result.data` substitutes
    // a frozen `{}` there, so a presence check against it reads "loaded" and the
    // panel then trips over `list.data` — the white screen of #1590 (the same
    // defect as #1428). Only the query's own `data` distinguishes the two states.
    await page.route("**/v1/admin/event-experts?**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "injected read failure" }),
      });
    });

    await page.goto(`/events/${eventId}`);
    await page.getByTestId("tab-experts").click();
    await expect(page.getByTestId("event-experts-error")).toContainText(
      "Не удалось загрузить экспертов мероприятия.",
    );
    // The panel body never rendered, and the tab is still a live screen rather
    // than a blank document — an operator can read WHY and retry.
    await expect(page.getByTestId("event-experts-panel")).toHaveCount(0);
    await expect(page.getByTestId("tab-experts")).toBeVisible();
  });
});
