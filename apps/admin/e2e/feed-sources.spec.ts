import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  FEED_SOURCE_ADDRESS_ERROR,
  FEED_SOURCE_ADDRESS_TAKEN_ERROR,
} from "@ds/schemas";
import {
  ADMIN_ORIGIN,
  bootstrapRegistrarAccount,
  createPublishedEvent,
  eventSlugFromRoster,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { bindRegistrarToEvent } from "./support/event-grants";
import { visible } from "./support/visible";

/**
 * 048 «Источники» (#3993, EARS-20…EARS-23; the V-21 subset of this Issue) on
 * the REAL Refine → NestJS → Postgres path: the page under the «Материалы»
 * sub-navigation, «Добавить источник» with an address of another form and a
 * private invite link refused at the field (input kept, nothing stored), the
 * official channel `t.me/bbmacademy` added from its full link and listed
 * «Включён» with no posts and already checked (EARS-21 runs the EARS-31 check
 * at once — the stand's API has no Telegram connector configured, so it reads
 * «Ошибка: Telegram не подключён на сервере»), the same channel refused as already
 * listed, «Изменить адрес» (a refusal at the field, then the change),
 * «Выключить» behind its confirmation and «Включить»; the narrow screen keeps
 * the page from side-scrolling. A congress registrar has no «Материалы»
 * section, so no «Источники»: the route renders the refusal and the server
 * answers 403. The axe half is `e2e/a11y/a11y-axe.e2e.spec.ts` («048 EARS-20»).
 *
 * The «Работает» verdict against a live bot is proven by the API e2e against
 * the Telegram double (#3994); «Публикации» is #3996 — not driven here.
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec; run against a booted
 * admin + api with `--config=playwright.flows.config.ts`. `E2E_SHOT_DIR` opts
 * into the desktop/mobile × light/dark captures the PR body cites.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
/** The at-once check's verdict on a stand with no Telegram connector. */
const NOT_CONNECTED = "Ошибка: Telegram не подключён на сервере";
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const OFFICIAL = "bbmacademy";

async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} side-scrolls by ${overflow}px`).toBe(0);
}

/**
 * Dark = the design-system `.dark` token block on the document root (the admin
 * ships no theme toggle and follows no media query — the `congress-roster.spec.ts`
 * recipe); waits until the body background has actually turned.
 */
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

/** The responsive-web evidence: the screen at both widths, in both schemes. */
async function shot(page: Page, name: string): Promise<void> {
  for (const [width, size] of [
    ["desktop", WIDE],
    ["mobile", NARROW],
  ] as const) {
    await page.setViewportSize(size);
    await expectNoPageSideScroll(page);
    if (!SHOT_DIR) continue;
    await mkdir(SHOT_DIR, { recursive: true });
    for (const colorScheme of ["light", "dark"] as const) {
      await setPalette(page, colorScheme);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name}-${width}-${colorScheme}.png`),
        fullPage: true,
      });
    }
    await setPalette(page, "light");
  }
  await page.setViewportSize(WIDE);
}

/** The stored source list, read through the same admin route the page uses. */
async function storedAddresses(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const res = await fetch("/v1/admin/feed-sources", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    const body = (await res.json()) as { data: { address: string }[] };
    return body.data.map((row) => row.address).sort();
  });
}

/** A row handle as the operator sees it (`DataTable` mounts table + cards). */
function cell(page: Page, testId: string) {
  return visible(page.getByTestId(testId));
}

/** The desktop table row of one source. */
function row(page: Page, address: string) {
  return page
    .getByTestId("feed-sources-table")
    .locator("tr", { has: page.getByTestId(`feed-source-row-${address}`) });
}

async function openSources(page: Page): Promise<void> {
  await page.goto("/materials/sources");
  await expect(
    page.getByRole("heading", { level: 1, name: "Источники" }),
  ).toBeVisible();
  // The list has answered: either rows or the empty state.
  await expect(
    visible(page.getByTestId("feed-sources-table").locator("tbody tr").first()),
  ).toBeVisible();
}

async function submitAddress(page: Page, address: string): Promise<void> {
  const field = page.getByTestId("feed-source-address");
  await field.fill(address);
  await page.getByTestId("submit-feed-source").click();
}

test.describe.configure({ mode: "serial" });

