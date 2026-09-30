import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";
import {
  REGISTRATION_URL,
  closeOralIntake,
  createCongressEvent,
  mailedCode,
  provisionDoctor,
  registerForCongress,
  returnForRevision,
  sendTalkThroughApi,
  signInInPage,
  type CongressDoctor,
} from "./support/congress-stand";

/**
 * 046 V-15 (#2433) — «Мои заявки на Конгресс» on the doctor storefront, driven
 * end to end on the production build against a real api, database and Mailpit.
 *
 * What the tier proves (EARS-4…EARS-13):
 *   (a) a guest opening `/account/congress` is sent to the login door, signs in
 *       by the EMAILED CODE and lands back on the section (EARS-4);
 *   (b) an account with no congress registration sees only the one line and
 *       the link to the congress site's registration (EARS-5);
 *   (c) a registered participant starts an oral talk (author 1 prefilled from
 *       the registration answers), types, reloads and finds the text autosaved,
 *       sends it (consent + confirmation) and sees «Отправлена»; takes it back
 *       while the intake is open → «Черновик»; after the intake closes the draft
 *       shows why it cannot be sent and has no send action, and a sent talk
 *       offers «Отозвать» → «Отозвана» with no action left (EARS-6…EARS-13);
 *   (d) a talk returned for revision shows its deadline with the countdown, an
 *       expired one the «Срок доработки истёк» line (EARS-11).
 *
 * Why a LIVE tier: every state is an api decision over real rows (intake window,
 * registration, status machine); a double would assert its own fixture. The
 * fixtures and what goes through the database are documented in
 * `support/congress-stand.ts`.
 *
 * ENV SET (`playwright.congress.config.ts`): `E2E_DOCTOR_URL`, `MAILPIT_URL`,
 * `IDP_ISSUER`, `DATABASE_URL` (the stand's branch database). Bare CI → inert
 * green; a half-exported env fails loudly by variable name
 * (`support/live-stand-env.ts`), whose stand preconditions apply (raised
 * rate-limit ceilings; bot protection in its stand bypass mode, the doctor host
 * built with an empty `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`), and the api booted
 * with `MAILER_DOCTOR_BASE_URL` (a required api variable, 046 EARS-15). The
 * submission consent version needs no setting: the api stamps it from the
 * `@ds/legal-content` consent document (046 EARS-16).
 *
 * STAND TRAP — bind the doctor server to IPv4 (`HOSTNAME=127.0.0.1`): bound
 * dual-stack it forwards the client as `::ffff:127.0.0.1`, the session
 * fingerprint (IP/24) no longer matches and every signed-in server read
 * degrades to the guest answer.
 *
 * Harness (dev stand, production build of the doctor host, api on :3000):
 *   E2E_DOCTOR_URL=http://127.0.0.1:3004 IDP_ISSUER=… MAILPIT_URL=… \
 *   DATABASE_URL=<branch database> pnpm --filter @ds/doctor test:e2e:congress
 */

requireLiveStandEnv(["E2E_DOCTOR_URL", "MAILPIT_URL", "IDP_ISSUER", "DATABASE_URL"]);

const SECTION = "/account/congress";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });

let eventId = "";

test.beforeAll(async () => {
  eventId = await createCongressEvent();
});

/** The list row of the talk titled `title`. */
function row(page: Page, title: string) {
  return page.getByTestId("congress-row").filter({ hasText: title });
}

/**
 * Tick the EARS-16 consent the way a user does. The DS `Checkbox` is a real
 * checkbox rendered `sr-only` behind its painted box (see
 * `register-medworker.spec.ts`), so the click lands on the box — the left edge
 * of the wrapping `<label>`, clear of the policy link inside its text.
 */
async function tickConsent(page: Page) {
  const box = page.getByRole("checkbox", { name: /Согласие на обработку/ });
  await box.locator("xpath=ancestor::label[1]").click({ position: { x: 8, y: 10 } });
  await expect(box).toBeChecked();
}

/** Back from a talk to the section's list. */
async function toList(page: Page) {
  await page.getByRole("button", { name: "← Мои заявки" }).first().click();
  await expect(page.getByRole("heading", { name: "Мои заявки", exact: true })).toBeVisible();
}

