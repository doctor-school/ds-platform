import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";
import {
  REGISTRATION_URL,
  closeOralIntake,
  createCongressEvent,
  mailedCode,
  openAbstractIntake,
  openPosterIntake,
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
 *       expired one the «Срок доработки истёк» line (EARS-11);
 *   (e) V-16 poster part (#2434): the birth date asked inside the first poster
 *       draft and kept there, the poster sent, and the age refusal in a poster
 *       draft and on the kind choice (EARS-18…EARS-20);
 *   (f) V-16 abstracts part (#2435): the live total counter over 5 000, the
 *       statements and the consent at send, and «Подать тезисы по этой
 *       работе» from a sent talk (EARS-21…EARS-25).
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

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "MAILPIT_URL",
  "IDP_ISSUER",
  "DATABASE_URL",
]);

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
  await box
    .locator("xpath=ancestor::label[1]")
    .click({ position: { x: 8, y: 10 } });
  await expect(box).toBeChecked();
}

/** Back from a talk to the section's list. */
async function toList(page: Page) {
  await page.getByRole("button", { name: "← Мои заявки" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Мои заявки", exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Мои заявки на Конгресс" }),
  ).toBeVisible();
});

test("046 EARS-5: without a congress registration the section shows only the line and the registration link", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const doctor = await provisionDoctor("noreg");
  await signInInPage(page, doctor);
  await page.goto(SECTION);

  await expect(
    page.getByText("Сначала зарегистрируйтесь участником Конгресса"),
  ).toBeVisible();
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
    // Every kind shows its EARS-10 intake line; no generic «opens later» line.
    // The poster (S3) and abstract (S4) forms are offered — a draft may be
    // written before the kind's opening (EARS-6).
    await expect(page.getByTestId("congress-pick-poster")).toContainText(
      "Дату открытия приёма объявят позже",
    );
    await expect(page.getByText(/откроется позже/)).toHaveCount(0);
    await expect(
      page
        .getByTestId("congress-pick-abstract")
        .getByRole("button", { name: "Начать заявку →" }),
    ).toHaveCount(1);
    await oral.getByRole("button", { name: "Начать заявку →" }).click();

    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
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
    await row(page, "Без темы")
      .getByRole("button", { name: "Продолжить" })
      .click();

    await page.getByLabel("Тема").fill(TALK);
    await page
      .getByLabel("Образовательная цель")
      .fill("Показания и отбор пациентов.");
    await page
      .getByLabel("Краткое содержание")
      .fill("Материал, случаи, выводы.");
    await page.getByLabel("Краткое содержание").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText(
      "Сохранено",
    );
    await expect(page.getByRole("button", { name: /Сохранить/ })).toHaveCount(
      0,
    );

    // The open talk is in the URL, so the reload comes back to the same form.
    await page.reload();
    await expect(page.getByLabel("Тема")).toHaveValue(TALK);
    await expect(page.getByLabel("Образовательная цель")).toHaveValue(
      "Показания и отбор пациентов.",
    );
    await expect(page.getByLabel("Краткое содержание")).toHaveValue(
      "Материал, случаи, выводы.",
    );
  });

  test("046 EARS-9: sending with the consent and the confirmation sets «Отправлена»", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);
    await row(page, TALK).getByRole("button", { name: "Продолжить" }).click();

    // Without the consent the send is refused next to the form.
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(
      page.getByText("Дайте согласие на обработку персональных данных").first(),
    ).toBeVisible();

    // EARS-16 — the checkbox links to the organising committee's consent,
    // published as a platform document (feature 028) on this storefront.
    // `exact`: the DS error summary links «Дайте согласие на обработку …» to the box.
    const consentLink = page.getByRole("link", {
      name: "обработку персональных данных",
      exact: true,
    });
    await expect(consentLink).toHaveAttribute(
      "href",
      "/documents/consent-congress-submissions",
    );
    const consentPage = await page.request.get(
      new URL("/documents/consent-congress-submissions", page.url()).href,
    );
    expect(consentPage.status()).toBe(200);
    expect(await consentPage.text()).toContain(
      "Согласие на обработку персональных данных для заявок на Конгресс",
    );

    await tickConsent(page);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(
      page.getByText("Отправить заявку в программный комитет?"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Да, отправить" }).click();

    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Отправлена",
    );
    await expect(
      page.getByRole("button", { name: "Отправить", exact: true }),
    ).toHaveCount(0);
    await toList(page);
    await expect(row(page, TALK)).toHaveAttribute("data-status", "submitted");
  });

  test("046 EARS-12: «Забрать на исправление» returns a sent talk to a draft while the intake is open", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    await row(page, TALK)
      .getByRole("button", { name: "Забрать на исправление" })
      .click();
    // The talk opens again as an editable draft (the canvas «withdraw» frame).
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await expect(page.getByLabel("Тема")).toBeEditable();
    await toList(page);
    await expect(row(page, TALK)).toHaveAttribute("data-status", "draft");
    await expect(row(page, TALK)).toContainText("Черновик");

    // Send it again, and leave a second draft unsent for the closed-kind leg.
    await sendAgainFromList(page, TALK);
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await page
      .getByTestId("congress-pick-oral")
      .getByRole("button", { name: "Начать заявку →" })
      .click();
    await page.getByLabel("Тема").fill(LATE);
    await page.getByLabel("Тема").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText(
      "Сохранено",
    );
  });

  test("046 EARS-10: after the intake closes a draft says why and offers no send", async ({
    page,
  }) => {
    await closeOralIntake(eventId);
    await signInInPage(page, author);
    await page.goto(SECTION);

    await row(page, LATE)
      .getByRole("button", { name: /Открыть|Продолжить/ })
      .click();
    await expect(
      page
        .getByText(/Приём устных докладов закрыт .* — отправить заявку нельзя/)
        .first(),
    ).toBeVisible();
    // No ACTIVE send action: the panel keeps the button, disabled (canvas «приём закрыт»).
    await expect(
      page.getByRole("button", { name: "Отправить", exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
  });

  test("046 EARS-12: after the intake closes «Отозвать» sets «Отозвана», which offers no action", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    const sent = row(page, TALK);
    await expect(sent).toHaveAttribute("data-status", "submitted");
    await expect(
      sent.getByRole("button", { name: "Забрать на исправление" }),
    ).toHaveCount(0);
    await sent.getByRole("button", { name: "Отозвать" }).click();
    const ask = sent.getByRole("group", {
      name: "Отозвать заявку? Комитет её не рассмотрит, вернуть будет нельзя.",
    });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Отозвать" }).click();

    await expect(sent).toHaveAttribute("data-status", "withdrawn");
    await expect(sent).toContainText("Отозвана");
    await expect(
      sent.getByRole("button", {
        name: /Отозвать|Забрать на исправление|Продолжить|Удалить/,
      }),
    ).toHaveCount(0);
  });

  /** Open a draft from the list and send it through the confirmation. */
  async function sendAgainFromList(page: Page, title: string) {
    await row(page, title).getByRole("button", { name: "Продолжить" }).click();
    // The consent was taken with the first send (EARS-16: asked once per version).
    await expect(
      page.getByRole("checkbox", { name: /Согласие на обработку/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.getByRole("button", { name: "Да, отправить" }).click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Отправлена",
    );
    await toList(page);
  }
});

/**
 * 046 V-16, poster part (#2434) — the birth date asked once inside the first
 * poster draft, the poster form sent, and the age refusal in a poster draft and
 * on the kind choice (EARS-18…EARS-20). On a congress event of its own the
 * oral and poster intakes are open, the poster with an age limit of 40 years;
 * the event starts in a year.
 */
test.describe("a poster author", () => {
  const POSTER = "Аутологичная жировая ткань при гонартрозе II стадии";
  const MAX_AGE = 40;
  /** The date control's `YYYY-MM-DD` of a birth `years` years before today. */
  const bornYearsAgo = (years: number) => {
    const d = new Date();
    return `${d.getFullYear() - years}-06-15`;
  };
  let author: CongressDoctor;
  let senior: CongressDoctor;
  // Its own event (the section reads the latest congress): the oral intake of
  // the shared event is closed by the EARS-10 leg above.
  let posterEventId = "";

  test.beforeAll(async () => {
    posterEventId = await createCongressEvent();
    await openPosterIntake(posterEventId, MAX_AGE);
    author = await provisionDoctor("poster");
    await registerForCongress(author, posterEventId);
    senior = await provisionDoctor("senior");
    await registerForCongress(senior, posterEventId);
  });

  const posterCard = (page: Page) => page.getByTestId("congress-pick-poster");
  const startPoster = (page: Page) =>
    posterCard(page).getByRole("button", { name: "Начать заявку →" }).click();

  /** Write the birth date in the draft: the field saves on blur (EARS-19). */
  const writeBirth = async (page: Page, date: string) => {
    const birth = page.getByLabel("Дата рождения");
    await birth.fill(date);
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/v1/me/birth-date") && r.request().method() === "PUT",
    );
    await birth.blur();
    expect((await saved).status()).toBe(200);
  };

  test("046 EARS-19: starting a poster creates the draft at once; the draft asks for the birth date, refuses a send without it, and keeps the written date", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);

    await startPoster(page);
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    const birth = page.getByLabel("Дата рождения");
    await expect(birth).toHaveValue("");
    // The DS date control (owner Stage-B 2026-10-01): free text cannot land in it.
    await expect(birth).toHaveAttribute("type", "date");
    await expect(birth).toHaveAttribute("min", "1900-01-01");
    await expect(
      page.getByText(
        `Спрашиваем один раз — перед первым постером. Постерные доклады принимают от участников младше ${MAX_AGE} лет на дату начала Конгресса — `,
      ),
    ).toBeVisible();
    // EARS-18 — the poster form: authors in publication order, no speaker pick.
    await expect(page.getByLabel("Цель")).toBeVisible();
    await expect(page.getByLabel("Содержание")).toBeVisible();
    await expect(page.getByText("Порядок — как в публикации")).toBeVisible();
    await expect(page.getByText("Отметьте одного докладчика")).toHaveCount(0);
    await expect(page.getByText("Формат участия — очный")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Докладчик" })).toHaveCount(0);
    await expect(page.getByTestId("congress-author").first()).toContainText(
      "Иванова Мария Петровна",
    );

    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText("Укажите дату рождения").first()).toBeVisible();
    await expect(birth).toHaveAttribute("aria-invalid", "true");

    const date = bornYearsAgo(30);
    await writeBirth(page, date);

    // Stored on the account: the reload reads it back into the first poster draft.
    await page.reload();
    await expect(page.getByLabel("Дата рождения")).toHaveValue(date);
  });

  test("046 EARS-18: the poster is sent with its topic, authors, goal and content", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);
    await row(page, "Без темы")
      .getByRole("button", { name: "Продолжить" })
      .click();

    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText("Заполните поле «Цель»").first()).toBeVisible();
    await expect(
      page.getByText("Заполните поле «Содержание»").first(),
    ).toBeVisible();

    await page.getByLabel("Тема").fill(POSTER);
    await page.getByLabel("Цель").fill("Оценить эффект через 12 месяцев.");
    await page
      .getByLabel("Содержание")
      .fill("Материал, методы, результаты, выводы.");
    await page.getByLabel("Содержание").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText(
      "Сохранено",
    );
    await tickConsent(page);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.getByRole("button", { name: "Да, отправить" }).click();

    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Отправлена",
    );
    await toList(page);
    await expect(row(page, POSTER)).toHaveAttribute("data-status", "submitted");

    // Asked once: with a poster sent, a new poster draft does not ask again.
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await startPoster(page);
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await expect(page.getByLabel("Дата рождения")).toHaveCount(0);
  });

  test("046 EARS-20: a birth date at or above the limit refuses the draft's send, then turns the poster card into the refusal; the other kinds stay available", async ({
    page,
  }) => {
    await signInInPage(page, senior);
    await page.goto(SECTION);

    await startPoster(page);
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await writeBirth(page, bornYearsAgo(50));
    const refusal = new RegExp(
      `Постерные доклады принимают от участников младше ${MAX_AGE} лет на дату начала Конгресса — \\d{1,2} [а-я]+ \\d{4}\\. На эту дату вам будет 5\\d (год|года|лет)\\.`,
    );
    await expect(page.getByText(refusal).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Отправить", exact: true }),
    ).toBeDisabled();

    await toList(page);
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await expect(posterCard(page)).toContainText(refusal);
    await expect(posterCard(page).getByRole("button")).toHaveCount(0);
    await expect(
      page
        .getByTestId("congress-pick-oral")
        .getByRole("button", { name: "Начать заявку →" }),
    ).toBeEnabled();
  });

  test("046 EARS-20: correcting the date in a poster draft to one above the limit shows the refusal in place of the send", async ({
    page,
  }) => {
    // The date is shown for correction in the first poster draft (canvas
    // `askBirth`), so the leg starts a new author's first poster.
    const fresh = await provisionDoctor("poster-fix");
    await registerForCongress(fresh, posterEventId);
    await signInInPage(page, fresh);
    await page.goto(SECTION);
    await startPoster(page);
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await writeBirth(page, bornYearsAgo(30));

    const birth = page.getByLabel("Дата рождения");
    await birth.fill(bornYearsAgo(45));
    await birth.blur();

    await expect(
      page.getByText(/На эту дату вам будет 4\d (год|года|лет)\./).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Отправить", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Тема" })).toHaveCount(0);
    // The date stays correctable: back under the limit, the form opens again.
    await birth.fill(bornYearsAgo(30));
    await birth.blur();
    await expect(page.getByRole("textbox", { name: "Тема" })).toBeEditable();
    await expect(
      page.getByRole("button", { name: "Отправить", exact: true }),
    ).toBeEnabled();
  });
});

