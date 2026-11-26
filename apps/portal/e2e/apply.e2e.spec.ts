import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";

/**
 * 033 — «Подать заявку» (`academy.doctor.school/apply`) in a real browser on
 * the portal's backend-free CI tier (`playwright.ci.config.ts`).
 *
 * The page is server-rendered against the tier's session double
 * (`packages/e2e/doubles/storefront-session-api.mjs`): no `__Host-ds_session`
 * cookie ⇒ a guest and the account gate; the cookie ⇒ a signed-in doctor whose
 * profile (name + email) and the public specialty book feed the form. The
 * browser half of the page talks to `/v1/me/applications*` same-origin; this
 * spec answers those calls at the browser boundary with the contract's shapes
 * (`packages/schemas/src/applications/`), so each state of the page — field
 * refusal, server failure + retry, sent, repeat banner — is reachable
 * deterministically. The api side of those answers is proven by the api e2e
 * (`apps/api/test/applications/**`); the sign-in round trip through the sign-in
 * host is the live spec `apply-sign-in-live.spec.ts`.
 */

const PATH = "/apply";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SESSION_COOKIE = "__Host-ds_session";
const APPLICATION_ID = "00000000-0000-4000-8000-0000000000a1";

async function signIn(context: BrowserContext, baseURL: string | undefined) {
  const { hostname } = new URL(baseURL ?? "http://127.0.0.1");
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: "e2e-apply-probe",
      // `__Host-` is origin-locked: no Domain attribute on the wire, Path=/,
      // Secure — and a loopback origin counts as a secure context.
      domain: hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** The applicant's own open author applications (EARS-10 read). */
async function answerOwnApplications(
  page: Page,
  items: { id: string; submittedAt: string; topic: string }[],
) {
  await page.route("**/v1/me/applications?kind=author", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: items.map((i) => ({ ...i, state: "received" })),
      }),
    }),
  );
}

/** Every POST of the author application, in order. */
function recordSubmissions(page: Page): Request[] {
  const posts: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/v1/me/applications/author"))
      posts.push(r);
  });
  return posts;
}

async function fillValid(page: Page) {
  await page.getByLabel(/^Тема/).fill("Ортобиология в амбулаторной практике");
  await page.getByRole("button", { name: "курс-сериал" }).click();
  await page.getByLabel("О себе").fill("Травматолог, 12 лет практики");
  // Ticked through its label — the checkbox primitive's own hit area (its
  // input is visually hidden).
  await page
    .getByText("Согласие на обработку персональных данных из заявки", {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Согласие на обработку персональных данных из заявки",
    }),
  ).toBeChecked();
}

async function expectNoHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // #2189 — the shared shell's BBM topbar keeps its owner-accepted canvas
    // contrast; leaf-scoped, every interactive shell control stays IN the scan.
    .exclude('[data-testid="shell-topbar"]')
    // #2180 — the footer's giant wordmark is aria-hidden decoration at the
    // canvas-drawn alpha; its accessible form is the logo image beside it.
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.flatMap((n) => n.target) }));
  expect(serious, `axe serious/critical violations on ${label}`).toEqual([]);
}