test("046 EARS-4: a guest is sent to the login door, signs in by the emailed code and lands back on the section", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const doctor = await provisionDoctor("guest");
  expect(await context.cookies()).toHaveLength(0);

  await page.goto(SECTION);
  await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount%2Fcongress$/);

  await page.getByTestId("login-method-otp").click();
  await page.getByTestId("otp-identifier").fill(doctor.email);
  const sentAt = Date.now();
  await page.getByTestId("otp-send").click();
  const code = await mailedCode(doctor.email, "login", sentAt);
  await expect(page.getByTestId("otp-sent-to")).toBeVisible();
  await expect(page.getByTestId("otp-verify")).toBeVisible();
  // A complete code submits itself (the door's auto-submit), no click needed.
  await page.getByRole("textbox").first().fill(code);

  await expect(page).toHaveURL(new RegExp(`${SECTION}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Мои заявки на Конгресс" })).toBeVisible();
});

test("046 EARS-5: without a congress registration the section shows only the line and the registration link", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const doctor = await provisionDoctor("noreg");
  await signInInPage(page, doctor);
  await page.goto(SECTION);

  await expect(page.getByText("Сначала зарегистрируйтесь участником Конгресса")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Регистрация на сайте Конгресса/ }),
  ).toHaveAttribute("href", REGISTRATION_URL);
  await expect(page.getByTestId("congress-pick-oral")).toHaveCount(0);
  await expect(page.getByTestId("congress-row")).toHaveCount(0);
});

test.describe("a registered participant", () => {
  let author: CongressDoctor;
  const TALK = "PRP при латеральном эпикондилите: результаты 120 пациентов";
  const LATE = "Черновик, который не успели отправить";

  test.beforeAll(async () => {
    author = await provisionDoctor("author");
    await registerForCongress(author, eventId);
  });

  test("046 EARS-6: choosing the oral kind opens a draft with author 1 prefilled from the registration", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    const oral = page.getByTestId("congress-pick-oral");
    await expect(oral).toContainText("Устный доклад");
    // S2 offers only the oral form: poster and abstracts show their EARS-10
    // intake line but are not startable; no generic «opens later» line.
    await expect(page.getByTestId("congress-pick-poster")).toContainText(
      "Дату открытия приёма объявят позже",
    );
    await expect(page.getByText(/откроется позже/)).toHaveCount(0);
    await expect(
      page.getByTestId("congress-pick-poster").getByRole("button", { name: "Начать заявку →" }),
    ).toHaveCount(0);
    await oral.getByRole("button", { name: "Начать заявку →" }).click();

    await expect(page.getByTestId("congress-status-plate")).toHaveText("Черновик");
    await expect(page.getByText("Формат участия — очный")).toBeVisible();
    const first = page.getByTestId("congress-author").first();
    await expect(first).toContainText("Иванова Мария Петровна");
    await expect(first).toContainText("ГКБ № 1, Москва");
  });

  test("046 EARS-7: the draft is autosaved with no save button and survives a reload", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);
    await row(page, "Без темы").getByRole("button", { name: "Продолжить" }).click();

    await page.getByLabel("Тема").fill(TALK);
    await page.getByLabel("Образовательная цель").fill("Показания и отбор пациентов.");
    await page.getByLabel("Краткое содержание").fill("Материал, случаи, выводы.");
    await page.getByLabel("Краткое содержание").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText("Сохранено");
    await expect(page.getByRole("button", { name: /Сохранить/ })).toHaveCount(0);

    // The open talk is in the URL, so the reload comes back to the same form.
    await page.reload();
    await expect(page.getByLabel("Тема")).toHaveValue(TALK);
    await expect(page.getByLabel("Образовательная цель")).toHaveValue("Показания и отбор пациентов.");
    await expect(page.getByLabel("Краткое содержание")).toHaveValue("Материал, случаи, выводы.");
  });

  test("046 EARS-9: sending with the consent and the confirmation sets «Отправлена»", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);
    await row(page, TALK).getByRole("button", { name: "Продолжить" }).click();

    // Without the consent the send is refused next to the form.
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText("Дайте согласие на обработку персональных данных").first()).toBeVisible();

    // EARS-16 — the checkbox links to the organising committee's consent,
    // published as a platform document (feature 028) on this storefront.
    const consentLink = page.getByRole("link", { name: "обработку персональных данных" });
    await expect(consentLink).toHaveAttribute("href", "/documents/consent-congress-submissions");
    const consentPage = await page.request.get(
      new URL("/documents/consent-congress-submissions", page.url()).href,
    );
    expect(consentPage.status()).toBe(200);
    expect(await consentPage.text()).toContain(
      "Согласие на обработку персональных данных для заявок на Конгресс",
    );

    await tickConsent(page);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText("Отправить заявку в программный комитет?")).toBeVisible();
    await page.getByRole("button", { name: "Да, отправить" }).click();

    await expect(page.getByTestId("congress-status-plate")).toHaveText("Отправлена");
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toHaveCount(0);
    await toList(page);
    await expect(row(page, TALK)).toHaveAttribute("data-status", "submitted");
  });

  test("046 EARS-12: «Забрать на исправление» returns a sent talk to a draft while the intake is open", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    await row(page, TALK).getByRole("button", { name: "Забрать на исправление" }).click();
    // The talk opens again as an editable draft (the canvas «withdraw» frame).
    await expect(page.getByTestId("congress-status-plate")).toHaveText("Черновик");
    await expect(page.getByLabel("Тема")).toBeEditable();
    await toList(page);
    await expect(row(page, TALK)).toHaveAttribute("data-status", "draft");
    await expect(row(page, TALK)).toContainText("Черновик");

    // Send it again, and leave a second draft unsent for the closed-kind leg.
    await sendAgainFromList(page, TALK);
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await page.getByTestId("congress-pick-oral").getByRole("button", { name: "Начать заявку →" }).click();
    await page.getByLabel("Тема").fill(LATE);
    await page.getByLabel("Тема").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText("Сохранено");
  });

  test("046 EARS-10: after the intake closes a draft says why and offers no send", async ({
    page,
  }) => {
    await closeOralIntake(eventId);
    await signInInPage(page, author);
    await page.goto(SECTION);

    await row(page, LATE).getByRole("button", { name: /Открыть|Продолжить/ }).click();
    await expect(page.getByText(/Приём устных докладов закрыт .* — отправить заявку нельзя/).first()).toBeVisible();
    // No ACTIVE send action: the panel keeps the button, disabled (canvas «приём закрыт»).
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
    await expect(page.getByTestId("congress-status-plate")).toHaveText("Черновик");
  });

  test("046 EARS-12: after the intake closes «Отозвать» sets «Отозвана», which offers no action", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    const sent = row(page, TALK);
    await expect(sent).toHaveAttribute("data-status", "submitted");
    await expect(sent.getByRole("button", { name: "Забрать на исправление" })).toHaveCount(0);
    await sent.getByRole("button", { name: "Отозвать" }).click();
    const ask = sent.getByRole("group", {
      name: "Отозвать заявку? Комитет её не рассмотрит, вернуть будет нельзя.",
    });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Отозвать" }).click();

    await expect(sent).toHaveAttribute("data-status", "withdrawn");
    await expect(sent).toContainText("Отозвана");
    await expect(sent.getByRole("button", { name: /Отозвать|Забрать на исправление|Продолжить|Удалить/ })).toHaveCount(0);
  });

  /** Open a draft from the list and send it through the confirmation. */
  async function sendAgainFromList(page: Page, title: string) {
    await row(page, title).getByRole("button", { name: "Продолжить" }).click();
    // The consent was taken with the first send (EARS-16: asked once per version).
    await expect(page.getByRole("checkbox", { name: /Согласие на обработку/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.getByRole("button", { name: "Да, отправить" }).click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText("Отправлена");
    await toList(page);
  }
});

test("046 EARS-11: a talk returned for revision shows its deadline with the countdown; an expired one says the term is over", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const reviewEvent = await createCongressEvent();
  const doctor = await provisionDoctor("revision");
  await registerForCongress(doctor, reviewEvent);
  await signInInPage(page, doctor);

  await sendTalkThroughApi(page, reviewEvent, "Доклад на доработке");
  await sendTalkThroughApi(page, reviewEvent, "Доклад с истёкшим сроком");
  await returnForRevision(reviewEvent, "Доклад на доработке", "Уточните выборку.", 2 * 86_400_000 + 5 * 3_600_000);
  await returnForRevision(reviewEvent, "Доклад с истёкшим сроком", "Добавьте выводы.", -3_600_000);

  await page.goto(SECTION);
  const open = row(page, "Доклад на доработке");
  await expect(open).toContainText("На доработке");
  await expect(open).toContainText("Уточните выборку.");
  // The date as the canvas writes it («2 октября»), the countdown beside it.
  await expect(open).toContainText(/Исправить и отправить до \d{1,2} [а-я]+, 23:59 МСК/);
  await expect(open).toContainText(/осталось \d+ (день|дня|дней) \d+ (час|часа|часов)/);
  await expect(open.getByRole("button", { name: /Продолжить/ })).toBeVisible();

  const expired = row(page, "Доклад с истёкшим сроком");
  await expect(expired).toContainText(/Срок доработки истёк \d{1,2} [а-я]+, 23:59 МСК — отправить заявку нельзя/);
});