/**
 * 046 V-16, abstracts part (#2435) — the abstract form with its live total
 * counter over 5 000, the two statements and the consent at send, and
 * «Подать тезисы по этой работе» from a sent talk (EARS-21…25). On a congress
 * event of its own the oral and abstract intakes are open, abstracts limited
 * to 3 per account with the first-author rule on.
 */
test.describe("an abstract author", () => {
  const TALK = "PRP при латеральном эпикондилите: результаты 120 пациентов";
  let author: CongressDoctor;
  let abstractEventId = "";

  test.beforeAll(async () => {
    abstractEventId = await createCongressEvent();
    await openAbstractIntake(abstractEventId, 3);
    author = await provisionDoctor("abstract");
    await registerForCongress(author, abstractEventId);
  });

  const statement = (page: Page, name: string) =>
    page.getByRole("checkbox", { name });
  const tick = async (page: Page, name: string) => {
    const box = statement(page, name);
    await box
      .locator("xpath=ancestor::label[1]")
      .click({ position: { x: 8, y: 10 } });
    await expect(box).toBeChecked();
  };

  test("046 EARS-21…23: the abstract form counts its five sections together, refuses a text over 5 000 and a send without the statements, then sends", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await page.goto(SECTION);
    await page
      .getByTestId("congress-pick-abstract")
      .getByRole("button", { name: "Начать заявку →" })
      .click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await expect(
      page.getByRole("heading", { name: "Текст тезисов" }),
    ).toBeVisible();
    await expect(
      page.getByText("Пять разделов, всего до 5 000 знаков"),
    ).toBeVisible();

    const counter = page.getByTestId("congress-abstract-counter");
    await page.getByLabel("Название тезисов").fill("Тезисы о PRP");
    await page.getByLabel("Актуальность").fill("Актуальность.");
    await page.getByLabel("Цель", { exact: true }).fill("Цель.");
    await page.getByLabel("Материалы и методы").fill("Методы.");
    await page.getByLabel("Результаты и обсуждение").fill("р".repeat(4980));
    await page.getByLabel("Выводы").fill("Выводы.");
    // 13 + 5 + 7 + 4 980 + 7 = 5 012 — above the limit, counted live.
    await expect(counter).toContainText(/5\s012 \/ 5 000/);
    await expect(counter).toContainText("больше на 12");

    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const summary = page.locator(
      '[data-screen-label="d-lk-congress · сводка ошибок"]',
    );
    await expect(summary).toContainText(
      /Сократите текст тезисов до 5 000 знаков — сейчас 5\s012/,
    );
    await expect(summary).toContainText(
      "Подтвердите, что в тексте нет некорректных заимствований",
    );
    await expect(summary).toContainText(
      "Подтвердите, что в тексте нет торговых наименований",
    );
    await expect(summary).toContainText(
      "Дайте согласие на обработку персональных данных",
    );
    await expect(summary).toContainText("Текст заявки сохранён.");

    await page
      .getByLabel("Результаты и обсуждение")
      .fill("Результаты и обсуждение.");
    await page.getByLabel("Результаты и обсуждение").blur();
    await expect(counter).not.toContainText("больше на");
    await expect(page.getByTestId("congress-save-state")).toContainText(
      "Сохранено",
    );
    await tick(page, "В тексте нет некорректных заимствований");
    await tick(page, "В тексте нет торговых наименований");
    await tickConsent(page);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.getByRole("button", { name: "Да, отправить" }).click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Отправлена",
    );
  });

  test("046 EARS-22/9: on a 390px phone the counter keeps «N / 5 000» on one line and a failed send brings the focused error summary into view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInInPage(page, author);
    await page.goto(SECTION);
    // The author has sent an abstract above: a new one starts from the list.
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await page
      .getByTestId("congress-pick-abstract")
      .getByRole("button", { name: "Начать заявку →" })
      .click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await page.getByLabel("Название тезисов").fill("Тезисы на телефоне");
    // A section holds at most 5 000 itself: 4 000 + 1 022 = 5 022 together.
    await page.getByLabel("Результаты и обсуждение").fill("р".repeat(4000));
    await page.getByLabel("Материалы и методы").fill("м".repeat(1022));

    const total = page
      .getByTestId("congress-abstract-counter")
      .getByText(/5\s022 \/ 5\s000/);
    await expect(total).toBeVisible();
    // One line: the box is no taller than one line of its own text.
    const lines = await total.evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return Math.round(el.getBoundingClientRect().height / lh);
    });
    expect(lines).toBe(1);

    // Nothing of the counter («больше на N» included) runs under the button.
    const send = page.getByRole("button", { name: "Отправить", exact: true });
    const note = page
      .getByTestId("congress-abstract-counter")
      .getByText("больше на 22");
    const [noteBox, sendBox] = [
      await note.boundingBox(),
      await send.boundingBox(),
    ];
    expect(noteBox && sendBox).toBeTruthy();
    const overlaps =
      noteBox!.x < sendBox!.x + sendBox!.width &&
      sendBox!.x < noteBox!.x + noteBox!.width &&
      noteBox!.y < sendBox!.y + sendBox!.height &&
      sendBox!.y < noteBox!.y + noteBox!.height;
    expect(overlaps).toBe(false);

    await send.click();
    const summary = page.getByRole("alert", { name: /^Заявка не отправлена/ });
    await expect(summary).toBeFocused();
    await expect(summary).toBeInViewport();
    await expect(summary).toContainText(
      /Сократите текст тезисов до 5\s000 знаков — сейчас 5\s022/,
    );
  });

  test("046 EARS-25: «Подать тезисы по этой работе» on a sent talk creates the abstract draft prefilled with its title and authors", async ({
    page,
  }) => {
    await signInInPage(page, author);
    await sendTalkThroughApi(page, abstractEventId, TALK);
    await page.goto(SECTION);
    await row(page, TALK)
      .getByRole("button", { name: "Подать тезисы по этой работе" })
      .click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await expect(page.getByLabel("Название тезисов")).toHaveValue(TALK);
    await expect(page.getByTestId("congress-author").first()).toContainText(
      "Иванова Мария",
    );
    await expect(page.getByRole("radio", { name: "Докладчик" })).toHaveCount(0);
    await expect(page.getByLabel("Актуальность")).toHaveValue("");
  });

  test("046 EARS-17/12: a send counts on the kind choice at once, with no reload; «Забрать на исправление» takes it off the count and ends the sent notice", async ({
    page,
  }) => {
    const SENT = "Отправлено 1 тезис из 3";
    await signInInPage(page, author);
    await page.goto(SECTION);
    // One abstract was sent by the first test of this author.
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    const tile = page.getByTestId("congress-pick-abstract");
    await expect(tile).toContainText(SENT);
    await tile.getByRole("button", { name: "Начать заявку →" }).click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await page.getByLabel("Название тезисов").fill("Тезисы о счётчике");
    await page.getByLabel("Актуальность").fill("Актуальность.");
    await page.getByLabel("Цель", { exact: true }).fill("Цель.");
    await page.getByLabel("Материалы и методы").fill("Методы.");
    await page.getByLabel("Результаты и обсуждение").fill("Результаты.");
    await page.getByLabel("Выводы").fill("Выводы.");
    await page.getByLabel("Выводы").blur();
    await expect(page.getByTestId("congress-save-state")).toContainText(
      "Сохранено",
    );
    await tick(page, "В тексте нет некорректных заимствований");
    await tick(page, "В тексте нет торговых наименований");
    // The consent was given with the first send — it is not asked again.
    await expect(
      page.getByRole("checkbox", { name: /Согласие на обработку/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.getByRole("button", { name: "Да, отправить" }).click();
    const notice = page.getByText(/^Заявка отправлена\./);
    await expect(notice).toBeVisible();

    // The kind choice reached the author's way reads the new count.
    await toList(page);
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await expect(tile).toContainText("Отправлено 2 тезиса из 3");

    // Take it back from its detail: the draft opens without the sent notice,
    // and the count drops on the next visit to the kind choice.
    await row(page, "Тезисы о счётчике").click();
    await page.getByRole("button", { name: "Забрать на исправление" }).click();
    await expect(page.getByTestId("congress-status-plate")).toHaveText(
      "Черновик",
    );
    await expect(notice).toHaveCount(0);
    await toList(page);
    await page.getByRole("button", { name: "+ Новая заявка" }).click();
    await expect(tile).toContainText(SENT);
  });
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
  await returnForRevision(
    reviewEvent,
    "Доклад на доработке",
    "Уточните выборку.",
    2 * 86_400_000 + 5 * 3_600_000,
  );
  await returnForRevision(
    reviewEvent,
    "Доклад с истёкшим сроком",
    "Добавьте выводы.",
    -3_600_000,
  );

  await page.goto(SECTION);
  const open = row(page, "Доклад на доработке");
  await expect(open).toContainText("На доработке");
  await expect(open).toContainText("Уточните выборку.");
  // The date as the canvas writes it («2 октября»), the countdown beside it.
  await expect(open).toContainText(
    /Исправить и отправить до \d{1,2} [а-я]+, 23:59 МСК/,
  );
  await expect(open).toContainText(
    /осталось \d+ (день|дня|дней) \d+ (час|часа|часов)/,
  );
  await expect(open.getByRole("button", { name: /Продолжить/ })).toBeVisible();

  const expired = row(page, "Доклад с истёкшим сроком");
  await expect(expired).toContainText(
    /Срок доработки истёк \d{1,2} [а-я]+, 23:59 МСК \(1 час назад\) — отправить заявку нельзя/,
  );
});
