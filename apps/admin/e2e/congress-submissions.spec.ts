import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bootstrapCommitteeAccount } from "./support/admin-session";
import { createPublishedEvent } from "./support/congress-roster";
import {
  authorSectionSubmission,
  congressAuthor,
  openOralIntake,
  sendOralSubmission,
  withdrawSubmission,
  type CongressAuthor,
} from "./support/congress-submissions";
import { bindCommitteeToEvent } from "./support/event-grants";
import { ADMIN_ORIGIN, signInAsAdmin } from "./support/sign-in";

/**
 * 046 V-17 (#2437) — the programme committee's admin, driven against the real
 * admin → api → Postgres chain. The platform administrator authors two
 * published events through the 007 form and opens event A's oral intake
 * through the 046 settings screen (EARS-2; the settings screen itself is
 * `congress-intake-settings.spec.ts`). A real doctor registers for event A and
 * writes and sends submissions through the cabinet section's own API; the
 * committee member is a real Zitadel account holding
 * `congress-program-committee`, bound to event A by the tech-lead SQL runbook.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… DATABASE_URL=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-submissions.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots (registry, card with
 * «Решение», card with the extension field, committee nav).
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

function headerLinks(page: Page) {
  return page.locator("header a");
}

/** The registry's row titles, in order (the table render ≥ md). */
function rowTitles(page: Page) {
  return page.locator("table tbody [data-testid='submissions-cell-title']");
}

/** Opens a row's card by its title. */
async function openCard(page: Page, title: string): Promise<void> {
  await page
    .locator("table tbody tr", { hasText: title })
    .locator("button")
    .first()
    .click();
  await expect(page.getByTestId("submission-card")).toBeVisible();
  await expect(page.getByTestId("submission-card-title")).toHaveText(title);
}

test.describe.configure({ mode: "serial" });

