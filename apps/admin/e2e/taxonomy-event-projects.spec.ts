import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-6 (#1288), browser half — the REAL Refine → NestJS → Postgres path for
 * the event↔project relationship editor and the §3.1 preview→confirm gate.
 *
 * `apps/api/test/taxonomy/event-projects.e2e-spec.ts` proves the contract against
 * the API. This proves the OPERATOR-facing arc, which no API test can: that the
 * confirmation dialog shows the affected rows BEFORE the transition fires, that a
 * refused confirmation says the right RU sentence, that a stale envelope RELOADS
 * the preview instead of retrying behind the operator's back, and that a retired
 * link comes back as the SAME row rather than as a new one.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec. Run
 * against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-event-projects.spec.ts --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** Sign in and complete the one-time TOTP enrollment; lands on `/events`. */
async function signInAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
}

/** A real published-shaped project row; returns its title and detail URL. */
async function createProject(
  page: Page,
  title: string,
): Promise<{ title: string; url: string }> {
  await page.goto("/projects/create");
  await page.getByTestId("project-form").waitFor({ state: "visible" });
  await page.locator("#title").fill(title);
  await page.locator("#description").fill("Описание для проверки связей.");
  await page.getByTestId("submit-project").click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return { title, url: page.url() };
}

/** A real event row; returns its detail URL. */
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
  return page.url();
}