test.describe("048 EARS-20…EARS-23 — «Источники»", () => {
  let adminContext: BrowserContext | undefined;
  let admin: Page;
  /** The address the official channel is moved to by «Изменить адрес». */
  const moved = `bbm_e2e_${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    admin = await adminContext.newPage();
    await admin.setViewportSize(WIDE);
    await signInAsAdmin(admin);
  });

  test.afterAll(async () => {
    await adminContext?.close();
  });

  test("EARS-20: «Источники» is reached from the «Материалы» sub-navigation and lists every source", async () => {
    await admin.goto("/materials");
    const sub = admin.getByTestId("materials-subnav");
    await expect(sub.getByTestId("subnav-materials")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await sub.getByTestId("subnav-sources").click();
    await admin.waitForURL(/\/materials\/sources$/);
    await expect(sub.getByTestId("subnav-sources")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // No new chrome entry beyond the section (EARS-23, design §Admin).
    await expect(admin.getByTestId("nav-materials")).toBeVisible();
    await expect(
      admin.locator("header a", { hasText: "Источники" }),
    ).toHaveCount(0);
    await openSources(admin);

    // The add below drives the official channel itself; the edit further down
    // moves it away again, so a clean run leaves the address free.
    const before = await storedAddresses(admin);
    expect(
      before,
      `t.me/${OFFICIAL} is already listed on this database (an aborted earlier run?)`,
    ).not.toContain(OFFICIAL);
    if (before.length === 0) {
      await expect(
        visible(admin.getByText("Источников пока нет.")),
      ).toBeVisible();
      await expect(
        visible(
          admin
            .getByTestId("feed-sources-table")
            .getByRole("link", { name: "Добавить источник" }),
        ),
      ).toBeVisible();
      await shot(admin, "sources-empty");
    }
  });

  test("EARS-21: an address of another form and an invite link are refused at the field, nothing stored", async () => {
    await openSources(admin);
    const before = await storedAddresses(admin);
    await admin
      .getByRole("link", { name: "Добавить источник" })
      .first()
      .click();
    await admin.waitForURL(/\/materials\/sources\/create$/);
    await expect(admin.getByTestId("feed-source-platform")).toHaveValue(
      "telegram",
    );
    await expect(
      admin.getByTestId("feed-source-platform").locator("option"),
    ).toHaveText(["Telegram"]);

    for (const refused of [
      "https://example.com/bbmacademy",
      "t.me/+AbCdEfGhIjK",
      "https://t.me/joinchat/AbCdEfGhIjK",
      "t.me/bbm",
    ]) {
      await submitAddress(admin, refused);
      await expect(admin.getByText(FEED_SOURCE_ADDRESS_ERROR)).toBeVisible();
      // The typed value stays in the field.
      await expect(admin.getByTestId("feed-source-address")).toHaveValue(
        refused,
      );
      await expect(admin).toHaveURL(/\/materials\/sources\/create$/);
    }
    await shot(admin, "sources-create-refused");
    expect(await storedAddresses(admin)).toEqual(before);
  });

  test("EARS-21: t.me/bbmacademy is added switched on and checked at once; the same channel again is refused as listed", async () => {
    await admin.goto("/materials/sources/create");
    await submitAddress(admin, "https://t.me/BBMAcademy");
    await admin.waitForURL(/\/materials\/sources$/);
    const added = row(admin, OFFICIAL);
    await expect(added).toBeVisible();
    await expect(cell(admin, `feed-source-row-${OFFICIAL}`)).toHaveText(
      `t.me/${OFFICIAL}`,
    );
    await expect(added.getByText("Telegram")).toBeVisible();
    await expect(cell(admin, `feed-source-state-${OFFICIAL}`)).toHaveText(
      "Включён",
    );
    await expect(cell(admin, `feed-source-status-${OFFICIAL}`)).toHaveText(
      NOT_CONNECTED,
    );
    await expect(cell(admin, `feed-source-checked-${OFFICIAL}`)).not.toHaveText(
      "Ещё не проверялся",
    );
    await expect(cell(admin, `feed-source-count-${OFFICIAL}`)).toHaveText("0");
    // No «Публикации» action yet (#3996): exactly the two row actions.
    await expect(added.getByRole("button")).toHaveText([
      "Изменить адрес",
      "Выключить",
    ]);
    await expect(added.getByRole("link")).toHaveCount(0);
    await shot(admin, "sources-list");

    const before = await storedAddresses(admin);
    await admin.goto("/materials/sources/create");
    await submitAddress(admin, `@${OFFICIAL}`);
    await expect(
      admin.getByText(FEED_SOURCE_ADDRESS_TAKEN_ERROR),
    ).toBeVisible();
    await expect(admin.getByTestId("feed-source-address")).toHaveValue(
      `@${OFFICIAL}`,
    );
    await expect(admin.getByTestId("create-error")).toHaveCount(0);
    await shot(admin, "sources-create-taken");
    expect(await storedAddresses(admin)).toEqual(before);
  });

  test("EARS-21: «Изменить адрес» refuses a bad address at the field, then changes it", async () => {
    await openSources(admin);
    await cell(admin, `feed-source-edit-${OFFICIAL}`).click();
    const dialog = admin.getByTestId("feed-source-edit-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("feed-source-address")).toHaveValue(
      `t.me/${OFFICIAL}`,
    );
    await dialog.getByTestId("feed-source-address").fill("t.me/+AbCdEfGhIjK");
    await dialog.getByTestId("submit-feed-source").click();
    await expect(dialog.getByText(FEED_SOURCE_ADDRESS_ERROR)).toBeVisible();
    await expect(dialog.getByTestId("feed-source-address")).toHaveValue(
      "t.me/+AbCdEfGhIjK",
    );
    await shot(admin, "sources-edit-refused");

    await dialog.getByTestId("feed-source-address").fill(`@${moved}`);
    await dialog.getByTestId("submit-feed-source").click();
    await expect(dialog).toBeHidden();
    await expect(admin.getByTestId("feed-source-notice")).toContainText(
      "Адрес источника изменён.",
    );
    await expect(cell(admin, `feed-source-row-${moved}`)).toHaveText(
      `t.me/${moved}`,
    );
    await expect(cell(admin, `feed-source-row-${OFFICIAL}`)).toHaveCount(0);
    // The edit runs the check again, at once, for the new address.
    await expect(cell(admin, `feed-source-status-${moved}`)).toHaveText(
      NOT_CONNECTED,
    );
  });

  test("EARS-22: «Выключить» asks first, then the source reads «Выключен»; «Включить» turns it back on", async () => {
    await openSources(admin);
    await cell(admin, `feed-source-disable-${moved}`).click();
    const confirm = admin.getByTestId("feed-source-disable-dialog");
    await expect(confirm).toContainText(`Выключить t.me/${moved}?`);
    await expect(confirm).toContainText("уйдут из ленты Академии");
    await shot(admin, "sources-disable-confirm");

    // Cancel changes nothing.
    await confirm.getByRole("button", { name: "Отмена" }).click();
    await expect(confirm).toBeHidden();
    await expect(cell(admin, `feed-source-state-${moved}`)).toHaveText(
      "Включён",
    );

    await cell(admin, `feed-source-disable-${moved}`).click();
    await admin.getByTestId("feed-source-disable-confirm").click();
    await expect(confirm).toBeHidden();
    await expect(admin.getByTestId("feed-source-notice")).toContainText(
      `Источник t.me/${moved} выключен — его посты ушли из ленты.`,
    );
    await expect(cell(admin, `feed-source-state-${moved}`)).toHaveText(
      "Выключен",
    );
    await expect(cell(admin, `feed-source-enable-${moved}`)).toBeVisible();
    await shot(admin, "sources-disabled");

    await cell(admin, `feed-source-enable-${moved}`).click();
    await expect(admin.getByTestId("feed-source-notice")).toContainText(
      `Источник t.me/${moved} включён — его посты вернулись в ленту.`,
    );
    await expect(cell(admin, `feed-source-state-${moved}`)).toHaveText(
      "Включён",
    );
    await expect(cell(admin, `feed-source-disable-${moved}`)).toBeVisible();
  });

  test("EARS-23: a congress registrar sees no «Источники» and the server refuses the list", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const eventId = await createPublishedEvent(
      admin,
      `Конгресс источников ${Date.now()}`,
    );
    const slug = await eventSlugFromRoster(admin, eventId);
    const registrar = await bootstrapRegistrarAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(registrar.email, slug);

    const deskContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    try {
      const desk = await deskContext.newPage();
      await desk.setViewportSize(WIDE);
      await signInAsAdmin(desk, registrar);
      await desk.waitForURL(new RegExp(`/events/${eventId}/roster$`));
      await expect(desk.getByTestId("nav-materials")).toHaveCount(0);
      await expect(desk.getByText("Источники")).toHaveCount(0);

      await desk.goto("/materials/sources");
      await expect(desk.getByTestId("access-refused")).toHaveText(
        "У этой учётной записи нет доступа к этому разделу.",
      );
      await expect(desk.getByTestId("materials-subnav")).toHaveCount(0);
      const status = await desk.evaluate(
        async () =>
          (
            await fetch("/v1/admin/feed-sources", {
              credentials: "include",
              headers: { accept: "application/json" },
            })
          ).status,
      );
      expect(status).toBe(403);
    } finally {
      await deskContext.close();
    }
  });
});