test.describe("046 V-17 — the programme committee decides on its event's submissions", () => {
  let eventA = "";
  let eventB = "";
  let revisionId = "";
  let author: CongressAuthor | undefined;
  let memberContext: BrowserContext | undefined;
  let member: Page;
  const stamp = Date.now();
  const alpha = `Тема Альфа ${stamp}`;
  const beta = `Тема Бета ${stamp}`;
  const gamma = `Тема Гамма ${stamp}`;
  const comment = "Сократите введение и добавьте данные о наблюдении.";

  test.afterAll(async () => {
    await author?.context.close();
    await memberContext?.close();
  });

  test("046 EARS-31 / EARS-27: a committee member sees only «Заявки» and filters the registry", async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await signInAsAdmin(page);
    eventA = await createPublishedEvent(page, `Конгресс PC A ${stamp}`);
    eventB = await createPublishedEvent(page, `Конгресс PC B ${stamp}`);
    await openOralIntake(page, eventA);
    // The administrator reaches «Заявки» from the event, beside the intake.
    await page.goto(`/events/${eventA}`);
    await expect(page.getByTestId("event-submissions-link")).toHaveAttribute(
      "href",
      `/events/${eventA}/submissions`,
    );
    await page.getByTestId("event-submissions-link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Заявки на Конгресс",
    );
    await expect(page.getByTestId("submissions-total")).toHaveText(
      "Найдено: 0",
    );
    const slugA = await page.evaluate(async (id) => {
      const res = await fetch(`/v1/admin/events/${id}/congress-submissions`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      return ((await res.json()) as { event: { slug: string } }).event.slug;
    }, eventA);

    author = await congressAuthor(browser, slugA, "Иванова Мария Петровна");
    revisionId = await sendOralSubmission(author, eventA, alpha);
    await sendOralSubmission(author, eventA, beta);
    const withdrawn = await sendOralSubmission(author, eventA, gamma);
    // The administrator takes it up in its card; the author then withdraws it
    // for good (a `submitted` one would go back to draft instead).
    await page.goto(`/events/${eventA}/submissions?submission=${withdrawn}`);
    await expect(page.getByTestId("submission-card-title")).toHaveText(gamma);
    await page
      .getByTestId("submission-decision-status")
      .selectOption("in_review");
    await page.getByTestId("submission-decision-submit").click();
    await expect(page.getByTestId("submission-card-status")).toHaveText(
      "На рассмотрении",
    );
    await withdrawSubmission(author, withdrawn);

    const committee = await bootstrapCommitteeAccount(ADMIN_ORIGIN);
    await bindCommitteeToEvent(committee.email, slugA);
    memberContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    member = await memberContext.newPage();
    await member.setViewportSize({ width: 1440, height: 900 });
    // One link to its name: the sign-in lands straight on it.
    await signInAsAdmin(member, committee);
    await member.waitForURL(new RegExp(`/events/${eventA}/submissions$`));

    // EARS-31 — exactly one link, «Заявки» of the bound event; no way back.
    await expect(headerLinks(member)).toHaveCount(1);
    await expect(member.getByTestId("nav-submissions")).toHaveText("Заявки");
    await expect(member.getByTestId("nav-submissions")).toHaveAttribute(
      "href",
      `/events/${eventA}/submissions`,
    );
    await expect(member.getByTestId("back-to-list")).toHaveCount(0);
    await shot(member, "committee-nav");

    // EARS-27 — every sent submission, the withdrawn one included; no draft.
    await expect(member.getByTestId("submissions-total")).toHaveText(
      "Найдено: 3",
    );
    await expect(member.locator("table thead th")).toHaveText([
      "№",
      "Вид",
      "Тема",
      "Подающий",
      "Статус",
      "Отправлена",
      "Изменена",
    ]);
    // Newest send first by default; the title sort reorders on the server.
    await expect(rowTitles(member)).toHaveText([gamma, beta, alpha]);
    await member.getByTestId("submissions-sort").selectOption("title");
    await member.getByTestId("submissions-order").selectOption("asc");
    await expect(rowTitles(member)).toHaveText([alpha, beta, gamma]);

    // Kind and status compose with each other and with the search.
    await member.getByTestId("submissions-kind").selectOption("oral");
    await member.getByTestId("submissions-status").selectOption("withdrawn");
    await expect(rowTitles(member)).toHaveText([gamma]);
    await member.getByTestId("submissions-status").selectOption("submitted");
    await expect(rowTitles(member)).toHaveText([alpha, beta]);
    await member
      .getByRole("searchbox", { name: "Поиск по теме и авторам" })
      .fill("Альфа");
    await expect(rowTitles(member)).toHaveText([alpha]);
    await member
      .getByRole("searchbox", { name: "Поиск по теме и авторам" })
      .fill("");
    await member.getByTestId("submissions-submitter").fill("нет-такого");
    await expect(member.getByTestId("submissions-total")).toHaveText(
      "Найдено: 0",
    );
    await member.getByTestId("submissions-submitter").fill(author.email);
    await expect(rowTitles(member)).toHaveText([alpha, beta]);
    await shot(member, "registry");

    // The client gate is a projection: the server refuses event B.
    await member.goto(`/events/${eventB}/submissions`);
    await expect(member.getByTestId("access-refused")).toBeVisible();
    const statuses = await member.evaluate(
      async (ids) => {
        const read = async (url: string) =>
          (
            await fetch(url, {
              credentials: "include",
              headers: { accept: "application/json" },
            })
          ).status;
        return {
          other: await read(`/v1/admin/events/${ids.b}/congress-submissions`),
          roster: await read(`/v1/admin/events/${ids.a}/roster`),
          own: await read(`/v1/admin/events/${ids.a}/congress-submissions`),
        };
      },
      { a: eventA, b: eventB },
    );
    expect(statuses).toEqual({ other: 403, roster: 403, own: 200 });
  });

  test("046 EARS-28: the member sets needs_revision with a comment; the card and the author's section show the deadline", async () => {
    test.setTimeout(180_000);
    await member.goto(`/events/${eventA}/submissions`);
    await openCard(member, alpha);

    // The extension is the administrator's alone.
    await expect(member.getByTestId("submission-extension")).toHaveCount(0);
    // The status control offers only the machine's edges from «Отправлена».
    await expect(
      member.getByTestId("submission-decision-status").locator("option"),
    ).toHaveText([
      "Выберите статус",
      "На рассмотрении",
      "Принята",
      "Отклонена",
      "На доработке",
    ]);

    // Reject path: «Отклонена» without a comment is refused before any write.
    await member
      .getByTestId("submission-decision-status")
      .selectOption("rejected");
    await member.getByTestId("submission-decision-submit").click();
    await expect(
      member.getByTestId("submission-decision-refused"),
    ).toContainText("Напишите комментарий для автора.");
    await expect(member.getByTestId("submission-card-status")).toHaveText(
      "Отправлена",
    );

    // Accept path: «На доработке» with the comment.
    await member
      .getByTestId("submission-decision-status")
      .selectOption("needs_revision");
    await member.getByTestId("submission-decision-comment").fill(comment);
    await shot(member, "card-decision");
    await member.getByTestId("submission-decision-submit").click();
    await expect(member.getByTestId("submission-card-status")).toHaveText(
      "На доработке",
    );
    await expect(member.getByTestId("submission-card-comment")).toHaveText(
      comment,
    );
    await expect(member.getByTestId("submission-card-revision")).toHaveText(
      /^до \d{2}\.\d{2}\.\d{4}, 23:59 МСК$/,
    );
    // The history names who and when.
    await expect(
      member.getByTestId("submission-card-history-entry").last(),
    ).toContainText("Отправлена → На доработке");
    // The registry row follows the card.
    await expect(
      member.locator("table tbody tr", { hasText: alpha }),
    ).toContainText("На доработке");

    // The author's section reads the same comment and that deadline.
    const seen = await authorSectionSubmission(author!, eventA, revisionId);
    expect(seen.status).toBe("needs_revision");
    expect(seen.committeeComment).toBe(comment);
    expect(seen.revisionDueAt).not.toBeNull();
    const dueDay = new Date(
      new Date(seen.revisionDueAt!).getTime() - 1,
    ).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
    await expect(member.getByTestId("submission-card-revision")).toHaveText(
      `до ${dueDay}, 23:59 МСК`,
    );

    // A withdrawn card offers no control at all.
    await member.keyboard.press("Escape");
    await openCard(member, gamma);
    await expect(
      member.getByTestId("submission-decision-withdrawn"),
    ).toHaveText("Отозвана автором — решение не принимается.");
    await expect(member.getByTestId("submission-decision-status")).toHaveCount(
      0,
    );
  });

  test("046 EARS-35: the platform administrator extends the revision deadline in the card", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    await page.goto(`/events/${eventA}/submissions?submission=${revisionId}`);
    await expect(page.getByTestId("submission-card-title")).toHaveText(alpha);
    const before = (
      await page.getByTestId("submission-card-revision").innerText()
    ).match(/(\d{2})\.(\d{2})\.(\d{4})/)!;
    const current = `${before[3]}-${before[2]}-${before[1]}`;

    // Reject path: a day that is not after the current one is refused.
    await page.getByTestId("submission-extension-day").fill(current);
    await page.getByTestId("submission-extension-submit").click();
    await expect(
      page.getByTestId("submission-extension-refused"),
    ).toContainText("Новый срок должен быть позже текущего.");

    const later = new Date(`${current}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 5);
    const next = later.toISOString().slice(0, 10);
    await page.getByTestId("submission-extension-day").fill(next);
    await shot(page, "card-extension");
    await page.getByTestId("submission-extension-submit").click();
    const [y, m, d] = next.split("-");
    await expect(page.getByTestId("submission-card-revision")).toHaveText(
      `до ${d}.${m}.${y}, 23:59 МСК`,
    );
    const seen = await authorSectionSubmission(author!, eventA, revisionId);
    expect(
      new Date(new Date(seen.revisionDueAt!).getTime() - 1).toLocaleDateString(
        "ru-RU",
        { timeZone: "Europe/Moscow" },
      ),
    ).toBe(`${d}.${m}.${y}`);
  });
});