/** Open the «Проекты» tab of an event detail and wait for the panel. */
async function openProjectsTab(page: Page, eventUrl: string): Promise<void> {
  await page.goto(eventUrl);
  await page.getByTestId("tab-projects").click();
  await page.getByTestId("event-projects-panel").waitFor({ state: "visible" });
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-6 — event↔project relationships in the live admin", () => {
  test("EARS-22: an operator authors an event↔project link from the project endpoint through the same relationship panel", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const eventTitle = `Обратный эфир проекта ${stamp}`;
    const project = await createProject(page, `Обратный проект ${stamp}`);
    await createEvent(page, eventTitle);

    await page.goto(project.url);
    await page.getByTestId("tab-events").click();
    await page.getByTestId("event-project-link-search").fill(eventTitle);
    await page
      .getByTestId("event-project-link-select")
      .selectOption({ label: eventTitle });
    await page.getByTestId("event-project-link-submit").click();

    await expect(page.getByTestId("event-projects-notice")).toContainText(
      "Связь добавлена.",
    );
    await expect(page.getByTestId("event-projects-panel")).toContainText(
      eventTitle,
    );
  });

  test("012 EARS-6: an operator links a project, retires the link through the impact preview and restores it", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const projectA = await createProject(page, `Связи проект A ${stamp}`);
    const projectB = await createProject(page, `Связи проект B ${stamp}`);
    const eventUrl = await createEvent(page, `Связи эфир ${stamp}`);

    // ── The tab starts empty and says so ───────────────────────────────────
    await openProjectsTab(page, eventUrl);
    await expect(page.getByTestId("event-projects-empty")).toBeVisible();
    await expect(page.getByTestId("event-projects-panel")).toContainText(
      "Связи не удаляются",
    );

    // ── Add a link through the searchable selector ─────────────────────────
    // The search narrows SERVER-SIDE (`?q=`), so the option list is the API's
    // answer, not a client-side filter over one page of rows.
    await page.getByTestId("event-project-link-search").fill(projectA.title);
    await expect(
      page.getByTestId("event-project-link-select").locator("option"),
    ).toHaveCount(2); // the placeholder + the one match
    await page
      .getByTestId("event-project-link-select")
      .selectOption({ label: projectA.title });
    await page.getByTestId("event-project-link-submit").click();
    await expect(page.getByTestId("event-projects-notice")).toContainText(
      "Связь добавлена.",
    );
    await expect(page.getByTestId("event-projects-panel")).toContainText(
      projectA.title,
    );
    // An already-linked project is no longer offerable: a choice that could only
    // ever come back 409 is not a choice.
    await page.getByTestId("event-project-link-search").fill(projectA.title);
    await expect(
      page.getByTestId("event-project-link-no-options"),
    ).toBeVisible();

    // ── The duplicate-pair refusal, reached the way it really happens ───────
    // Two operators on the same event: this tab's picker still offers project B
    // while the other tab links it. The stale choice must produce the RU sentence
    // that names the retained-row remedy, not a generic failure.
    await page.getByTestId("event-project-link-search").fill(projectB.title);
    await page
      .getByTestId("event-project-link-select")
      .selectOption({ label: projectB.title });

    const otherTab = await page.context().newPage();
    await openProjectsTab(otherTab, eventUrl);
    await otherTab
      .getByTestId("event-project-link-search")
      .fill(projectB.title);
    await otherTab
      .getByTestId("event-project-link-select")
      .selectOption({ label: projectB.title });
    await otherTab.getByTestId("event-project-link-submit").click();
    await expect(otherTab.getByTestId("event-projects-notice")).toBeVisible();
    await otherTab.close();

    await page.getByTestId("event-project-link-submit").click();
    await expect(
      page.getByTestId("event-projects-command-error"),
    ).toContainText("Такая связь уже есть");

    // ── Retire: the preview is READ, its rows are RENDERED, then it confirms ─
    await openProjectsTab(page, eventUrl);
    // BOTH projects are linked by now (the duplicate arc above linked B from the
    // other tab), so the retired one is named from the row itself rather than
    // assumed — the list order is the API's to decide, not this spec's.
    const retiredTitle = (
      await page
        .locator('[data-testid^="event-project-title-"]')
        .first()
        .innerText()
    ).trim();
    const retireTrigger = page
      .locator('[data-testid^="event-project-retire-"]')
      .first();
    await retireTrigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Снять связь с проектом?");
    // NO DELETE WORDING anywhere on the confirmation (§3.1 / EARS-14).
    await expect(dialog).not.toContainText("Удалить");
    // The affected list is the whole point of the gate: either concrete rows the
    // operator can read, or the explicit «ничего не изменится».
    await expect(dialog.locator('[data-testid$="-impact"]')).toBeVisible();

    // ── A stale envelope RELOADS the preview; it never auto-retries ─────────
    // Fault injection at the transport, because the refusal under test is the
    // CLIENT's: the API half (tampered/expired/wrong-transition → one
    // undifferentiated 412 `LIFECYCLE_IMPACT_STALE`) is proven in
    // `event-projects.e2e-spec.ts`. Corrupting the signed envelope on exactly one
    // confirmation is the only way to reach the browser branch deterministically.
    let previewReads = 0;
    await page.route("**/v1/admin/event-projects/**", async (route) => {
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
    await page.unroute("**/v1/admin/event-projects/**");

    // ── The honest confirmation applies it ─────────────────────────────────
    await page.getByRole("dialog").locator('[data-testid$="-submit"]').click();
    await expect(page.getByTestId("event-projects-notice")).toContainText(
      "Связь снята.",
    );

    // ── The retired link is hidden by default and listed behind the toggle ──
    // The retired link left the ACTIVE list (the other link is still there) and
    // is only readable once the operator asks for retired rows.
    await expect(
      page.getByTestId("event-projects-panel").getByText(retiredTitle),
    ).toHaveCount(0);
    // The DS `Switch` is a real checkbox rendered `sr-only` behind its painted
    // track, so a user (and this spec) clicks the wrapping label, not the input —
    // `.check()` on the input is intercepted by the track, as a mouse would be.
    await page
      .getByTestId("event-projects-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("event-projects-retired")).toContainText(
      retiredTitle,
    );

    // ── Restore moves the SAME row back ────────────────────────────────────
    const rowTestId = await page
      .getByTestId("event-projects-retired")
      .locator('[data-testid^="event-project-row-"]')
      .first()
      .getAttribute("data-testid");
    await page
      .getByTestId("event-projects-retired")
      .locator('[data-testid^="event-project-restore-"]')
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Вернуть связь с проектом?",
    );
    await page.getByRole("dialog").locator('[data-testid$="-submit"]').click();
    await expect(page.getByTestId("event-projects-notice")).toContainText(
      "Связь возвращена.",
    );
    // Same row id ⇒ restored, not reinserted (the §2.1 retained-join contract).
    await expect(page.locator(`[data-testid="${rowTestId}"]`)).toBeVisible();
    await expect(
      page.locator('[data-testid^="event-project-row-"]'),
    ).toHaveCount(2);

    // ── The project side shows the SAME link and the same authoring panel ──
    await page.goto(projectA.url);
    await page.getByTestId("tab-events").click();
    await page
      .getByTestId("event-projects-panel")
      .waitFor({ state: "visible" });
    await expect(page.getByTestId("event-projects-panel")).toContainText(
      `Связи эфир ${stamp}`,
    );
    await expect(page.getByTestId("event-project-link-form")).toBeVisible();
  });
});
