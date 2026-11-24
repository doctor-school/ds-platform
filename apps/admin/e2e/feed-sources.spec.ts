import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  FEED_SOURCE_ADDRESS_ERROR,
  FEED_SOURCE_ADDRESS_TAKEN_ERROR,
  FEED_VK_SOURCE_ADDRESS_ERROR,
  FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR,
} from "@ds/schemas";
import {
  ADMIN_ORIGIN,
  bootstrapRegistrarAccount,
  createPublishedEvent,
  eventSlugFromRoster,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { bindRegistrarToEvent } from "./support/event-grants";
import {
  editTelegramPost,
  hiddenAt,
  removeTelegramPosts,
  seedTelegramPosts,
} from "./support/feed-posts";
import {
  removeVkSources,
  restoreVkCallsThisMonth,
  seedVkEntries,
  seedVkSource,
  setVkCallsThisMonth,
  vkHiddenAt,
} from "./support/feed-vk";
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
 * «Публикации» (EARS-32, #3996): reached from the row action, the source's
 * posts newest first with the text, the date, the state and «Открыть в
 * Telegram ↗» (a new tab); «Скрыть из ленты» asks first (cancel changes
 * nothing), the post then reads «Скрыт» and stays listed; a post an edit from
 * the channel moved since the page was read is refused with the reason and
 * the list re-read; «Вернуть в ленту» returns it. The stand has no bot
 * connected, so the posts are stored as the connector stores them
 * (`support/feed-posts.ts`).
 *
 * The «Работает» verdict against a live bot is proven by the API e2e against
 * the Telegram double (#3994).
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

/**
 * 048 EARS-37 — every visible action on the page takes the focus from the
 * keyboard: each one is marked, then Tab walks the page from its start until
 * all are met (or the walk wraps), and the unmet ones are named.
 */
async function expectEveryActionTabReachable(page: Page): Promise<void> {
  const total = await page.evaluate(() => {
    const actions = [
      ...document.body.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) =>
        !el.matches(":disabled") &&
        el.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    );
    actions.forEach((el, n) => el.setAttribute("data-e2e-action", String(n)));
    (document.activeElement as HTMLElement | null)?.blur();
    return actions.length;
  });
  expect(total, `${page.url()} shows no action at all`).toBeGreaterThan(0);
  const met = new Set<string>();
  for (let press = 0; press < total * 3 && met.size < total; press += 1) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(
      () => document.activeElement?.getAttribute("data-e2e-action") ?? null,
    );
    if (at !== null) met.add(at);
  }
  const unmet = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll<HTMLElement>("[data-e2e-action]")]
        .filter((el) => !seen.includes(el.getAttribute("data-e2e-action")!))
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} «${(el.innerText || el.getAttribute("aria-label") || "").trim()}»`,
        ),
    [...met],
  );
  expect(unmet, `${page.url()}: actions the keyboard never reaches`).toEqual(
    [],
  );
}

/** Tab forward until `target` holds the focus (it must be reachable). */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let press = 0; press < 200; press += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`${page.url()}: the keyboard never reaches ${target}`);
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
    ).toHaveText(["Telegram", "VK"]);

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
    await expect(added.getByText("Telegram", { exact: true })).toBeVisible();
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
    // «Публикации» is a link to the source's posts; the two commands are buttons.
    await expect(added.getByRole("button")).toHaveText([
      "Изменить адрес",
      "Выключить",
    ]);
    await expect(added.getByRole("link")).toHaveText(["Публикации"]);
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
    await expect(dialog).toContainText(
      `Сейчас источник — t.me/${OFFICIAL}. Ссылки его постов в ленте поменяются на новый адрес.`,
    );
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

  test("EARS-32: «Публикации» lists the posts; «Скрыть из ленты» asks first and the post reads «Скрыт»; a moved post is refused; «Вернуть в ленту» returns it", async () => {
    const posts = await seedTelegramPosts(moved, [
      [
        1201,
        "Пост 1201 — анонс вебинара по кардиологии",
        "2026-11-10T09:00:00Z",
      ],
      [1202, "Пост 1202 — запись эфира уже доступна", "2026-11-12T15:30:00Z"],
    ]);
    const p1201 = posts[0]!;
    const p1202 = posts[1]!;
    try {
      await openSources(admin);
      await cell(admin, `feed-source-posts-${moved}`).click();
      await admin.waitForURL(/\/materials\/sources\/[0-9a-f-]{36}$/);
      await expect(
        admin.getByRole("heading", {
          level: 1,
          name: `Публикации · t.me/${moved}`,
        }),
      ).toBeVisible();
      await expect(
        visible(
          admin.getByText(
            "Пост, удалённый в Telegram, остаётся в ленте, пока его не скрыть.",
          ),
        ),
      ).toBeVisible();
      // Newest first, each with its state and the original in a new tab.
      const texts = admin
        .getByTestId("feed-posts-table")
        .locator('[data-testid^="feed-post-text-"]')
        .filter({ visible: true });
      await expect(texts).toHaveText([p1202.text, p1201.text]);
      await expect(cell(admin, `feed-post-state-${p1202.id}`)).toHaveText(
        "В ленте",
      );
      const original = cell(admin, `feed-post-original-${p1202.id}`);
      await expect(original).toHaveText("Открыть в Telegram ↗");
      await expect(original).toHaveAttribute(
        "href",
        `https://t.me/${moved}/1202`,
      );
      await expect(original).toHaveAttribute("target", "_blank");
      await expect(original).toHaveAttribute("rel", "noopener noreferrer");
      await shot(admin, "posts-list");

      // «Скрыть из ленты» asks first; cancel changes nothing.
      await cell(admin, `feed-post-hide-${p1202.id}`).click();
      const confirm = admin.getByTestId("feed-post-hide-dialog");
      await expect(confirm).toContainText("Скрыть пост из ленты?");
      await expect(confirm).toContainText(
        "Пост уйдёт из ленты Академии. В Telegram он останется.",
      );
      await shot(admin, "posts-hide-confirm");
      await confirm.getByRole("button", { name: "Отмена" }).click();
      await expect(confirm).toBeHidden();
      expect(await hiddenAt(p1202.id)).toBeNull();

      await cell(admin, `feed-post-hide-${p1202.id}`).click();
      await admin.getByTestId("feed-post-hide-confirm").click();
      await expect(confirm).toBeHidden();
      await expect(admin.getByTestId("feed-post-notice")).toContainText(
        "Пост скрыт из ленты.",
      );
      await expect(cell(admin, `feed-post-state-${p1202.id}`)).toHaveText(
        "Скрыт",
      );
      await expect(cell(admin, `feed-post-unhide-${p1202.id}`)).toBeVisible();
      // Still listed, the sibling untouched.
      await expect(texts).toHaveText([p1202.text, p1201.text]);
      await expect(cell(admin, `feed-post-state-${p1201.id}`)).toHaveText(
        "В ленте",
      );
      expect(await hiddenAt(p1202.id)).not.toBeNull();
      await shot(admin, "posts-hidden");

      // An edit from the channel moves the row after the page read it: the
      // return is refused with the reason, nothing changes, the list re-reads.
      await editTelegramPost(p1202.id, "Пост 1202 — исправленный текст");
      await cell(admin, `feed-post-unhide-${p1202.id}`).click();
      await expect(admin.getByTestId("feed-post-error")).toContainText(
        "Пост только что изменился. Список обновлён — проверьте его и повторите.",
      );
      await expect(cell(admin, `feed-post-text-${p1202.id}`)).toHaveText(
        "Пост 1202 — исправленный текст",
      );
      await expect(cell(admin, `feed-post-state-${p1202.id}`)).toHaveText(
        "Скрыт",
      );
      expect(await hiddenAt(p1202.id)).not.toBeNull();
      await shot(admin, "posts-refused");

      await cell(admin, `feed-post-unhide-${p1202.id}`).click();
      await expect(admin.getByTestId("feed-post-notice")).toContainText(
        "Пост вернулся в ленту на свою дату.",
      );
      await expect(cell(admin, `feed-post-state-${p1202.id}`)).toHaveText(
        "В ленте",
      );
      expect(await hiddenAt(p1202.id)).toBeNull();
    } finally {
      await removeTelegramPosts(posts.map((p) => p.id));
    }
  });

  test("EARS-37: at 390 px «Источники» and «Публикации» do not scroll sideways and every action is reached and used from the keyboard", async () => {
    const posts = await seedTelegramPosts(moved, [
      [1301, "Пост 1301 — программа школы", "2026-11-14T09:00:00Z"],
      [1302, "Пост 1302 — итоги эфира", "2026-11-15T09:00:00Z"],
    ]);
    const p1302 = posts[1]!;
    try {
      await openSources(admin);
      // At a phone width the list renders its rows as cards.
      await admin.setViewportSize(NARROW);
      await expect(cell(admin, `feed-source-posts-${moved}`)).toBeVisible();
      await expectNoPageSideScroll(admin);
      await expectEveryActionTabReachable(admin);

      // «Публикации» is followed from the keyboard.
      await admin.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      await tabTo(admin, cell(admin, `feed-source-posts-${moved}`));
      await admin.keyboard.press("Enter");
      await admin.waitForURL(/\/materials\/sources\/[0-9a-f-]{36}$/);
      await expect(cell(admin, `feed-post-state-${p1302.id}`)).toHaveText(
        "В ленте",
      );
      await expectNoPageSideScroll(admin);
      await expectEveryActionTabReachable(admin);

      // «Скрыть из ленты» from the keyboard: the confirmation takes the focus,
      // Escape cancels with nothing changed, Enter on «Скрыть» hides the post.
      await admin.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      await tabTo(admin, cell(admin, `feed-post-hide-${p1302.id}`));
      await admin.keyboard.press("Enter");
      const confirm = admin.getByTestId("feed-post-hide-dialog");
      await expect(confirm).toBeVisible();
      await expect
        .poll(() =>
          confirm.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
      await expectNoPageSideScroll(admin);
      await admin.keyboard.press("Escape");
      await expect(confirm).toBeHidden();
      expect(await hiddenAt(p1302.id)).toBeNull();

      await tabTo(admin, cell(admin, `feed-post-hide-${p1302.id}`));
      await admin.keyboard.press("Enter");
      await expect(confirm).toBeVisible();
      await tabTo(admin, admin.getByTestId("feed-post-hide-confirm"));
      await admin.keyboard.press("Enter");
      await expect(confirm).toBeHidden();
      await expect(cell(admin, `feed-post-state-${p1302.id}`)).toHaveText(
        "Скрыт",
      );
      expect(await hiddenAt(p1302.id)).not.toBeNull();

      // «Вернуть в ленту» from the keyboard.
      await admin.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      await tabTo(admin, cell(admin, `feed-post-unhide-${p1302.id}`));
      await admin.keyboard.press("Enter");
      await expect(admin.getByTestId("feed-post-notice")).toContainText(
        "Пост вернулся в ленту на свою дату.",
      );
      await expect(cell(admin, `feed-post-state-${p1302.id}`)).toHaveText(
        "В ленте",
      );
      expect(await hiddenAt(p1302.id)).toBeNull();
    } finally {
      await admin.setViewportSize(WIDE);
      await removeTelegramPosts(posts.map((p) => p.id));
    }
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

/**
 * 048 slice 3 (#4004, V-33) — a VK community on «Источники» and «Публикации»
 * on the same real path. The stand's API has no VK connector configured, so
 * the at-once check of an added VK source reads «Ошибка: VK не подключён на
 * сервере»; the other five EARS-44 reasons, the bound community, its entries
 * and the month's call count are stored as the connector stores them
 * (`support/feed-vk.ts`) — their production is proven against the VK double
 * by the API e2e (V-25…V-30).
 */
test.describe("048 EARS-38, EARS-44, EARS-47, EARS-52 — VK on «Источники» and «Публикации»", () => {
  let adminContext: BrowserContext | undefined;
  let admin: Page;
  const run = Date.now().toString(36);
  const VK_OFFICIAL = "bbm.academy";
  const vkMoved = `bbm.e2e.${run}`;
  const REASONS = [
    "VK не подключён на сервере",
    "Сообщество не найдено",
    "Адрес сообщества изменился на vk.com/bbm.academy.new",
    "VK не присылает новые записи",
    "Лимит вызовов VK почти исчерпан",
    "VK недоступен",
  ];
  const reasonAddress = (n: number) => `vk.reason${n}.${run}`;
  const postsAddress = `vk.posts.${run}`;
  const owned = [
    VK_OFFICIAL,
    vkMoved,
    postsAddress,
    ...REASONS.map((_, n) => reasonAddress(n)),
  ];
  let callsBefore: number | null = null;

  test.beforeAll(async ({ browser }) => {
    // The official community may be left by an aborted earlier run.
    await removeVkSources(owned);
    callsBefore = await setVkCallsThisMonth(1234);
    adminContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    admin = await adminContext.newPage();
    await admin.setViewportSize(WIDE);
    await signInAsAdmin(admin);
  });

  test.afterAll(async () => {
    await adminContext?.close();
    await removeVkSources(owned);
    await restoreVkCallsThisMonth(callsBefore);
  });

  test("048 EARS-38: a VK wall, post, video or other-network link is refused at the «Адрес сообщества» field, nothing stored", async () => {
    await openSources(admin);
    const before = await storedAddresses(admin);
    await admin.goto("/materials/sources/create");
    await admin.getByTestId("feed-source-platform").selectOption("vk");
    await expect(admin.getByText("Адрес сообщества")).toBeVisible();
    await expect(admin.getByText("Например, vk.com/bbm.academy")).toBeVisible();
    for (const refused of [
      "https://vk.com/wall-211000111_501",
      "vk.com/bbm.academy?w=wall-211000111_501",
      "https://vk.com/video-211000111_456239017",
      "https://t.me/bbmacademy",
      "vk.com/a",
    ]) {
      await submitAddress(admin, refused);
      await expect(admin.getByText(FEED_VK_SOURCE_ADDRESS_ERROR)).toBeVisible();
      await expect(admin.getByTestId("feed-source-address")).toHaveValue(
        refused,
      );
      await expect(admin).toHaveURL(/\/materials\/sources\/create$/);
    }
    await shot(admin, "vk-create-refused");
    expect(await storedAddresses(admin)).toEqual(before);
  });

  test("048 EARS-38, EARS-44: vk.ru/bbm.academy is listed as vk.com/bbm.academy, checked at once, with the month's calls; the same community again is refused", async () => {
    await admin.goto("/materials/sources/create");
    await admin.getByTestId("feed-source-platform").selectOption("vk");
    await submitAddress(admin, "https://vk.ru/BBM.Academy");
    await admin.waitForURL(/\/materials\/sources$/);
    const added = row(admin, VK_OFFICIAL);
    await expect(added).toBeVisible();
    await expect(cell(admin, `feed-source-row-${VK_OFFICIAL}`)).toHaveText(
      `vk.com/${VK_OFFICIAL}`,
    );
    await expect(added.getByText("VK", { exact: true })).toBeVisible();
    await expect(cell(admin, `feed-source-state-${VK_OFFICIAL}`)).toHaveText(
      "Включён",
    );
    await expect(cell(admin, `feed-source-status-${VK_OFFICIAL}`)).toHaveText(
      "Ошибка: VK не подключён на сервере",
    );
    await expect(
      cell(admin, `feed-source-checked-${VK_OFFICIAL}`),
    ).not.toHaveText("Ещё не проверялся");
    const calls = admin.getByTestId("feed-sources-vk-calls");
    await expect(calls).toContainText(
      "Вызовов VK в этом месяце: 1 234 из 10 000",
    );
    await expect(calls).toHaveAttribute("data-state", "normal");
    await expect(calls).not.toContainText("Лимит почти исчерпан");
    await shot(admin, "vk-sources-listed");

    await admin.goto("/materials/sources/create");
    await admin.getByTestId("feed-source-platform").selectOption("vk");
    await submitAddress(admin, "vk.com/bbm.academy");
    await expect(
      admin.getByText(FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR),
    ).toBeVisible();
    await expect(admin).toHaveURL(/\/materials\/sources\/create$/);
    // The rule is per platform: on Telegram the same text reads the channel copy.
    await admin.getByTestId("feed-source-platform").selectOption("telegram");
    await expect(admin.getByText("Адрес канала")).toBeVisible();
    await submitAddress(admin, "vk.com/bbm.academy");
    await expect(admin.getByText(FEED_SOURCE_ADDRESS_ERROR)).toBeVisible();
  });

  test("048 EARS-38: «Изменить адрес» of a VK source says the entries already in the feed stay as they are, refuses a post link at the field, then changes it", async () => {
    await openSources(admin);
    await cell(admin, `feed-source-edit-${VK_OFFICIAL}`).click();
    const dialog = admin.getByTestId("feed-source-edit-dialog");
    // EARS-38 — a VK href is built from the bound community id: an address
    // edit rewrites no entry, so the dialog never promises new links.
    await expect(dialog).toContainText(
      `Сейчас источник — vk.com/${VK_OFFICIAL}. Записи, уже попавшие в ленту, не изменятся.`,
    );
    await expect(dialog).not.toContainText("Ссылки его постов");
    await expect(dialog.getByText("Адрес сообщества")).toBeVisible();
    await expect(dialog.getByTestId("feed-source-address")).toHaveValue(
      `vk.com/${VK_OFFICIAL}`,
    );
    await submitAddress(admin, "vk.com/wall-211000111_501");
    await expect(dialog.getByText(FEED_VK_SOURCE_ADDRESS_ERROR)).toBeVisible();
    await expect(dialog.getByTestId("feed-source-address")).toHaveValue(
      "vk.com/wall-211000111_501",
    );
    await shot(admin, "vk-edit-refused");
    await submitAddress(admin, `https://vk.com/${vkMoved.toUpperCase()}`);
    await expect(dialog).toBeHidden();
    await expect(admin.getByTestId("feed-source-notice")).toContainText(
      "Адрес источника изменён.",
    );
    await expect(cell(admin, `feed-source-row-${vkMoved}`)).toHaveText(
      `vk.com/${vkMoved}`,
    );
    const stored = await storedAddresses(admin);
    expect(stored).toContain(vkMoved);
    expect(stored).not.toContain(VK_OFFICIAL);
  });

  test("048 EARS-44: each of the six VK reasons reads «Ошибка: <reason>»; the month's line warns from 8 000", async () => {
    for (const [n, reason] of REASONS.entries()) {
      await seedVkSource(reasonAddress(n), { reason });
    }
    await openSources(admin);
    for (const [n, reason] of REASONS.entries()) {
      await expect(
        cell(admin, `feed-source-status-${reasonAddress(n)}`),
      ).toHaveText(`Ошибка: ${reason}`);
    }
    await shot(admin, "vk-sources-reasons");

    await setVkCallsThisMonth(8000);
    await admin.reload();
    const calls = admin.getByTestId("feed-sources-vk-calls");
    await expect(calls).toHaveAttribute("data-state", "warn");
    await expect(calls).toContainText(
      "Вызовов VK в этом месяце: 8 000 из 10 000. Лимит почти исчерпан.",
    );
    await shot(admin, "vk-sources-calls-warn");

    await setVkCallsThisMonth(7999);
    await admin.reload();
    await expect(calls).toHaveAttribute("data-state", "normal");
    await expect(calls).toContainText(
      "Вызовов VK в этом месяце: 7 999 из 10 000",
    );
  });

  test("048 EARS-47: «Публикации» of a VK source lists posts and videos with «Удалён в VK» and the VK note; a VK video is hidden and returned", async () => {
    const source = await seedVkSource(postsAddress, { reason: null });
    const [post, removed, video] = await seedVkEntries(source, [
      {
        kind: "post",
        objectId: 501,
        text: "Пост 501 — анонс школы кардиологии",
        at: "2026-11-10T09:00:00Z",
      },
      {
        kind: "post",
        objectId: 502,
        text: "Пост 502 — удалён со стены",
        at: "2026-11-11T09:00:00Z",
        removed: true,
      },
      {
        kind: "video",
        objectId: 456239017,
        text: "Видео — разбор клинического случая",
        at: "2026-11-12T09:00:00Z",
      },
    ]);
    await openSources(admin);
    await expect(cell(admin, `feed-source-status-${postsAddress}`)).toHaveText(
      "Работает",
    );
    await cell(admin, `feed-source-posts-${postsAddress}`).click();
    await admin.waitForURL(/\/materials\/sources\/[0-9a-f-]{36}$/);
    await expect(
      admin.getByRole("heading", {
        level: 1,
        name: `Публикации · vk.com/${postsAddress}`,
      }),
    ).toBeVisible();
    await expect(
      visible(
        admin.getByText(
          "Видео, удалённое в VK, остаётся в ленте, пока его не скрыть.",
        ),
      ),
    ).toBeVisible();
    await expect(cell(admin, `feed-post-kind-${post}`)).toHaveText("Пост");
    await expect(cell(admin, `feed-post-kind-${video}`)).toHaveText("Видео");
    await expect(cell(admin, `feed-post-state-${post}`)).toHaveText("В ленте");
    await expect(cell(admin, `feed-post-state-${removed}`)).toHaveText(
      "Удалён в VK",
    );
    await expect(cell(admin, `feed-post-state-${video}`)).toHaveText("В ленте");
    const original = cell(admin, `feed-post-original-${post}`);
    await expect(original).toHaveText("Открыть в VK ↗");
    await expect(original).toHaveAttribute(
      "href",
      `https://vk.com/wall-${source.groupId}_501`,
    );
    await expect(original).toHaveAttribute("target", "_blank");
    await expect(original).toHaveAttribute("rel", "noopener noreferrer");
    await expect(cell(admin, `feed-post-original-${video}`)).toHaveAttribute(
      "href",
      `https://vk.com/video-${source.groupId}_456239017`,
    );
    await expect(cell(admin, `feed-post-original-${video}`)).toHaveAttribute(
      "aria-label",
      /^Открыть видео от .+ в VK, откроется в новой вкладке$/,
    );
    await shot(admin, "vk-posts-list");

    await cell(admin, `feed-post-hide-${video}`).click();
    const confirm = admin.getByTestId("feed-post-hide-dialog");
    await expect(confirm).toContainText(
      "Пост уйдёт из ленты Академии. В VK он останется.",
    );
    await confirm.getByRole("button", { name: "Отмена" }).click();
    await expect(confirm).toBeHidden();
    expect(await vkHiddenAt(video!)).toBeNull();

    await cell(admin, `feed-post-hide-${video}`).click();
    await admin.getByTestId("feed-post-hide-confirm").click();
    await expect(confirm).toBeHidden();
    await expect(cell(admin, `feed-post-state-${video}`)).toHaveText("Скрыт");
    expect(await vkHiddenAt(video!)).not.toBeNull();
    await shot(admin, "vk-posts-video-hidden");

    await cell(admin, `feed-post-unhide-${video}`).click();
    await expect(admin.getByTestId("feed-post-notice")).toContainText(
      "Пост вернулся в ленту на свою дату.",
    );
    await expect(cell(admin, `feed-post-state-${video}`)).toHaveText("В ленте");
    expect(await vkHiddenAt(video!)).toBeNull();
  });

  test("048 EARS-52: at 390 px «Источники» with VK sources and «Публикации» of a VK source do not scroll sideways and every action is reached from the keyboard", async () => {
    try {
      await openSources(admin);
      await admin.setViewportSize(NARROW);
      await expect(admin.getByTestId("feed-sources-vk-calls")).toBeVisible();
      await expect(
        cell(admin, `feed-source-posts-${postsAddress}`),
      ).toBeVisible();
      await expectNoPageSideScroll(admin);
      await expectEveryActionTabReachable(admin);

      await admin.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      await tabTo(admin, cell(admin, `feed-source-posts-${postsAddress}`));
      await admin.keyboard.press("Enter");
      await admin.waitForURL(/\/materials\/sources\/[0-9a-f-]{36}$/);
      await expect(
        visible(admin.getByText("Удалён в VK", { exact: true })),
      ).toBeVisible();
      await expectNoPageSideScroll(admin);
      await expectEveryActionTabReachable(admin);
    } finally {
      await admin.setViewportSize(WIDE);
    }
  });
});