test.describe("033 «Подать заявку» — guest", () => {
  test("EARS-1: the page shows «Заявка автора», «Что будет дальше» and «Условия автора», and names no producer", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(
      page.getByRole("heading", { level: 1, name: "Заявка автора" }),
    ).toBeVisible();
    const path = page.getByRole("region", { name: "Что будет дальше" });
    await expect(path).toContainText("Разбор заявки");
    await expect(path).toContainText("Публикация");
    await expect(
      page.getByRole("region", { name: "Условия автора" }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/продюсер/i);
    await expect(page.locator("main")).not.toContainText("Куда можно вырасти");
  });

  test("EARS-3: a guest gets the account gate with one «Войти / Регистрация» action returning to /apply, and no form field", async ({
    page,
  }) => {
    await page.goto(PATH);
    const gate = page.getByTestId("apply-gate");
    await expect(
      gate.getByRole("heading", { name: "Войдите, чтобы отправить заявку" }),
    ).toBeVisible();
    const action = gate.getByRole("link", { name: "Войти / Регистрация" });
    await expect(action).toHaveCount(1);
    const href = new URL(
      (await action.getAttribute("href")) ?? "",
      "http://x.test",
    );
    expect(href.searchParams.get("returnTo")).toBe(PATH);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("EARS-22: at 390 px the page with the gate does not scroll horizontally and passes axe", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);
    await expect(page.getByTestId("apply-gate")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAxeClean(page, "/apply guest gate at 390 px");
  });
});

test.describe("033 «Подать заявку» — signed in", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL);
  });

  test("EARS-4: the form is shown under the account, required fields marked, and passes axe at 390 px", async ({
    page,
  }) => {
    await answerOwnApplications(page, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);
    await expect(
      page.getByText("Отправите как Анна Петрова · doctor@example.test"),
    ).toBeVisible();
    await expect(page.getByLabel("Тема обязательно")).toBeVisible();
    await expect(page.getByRole("group", { name: /Формат/ })).toContainText(
      "обязательно",
    );
    await page.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Кардиология" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("apply-gate")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAxeClean(page, "/apply form at 390 px");
  });

  test("EARS-5: an empty topic and unticked consent send nothing, the errors sit next to the fields and the typed values stay", async ({
    page,
  }) => {
    await answerOwnApplications(page, []);
    const posts = recordSubmissions(page);
    await page.goto(PATH);
    await page.getByRole("button", { name: "подкаст" }).click();
    await page.getByLabel("О себе").fill("Травматолог");
    await page.getByRole("button", { name: "Отправить заявку" }).click();

    await expect(page.getByText("Укажите тему заявки")).toBeVisible();
    await expect(
      page.getByText("Отметьте согласие — без него заявку не отправить."),
    ).toBeVisible();
    await expect(page.getByLabel(/^Тема/)).toBeFocused();
    await expect(page.getByLabel("О себе")).toHaveValue("Травматолог");
    await expect(page.getByRole("button", { name: "подкаст" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(posts).toHaveLength(0);
    await expectAxeClean(page, "/apply form with field errors");
  });

  test("EARS-5: a 400 with field errors is shown next to the same field and keeps the input", async ({
    page,
  }) => {
    await answerOwnApplications(page, []);
    // `ApplicationRefusal` — the api's 400 naming the specialty it does not know.
    await page.route("**/v1/me/applications/author", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          problems: [{ code: "SPECIALTY_UNKNOWN", field: "specialtyCode" }],
        }),
      }),
    );
    await page.goto(PATH);
    await fillValid(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Кардиология" }).click();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(
      page.getByText("Выберите специальность из списка"),
    ).toBeVisible();
    await expect(page.getByLabel(/^Тема/)).toHaveValue(
      "Ортобиология в амбулаторной практике",
    );
    await expect(page.getByLabel("О себе")).toHaveValue(
      "Травматолог, 12 лет практики",
    );
  });

  test("EARS-8: a server failure keeps the input and the retry resends with the same idempotency key", async ({
    page,
  }) => {
    await answerOwnApplications(page, []);
    const posts = recordSubmissions(page);
    let answered = 0;
    await page.route("**/v1/me/applications/author", (route) => {
      answered += 1;
      return answered === 1
        ? route.fulfill({ status: 503, body: "" })
        : route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              id: APPLICATION_ID,
              submittedAt: "2026-11-25T10:00:00.000Z",
            }),
          });
    });
    await page.goto(PATH);
    await fillValid(page);
    await page.getByRole("button", { name: "Отправить заявку" }).click();

    await expect(
      page.getByText("Не удалось отправить — сервер недоступен."),
    ).toBeVisible();
    await expect(page.getByLabel(/^Тема/)).toHaveValue(
      "Ортобиология в амбулаторной практике",
    );
    await expectAxeClean(page, "/apply server-failure state");

    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
    expect(posts).toHaveLength(2);
    const [first, second] = posts.map((p) => p.headers()["idempotency-key"]);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  test("EARS-9: a sent application replaces the form; «Отправить ещё одну заявку» opens an empty form with a new key", async ({
    page,
  }) => {
    await answerOwnApplications(page, []);
    const posts = recordSubmissions(page);
    await page.route("**/v1/me/applications/author", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: APPLICATION_ID,
          submittedAt: "2026-11-25T10:00:00.000Z",
        }),
      }),
    );
    await page.goto(PATH);
    await fillValid(page);
    // EARS-8 — a double tap sends one request.
    await page
      .getByRole("button", { name: "Отправить заявку" })
      .dblclick();
    await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
    await expect(page.getByText(/Письмо «Заявка получена»/)).toBeVisible();
    expect(posts).toHaveLength(1);
    await expectAxeClean(page, "/apply sent state");

    await page
      .getByRole("button", {
        name: "Отправить ещё одну заявку — про другой проект",
      })
      .click();
    await expect(page.getByLabel(/^Тема/)).toHaveValue("");
    await fillValid(page);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.headers()["idempotency-key"]).not.toBe(
      posts[0]!.headers()["idempotency-key"],
    );
  });

  test("EARS-10: an expert with an open application sees the repeat banner above the form, which stays", async ({
    page,
  }) => {
    await answerOwnApplications(page, [
      {
        id: APPLICATION_ID,
        submittedAt: "2026-11-24T10:00:00.000Z",
        topic: "Ортобиология",
      },
    ]);
    await page.goto(PATH);
    await expect(
      page.getByText("Ваша предыдущая заявка в работе."),
    ).toBeVisible();
    await expect(
      page.getByText("Новую можно отправить, если это другой проект."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Отправить заявку" }),
    ).toBeEnabled();
    await expectAxeClean(page, "/apply with the repeat banner");
  });

  test("EARS-10: a failed read of the own applications hides the banner and keeps the form", async ({
    page,
  }) => {
    await page.route("**/v1/me/applications?kind=author", (route) =>
      route.fulfill({ status: 503, body: "" }),
    );
    await page.goto(PATH);
    await expect(
      page.getByRole("button", { name: "Отправить заявку" }),
    ).toBeVisible();
    await expect(page.getByText("Ваша предыдущая заявка в работе.")).toHaveCount(
      0,
    );
  });
});
