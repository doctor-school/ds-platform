import {
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SECTION_ORDER = [
  "what",
  "experts",
  "events",
  "why",
  "projects",
  "partner-value",
  "formats",
  "lead-demo",
] as const;

const EXPERT_PORTRAITS = [
  "eduard-ildarkhanov.webp",
  "maksim-strakhov.webp",
  "timofey-gaev.webp",
  "evgeniy-konstantinov.webp",
  "nikolay-zagorodniy.webp",
  "anatoliy-bondarev.webp",
] as const;

const PROJECTS = [
  {
    title: "Синергизм вместо конкуренции в фарме (возможен ли?)",
    href: "https://academy.doctor.school/webinars/event-70d250b9",
  },
  {
    title: "B2B — стейкхолдеры реальных решений",
    href: "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd",
  },
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REQUIRED_FORM_ERRORS = [
  ["academy-partner-name-field", "Укажите имя."],
  [
    "academy-partner-contact-field",
    "Укажите корректный email или Telegram в формате @username.",
  ],
  ["academy-partner-role-field", "Выберите роль."],
  [
    "academy-partner-consent-field",
    "Подтвердите согласие на обработку персональных данных.",
  ],
] as const;
const SUBMISSIONS_DIRECTORY = process.env.ACADEMY_SUBMISSIONS_DIR;
const PERSISTENCE_E2E_SAFE =
  process.env.ACADEMY_PARTNERSHIP_E2E_SAFE === "1";
const SAFE_SUBMISSIONS_PREFIX = "academy-partnership-e2e-";

function normalized(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertSafeCandidatePath(path: string): string {
  const resolved = resolve(path);
  if (
    normalized(dirname(resolved)) !== normalized(tmpdir()) ||
    !basename(resolved).startsWith(SAFE_SUBMISSIONS_PREFIX)
  ) {
    throw new Error("Refusing an unsafe Academy persistence E2E path");
  }
  return resolved;
}

async function assertSafeRealPath(
  path: string,
  kind: "directory" | "file",
): Promise<string> {
  if (!PERSISTENCE_E2E_SAFE) {
    throw new Error("Academy persistence E2E marker is not enabled");
  }
  const resolved = assertSafeCandidatePath(path);
  const [realTarget, realTemporaryRoot, metadata] = await Promise.all([
    realpath(resolved),
    realpath(tmpdir()),
    stat(resolved),
  ]);
  const expectedKind =
    kind === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (
    !expectedKind ||
    normalized(realTarget) !== normalized(resolved) ||
    normalized(dirname(realTarget)) !== normalized(realTemporaryRoot)
  ) {
    throw new Error("Refusing an unsafe Academy persistence E2E target");
  }
  return realTarget;
}

async function jsonRecords(): Promise<string[]> {
  if (!SUBMISSIONS_DIRECTORY) {
    throw new Error("ACADEMY_SUBMISSIONS_DIR is required by Academy E2E");
  }
  return (await readdir(SUBMISSIONS_DIRECTORY))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

async function fillValidPartnershipForm(page: Page) {
  const form = page.locator("#partner-form form");
  await form.getByLabel(/^Имя/).fill("  Анна Соколова  ");
  await form.getByLabel("Компания или клиника").fill("  Клиника  ");
  await form.getByLabel(/^Email или Telegram/).fill("  @anna_sokolova  ");
  await form.getByLabel(/^Роль/).selectOption("Партнёр");
  const consent = form.getByRole("checkbox", {
    name: /Согласен\(а\) на обработку/i,
  });
  await form
    .getByText(
      "Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.",
      { exact: true },
    )
    .click();
  await expect(consent).toBeChecked();
  return form;
}

test.describe("Feature 013 — static public Academy home", () => {
  test.describe.configure({ mode: "serial" });
  test("EARS-1: when a visitor requests public /, portal shall render the exact static Academy home", async ({
    page,
  }) => {
    const dynamicRequests: string[] = [];
    page.on("request", (request) => {
      if (["fetch", "xhr"].includes(request.resourceType())) {
        dynamicRequests.push(request.url());
      }
    });

    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Создаем будущее медицинского образования вместе",
    );
    await expect
      .poll(() =>
        page
          .getByRole("main")
          .locator(":scope > [data-academy-section]")
          .evaluateAll((sections) =>
            sections.map((section) =>
              section.getAttribute("data-academy-section"),
            ),
          ),
      )
      .toEqual(SECTION_ORDER);
    // #1877 — the root route mounts the persistent 008 app-shell header like
    // every other portal route; the page body itself owns no header any more.
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByTestId("shell-logo")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    // The static page fetches nothing of its own; the sole dynamic request is
    // the shell header's one-shot self-profile read (008 `useHeaderAuth`).
    expect(
      dynamicRequests.filter((url) => !url.includes("/v1/me/profile")),
    ).toEqual([]);
  });

  test("EARS-2: page shall render six supplied portraits and the approved repeated Project and Events rows", async ({
    page,
  }) => {
    await page.goto("/");

    const experts = page.locator('[data-academy-section="experts"]');
    const projectBlock = experts.getByTestId("academy-expert-project");
    const expertGrid = experts.getByTestId("academy-expert-grid");
    await expect
      .poll(() =>
        experts
          .locator(
            '[data-testid="academy-expert-project"], [data-testid="academy-expert-grid"]',
          )
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-testid")),
          ),
      )
      .toEqual(["academy-expert-project", "academy-expert-grid"]);

    const portraits = expertGrid.locator("img");
    await expect(portraits).toHaveCount(6);
    for (const [index, filename] of EXPERT_PORTRAITS.entries()) {
      await expect(portraits.nth(index)).toHaveAttribute("src", new RegExp(filename));
    }

    const projectLinks = projectBlock
      .getByTestId("academy-project-list")
      .getByRole("link");
    const eventLinks = page
      .locator('[data-academy-section="events"]')
      .locator("[data-webinar-card]")
      .getByRole("link");
    await expect(projectLinks).toHaveCount(2);
    await expect(eventLinks).toHaveCount(2);
    for (const [index, project] of PROJECTS.entries()) {
      const projectLink = projectLinks.nth(index);
      await expect(projectLink).toContainText(project.title);
      await expect(projectLink).toHaveAttribute("href", project.href);
      await expect(projectLink).toHaveAttribute("target", "_blank");
      await expect(projectLink).toHaveAttribute("rel", "noopener noreferrer");

      const eventLink = eventLinks.nth(index);
      await expect(eventLink).toContainText(project.title);
      await expect(eventLink).toHaveAttribute("href", project.href);
    }
    await expect(
      page.getByRole("link", { name: "Политика конфиденциальности" }),
    ).toHaveAttribute("href", "https://doctor.school/index/privacy-pay");
    for (const inventedMetric of [
      "38 направлений",
      "12 клубов",
      "24 выпуска",
      "6 треков",
    ]) {
      await expect(page.getByText(inventedMetric, { exact: true })).toHaveCount(0);
    }
  });

  test.skip("EARS-3: historical disabled-preview boundary is superseded only after the tracked EARS-5 follow-up ships", () => {});

  test("EARS-4: static page shall remain readable at desktop and mobile in light and dark themes and pass axe", async ({
    page,
  }) => {
    const presentations = [
      { name: "desktop-light", width: 1440, height: 900, theme: "light" },
      { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
      { name: "mobile-light", width: 390, height: 844, theme: "light" },
      { name: "mobile-dark", width: 390, height: 844, theme: "dark" },
    ] as const;

    for (const presentation of presentations) {
      await test.step(presentation.name, async () => {
        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({ colorScheme: presentation.theme });
        await page.goto("/");
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, presentation.theme);

        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByRole("contentinfo")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);

        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .exclude('[data-testid="academy-footer-wordmark"]')
          .analyze();
        const seriousViolations = results.violations
          .filter(
            (violation) =>
              violation.impact === "serious" || violation.impact === "critical",
          )
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.flatMap((node) => node.target),
          }));
        expect(
          seriousViolations,
          `axe serious/critical violations on ${presentation.name}`,
        ).toEqual([]);
      });
    }
  });

  test("EARS-5: enabled partnership form shall expose the exact controls and reject invalid contact accessibly", async ({
    page,
  }) => {
    await page.goto("/#partner-form");
    const form = page.locator("#partner-form form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/^Имя/)).toBeEnabled();
    await expect(form.getByLabel("Компания или клиника")).toBeEnabled();
    await expect(form.getByLabel(/^Email или Telegram/)).toHaveAttribute(
      "placeholder",
      "name@company.ru или @username",
    );
    await expect(form.getByLabel(/^Роль/).locator("option")).toHaveText([
      "Выберите роль",
      "Эксперт",
      "Партнёр",
      "Участник подкаста",
      "Соавтор направления",
      "Компания",
    ]);
    await expect(
      form.getByRole("link", { name: "Политика конфиденциальности" }),
    ).toHaveAttribute("href", "https://doctor.school/index/privacy-pay");

    await form
      .getByLabel("Компания или клиника")
      .fill("x".repeat(161));
    await form.getByLabel(/^Email или Telegram/).fill("@bad-name");
    await form.getByRole("button", { name: "Обсудить партнёрство" }).click();
    const summary = form.getByTestId("academy-form-error-summary");
    await expect(summary).toBeFocused();
    const nameError = summary.getByRole("link", { name: "Укажите имя." });
    await expect(nameError).toHaveAttribute(
      "href",
      "#academy-partner-name-field",
    );
    await nameError.click();
    await expect(form.getByLabel(/^Имя/)).toBeFocused();

    const invalidResults = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude('[data-testid="academy-footer-wordmark"]')
      .analyze();
    expect(
      invalidResults.violations
        .filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        )
        .map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.flatMap((node) => node.target),
        })),
      "invalid form state shall remain axe-clean",
    ).toEqual([]);
  });

  test("EARS-5: first submit click after contact blur shall retain all required errors at mobile and desktop widths", async ({
    page,
  }) => {
    for (const width of [390, 1440]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/#partner-form");
        const form = page.locator("#partner-form form");
        await form.getByLabel(/^Email или Telegram/).fill("@bad-name");
        await form
          .getByRole("button", { name: "Обсудить партнёрство" })
          .click();

        const summary = form.getByTestId("academy-form-error-summary");
        await expect(summary).toBeFocused();
        for (const [fieldId, message] of REQUIRED_FORM_ERRORS) {
          await expect(
            summary.getByRole("link", { name: message }),
          ).toHaveAttribute("href", `#${fieldId}`);
          await expect(form.locator(`#${fieldId}`)).toHaveAttribute(
            "aria-invalid",
            "true",
          );
          await expect(
            form.locator('p[role="alert"]').filter({ hasText: message }),
          ).toBeVisible();
        }
      });
    }
  });

  test("EARS-6/7: accepted retry after a lost response shall create one exact private JSON record and then show success", async ({
    page,
  }) => {
    test.skip(!PERSISTENCE_E2E_SAFE, "requires the isolated CI persistence fixture");
    if (!SUBMISSIONS_DIRECTORY) throw new Error("missing submissions directory");
    const safeDirectory = await assertSafeRealPath(
      SUBMISSIONS_DIRECTORY,
      "directory",
    );
    const recordsBefore = new Set(await jsonRecords());
    const mutationUrls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") mutationUrls.push(request.url());
    });

    let intercepted = false;
    let firstWriteReachedServer = false;
    await page.route("**/*", async (route) => {
      if (!intercepted && route.request().method() === "POST") {
        intercepted = true;
        const response = await route.fetch();
        firstWriteReachedServer = response.ok();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/#partner-form");
    const form = await fillValidPartnershipForm(page);
    await form.getByRole("button", { name: "Обсудить партнёрство" }).click();
    await expect(
      form.getByText("Не удалось сохранить заявку. Попробуйте ещё раз."),
    ).toBeVisible();
    expect(firstWriteReachedServer).toBe(true);
    await expect.poll(async () => (await jsonRecords()).length).toBe(
      recordsBefore.size + 1,
    );

    await page.unrouteAll({ behavior: "wait" });
    await form.getByRole("button", { name: "Обсудить партнёрство" }).click();
    await expect(page.getByText("Спасибо! Заявка сохранена.")).toBeVisible();

    const recordsAfter = await jsonRecords();
    const created = recordsAfter.filter((file) => !recordsBefore.has(file));
    expect(created).toHaveLength(1);
    const recordPath = join(safeDirectory, created[0]!);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      id: string;
      acceptedAt: string;
      idempotencyKey: string;
      name: string;
      companyOrClinic: string;
      contact: string;
      role: string;
      consent: Record<string, unknown>;
    };
    expect(created[0]).toBe(`${record.id}.json`);
    expect(record).toMatchObject({
      idempotencyKey: record.id,
      name: "Анна Соколова",
      companyOrClinic: "Клиника",
      contact: "@anna_sokolova",
      role: "Партнёр",
      consent: {
        purpose: "academy_partnership_contact",
        versionTag: "academy-partnership-v1",
        text: "Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.",
        accepted: true,
        acceptedAt: record.acceptedAt,
        policyUrl: "https://doctor.school/index/privacy-pay",
      },
    });
    expect(record.consent.textSha256).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") {
      expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
    }
    expect(mutationUrls).not.toHaveLength(0);
    expect(
      mutationUrls.every((url) => new URL(url).origin === new URL(page.url()).origin),
    ).toBe(true);
    expect((await page.request.get("/api/academy-partnership")).status()).toBe(404);
  });

  test("EARS-7: an actual unavailable persistence path shall preserve browser values and create no partial record", async ({
    page,
  }) => {
    test.skip(!PERSISTENCE_E2E_SAFE, "requires the isolated CI persistence fixture");
    if (!SUBMISSIONS_DIRECTORY) throw new Error("missing submissions directory");
    const safeDirectory = await assertSafeRealPath(
      SUBMISSIONS_DIRECTORY,
      "directory",
    );
    const recordsBefore = await jsonRecords();
    const backup = assertSafeCandidatePath(`${safeDirectory}.backup`);
    await rename(safeDirectory, backup);
    await writeFile(safeDirectory, "not a directory", "utf8");

    try {
      await page.goto("/#partner-form");
      const form = await fillValidPartnershipForm(page);
      await form.getByRole("button", { name: "Обсудить партнёрство" }).click();
      await expect(
        form.getByText("Не удалось сохранить заявку. Попробуйте ещё раз."),
      ).toBeVisible();
      await expect(form.getByLabel(/^Имя/)).toHaveValue("  Анна Соколова  ");
      await expect(form.getByLabel(/^Email или Telegram/)).toHaveValue(
        "  @anna_sokolova  ",
      );
      await expect(page.getByText("Спасибо! Заявка сохранена.")).toHaveCount(0);
    } finally {
      const safeUnavailableFile = await assertSafeRealPath(safeDirectory, "file");
      const safeBackup = await assertSafeRealPath(backup, "directory");
      await rm(safeUnavailableFile, { force: true });
      assertSafeCandidatePath(safeDirectory);
      await rename(safeBackup, safeDirectory);
    }

    expect(await jsonRecords()).toEqual(recordsBefore);
    expect(
      (await readdir(SUBMISSIONS_DIRECTORY)).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
  });

  test("EARS-8: enabled partnership form shall remain keyboard-operable and axe-clean while pending", async ({
    page,
  }) => {
    await page.goto("/#partner-form");
    const form = page.locator("#partner-form form");
    const name = form.getByLabel(/^Имя/);
    const company = form.getByLabel("Компания или клиника");
    const contact = form.getByLabel(/^Email или Telegram/);
    const role = form.getByLabel(/^Роль/);
    const consent = form.getByRole("checkbox", {
      name: /Согласен\(а\) на обработку/i,
    });
    const policy = form.getByRole("link", {
      name: "Политика конфиденциальности",
    });

    await name.focus();
    await name.fill("Анна Соколова");
    await page.keyboard.press("Tab");
    await expect(company).toBeFocused();
    await company.fill("Клиника");
    await page.keyboard.press("Tab");
    await expect(contact).toBeFocused();
    await contact.fill("@anna_sokolova");
    await page.keyboard.press("Tab");
    await expect(role).toBeFocused();
    await role.selectOption("Партнёр");
    await page.keyboard.press("Tab");
    await expect(consent).toBeFocused();
    await page.keyboard.press("Space");
    await expect(consent).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(policy).toBeFocused();

    let postCount = 0;
    let releaseRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") {
        postCount += 1;
        await requestGate;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    const submit = form.getByRole("button", { name: "Обсудить партнёрство" });
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();
    const firstClick = page.keyboard.press("Enter");
    await expect.poll(() => postCount).toBe(1);
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(submit).toBeDisabled();
    await submit.dispatchEvent("click");
    expect(postCount).toBe(1);
    releaseRequest?.();
    await firstClick;
    await expect(
      form.getByText("Не удалось сохранить заявку. Попробуйте ещё раз."),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude('[data-testid="academy-footer-wordmark"]')
      .analyze();
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
  });

  test("EARS-8: submit shall remain visually distinct from the primary surface in both themes", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      await test.step(theme, async () => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/#partner-form");
        await page.evaluate((selectedTheme) => {
          document.documentElement.classList.toggle(
            "dark",
            selectedTheme === "dark",
          );
        }, theme);

        const surface = page.locator("#partner-form");
        const submit = surface.getByRole("button", {
          name: "Обсудить партнёрство",
        });
        await expect(submit).toHaveClass(/bg-header-foreground/);
        const colors = await page.evaluate(() => {
          const section = document.querySelector("#partner-form");
          const button = section?.querySelector("button[type='submit']");
          if (!(section instanceof HTMLElement) || !(button instanceof HTMLElement)) {
            throw new Error("Academy partnership surface is unavailable");
          }
          return {
            surface: getComputedStyle(section).backgroundColor,
            button: getComputedStyle(button).backgroundColor,
            label: getComputedStyle(button).color,
          };
        });
        expect(colors.button).not.toBe(colors.surface);
        expect(colors.label).not.toBe(colors.button);
      });
    }
  });

  test("#1877: parallel chrome mounts the app-shell header on / and on non-root routes", async ({
    page,
  }) => {
    await page.route("**/v1/auth/session", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );
    await page.route("**/v1/me/profile", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );

    await page.goto("/");

    const header = page.locator("header");
    await expect(page.getByTestId("shell-logo")).toBeVisible();
    await expect(header).toHaveCount(1);
    // A guest gets the real «Войти» way-in — the interim stub's disabled
    // bespoke buttons are gone (#1877).
    await expect(page.getByTestId("shell-login")).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(header.locator("button[disabled]")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByTestId("shell-mobile-menu");
    await menu.locator("summary").click();
    await expect(page.getByTestId("shell-mobile-broadcasts")).toBeVisible();
    await expect(page.getByTestId("shell-mobile-broadcasts")).toHaveText(
      "Эфиры",
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/account");

    await expect(page.getByTestId("shell-logo")).toBeVisible();
    await expect(page.locator("header")).toHaveCount(1);
  });
});
