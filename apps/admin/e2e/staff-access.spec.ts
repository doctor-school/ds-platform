import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  ADMIN_ORIGIN,
  bootstrapAdminSession,
  bootstrapDoctorSession,
  bootstrapRegistrarAccount,
  createPublishedEvent,
  eventSlugFromDetail,
  signInAsAdmin,
  totpCode,
  type BootstrapResult,
} from "@ds/e2e/admin-events";
import { evidenceShot } from "./support/evidence-shot";
import { bindRegistrarToEvent } from "./support/event-grants";
import { searchRelationshipCombobox } from "./support/relationship-combobox";
import {
  ageAdminSecondFactor,
  idpEmailVerified,
  idpRoleKeysOf,
  verifyEmailAtIdp,
} from "./support/staff-access";

/**
 * 047 V-9 (grant half) — «Доступы» driven against the real admin → api →
 * Zitadel → Postgres → Redis chain: a platform administrator grants staff
 * roles from the admin, the person signs in with the temporary password, the
 * step-up sends a stale second factor through the code screen and back, the
 * refusals change nothing, and a registrar never sees the section. The
 * revocation half of V-9 lands with «Отозвать» (#2902).
 *
 * Dev-stand-gated like the rest of the flows tier, plus the session store:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… DATABASE_URL=… REDIS_URL=… \
 *   pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/staff-access.spec.ts
 *
 * `REDIS_URL` is the api's own session store: the step-up test ages the
 * operator's second factor there (`ageAdminSecondFactor`). `E2E_SHOT_DIR` opts
 * into the approved-non-canvas `responsive-web` evidence of every state.
 */

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
}

const UNVERIFIED_REFUSAL =
  "Почта этой учётной записи не подтверждена. Попросите сотрудника подтвердить почту и повторите выдачу";

/** Wait for a TOTP step that began after `sinceMs`, so no code is a replay. */
async function codeAfter(
  page: Page,
  secret: string,
  sinceMs: number,
): Promise<string> {
  const nextStep = (Math.floor(sinceMs / 30_000) + 1) * 30_000;
  const wait = nextStep - Date.now() + 500;
  if (wait > 0) await page.waitForTimeout(wait);
  return totpCode(secret);
}

/**
 * The list row of `email`, found the way an administrator finds it on a stand
 * with many staff holders: through the section's own search, not the first page.
 */
async function rowOf(page: Page, email: string): Promise<Locator> {
  await page
    .getByRole("searchbox", { name: "Поиск по ФИО и почте" })
    .fill(email);
  return page.locator("tr", { hasText: email });
}

async function openGrantForm(page: Page): Promise<void> {
  await page.getByTestId("staff-access-grant-open").click();
  await expect(page.getByTestId("staff-access-grant-form")).toBeVisible();
}

async function fillGrant(
  page: Page,
  values: { email: string; fullName: string; role: string; event?: string },
): Promise<void> {
  await page.getByTestId("staff-access-email").fill(values.email);
  await page.getByTestId("staff-access-fullName").fill(values.fullName);
  await page.getByTestId("staff-access-role").selectOption(values.role);
  if (values.event) {
    const panel = await searchRelationshipCombobox(
      page,
      "staff-access-event",
      values.event,
    );
    await panel
      .getByRole("option", { name: new RegExp(values.event) })
      .first()
      .click();
    await expect(page.getByTestId("staff-access-event")).toContainText(
      values.event,
    );
  }
}

test.describe.configure({ mode: "serial" });

test.describe("047 «Доступы» — a platform administrator grants staff access", () => {
  let adminContext: BrowserContext | undefined;
  let admin: Page;
  let adminAccount: BootstrapResult;
  let adminSecret = "";
  let signedInAt = 0;
  let eventA = { id: "", title: "" };
  let eventB = { id: "", title: "" };
  const verifiedDoctor = { email: "" };

  test.afterAll(async () => {
    await adminContext?.close();
  });

  test("047 EARS-1/EARS-2: a platform administrator opens «Доступы» and sees every staff holder", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    adminContext = await browser.newContext({ locale: "ru-RU" });
    admin = await adminContext.newPage();
    await admin.setViewportSize({ width: 1440, height: 900 });
    adminAccount = await bootstrapAdminSession(ADMIN_ORIGIN);
    adminSecret = await signInAsAdmin(admin, adminAccount);
    signedInAt = Date.now();

    const stamp = Date.now();
    eventA = {
      title: `Конгресс доступы A ${stamp}`,
      id: await createPublishedEvent(admin, `Конгресс доступы A ${stamp}`),
    };
    eventB = {
      title: `Конгресс доступы B ${stamp}`,
      id: await createPublishedEvent(admin, `Конгресс доступы B ${stamp}`),
    };

    await admin.goto("/events");
    const nav = admin.getByTestId("nav-access");
    await expect(nav).toBeVisible();
    await expect(nav).toHaveText("Доступы");
    await evidenceShot(admin, "staff-access-nav");

    await nav.click();
    await admin.waitForURL(/\/access$/);
    await expect(
      admin.getByRole("table", { name: "Сотрудники с доступом к админке" }),
    ).toBeVisible();
    await evidenceShot(admin, "staff-access-list");
    const ownRow = await rowOf(admin, adminAccount.email);
    await expect(ownRow.first()).toBeVisible();
    await expect(ownRow.first()).toContainText("Администратор платформы");
  });

  test("047 EARS-3/EARS-5/EARS-6 (V-9): a new email gets «Программный комитет» for an event, a one-time password, signs in with it and lands on the event's «Заявки»", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueEmail("committee-new");
    await admin.goto("/access");
    await openGrantForm(admin);
    // «Мероприятие» belongs to a congress role only.
    await admin.getByTestId("staff-access-role").selectOption("platform_admin");
    await expect(admin.getByTestId("staff-access-event")).toHaveCount(0);
    const values = {
      email,
      fullName: "Сидорова Мария Ивановна",
      role: "congress-program-committee",
      event: eventA.title,
    };
    await fillGrant(admin, values);
    // The «Мероприятие» label names the event picker.
    await expect(
      admin.getByRole("combobox", { name: "Мероприятие" }),
    ).toBeVisible();
    await evidenceShot(admin, "staff-access-grant-form", {
      fullPage: false,
      prepare: async () => {
        if (
          (await admin.getByTestId("staff-access-email").inputValue()) !== email
        ) {
          await fillGrant(admin, values);
        }
      },
    });
    await admin.getByTestId("staff-access-grant-submit").click();

    const password = admin.getByTestId("staff-access-password");
    await expect(password).toBeVisible({ timeout: 30_000 });
    const temporaryPassword = await password.inputValue();
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await expect(admin.getByTestId("staff-access-password-warning")).toHaveText(
      /не будет показан повторно/,
    );
    await expect(admin.getByTestId("staff-access-password-copy")).toHaveText(
      "Скопировать",
    );
    // The field and its «Скопировать» are one control height (#2901 Stage-B).
    const fieldBox = await password.boundingBox();
    const copyBox = await admin
      .getByTestId("staff-access-password-copy")
      .boundingBox();
    expect(copyBox?.height).toBe(fieldBox?.height);
    await evidenceShot(admin, "staff-access-temp-password", {
      fullPage: false,
    });
    await admin.getByTestId("staff-access-grant-done").click();
    // Closing ends the display: the password is nowhere on the page any more.
    await expect(admin.getByText(temporaryPassword)).toHaveCount(0);
    const row = await rowOf(admin, email);
    await expect(row).toContainText("Программный комитет");
    await expect(row).toContainText(eventA.title);
    expect(await idpRoleKeysOf(email)).toEqual([
      "congress-program-committee",
      "doctor_guest",
    ]);

    // The person signs in with the temporary password, enrols TOTP (011) and
    // lands on the bound event's «Заявки».
    const personContext = await browser.newContext({ locale: "ru-RU" });
    try {
      const person = await personContext.newPage();
      await signInAsAdmin(person, { email, password: temporaryPassword });
      await person.waitForURL(new RegExp(`/events/${eventA.id}/submissions`), {
        timeout: 20_000,
      });
      await expect(person.getByTestId("nav-access")).toHaveCount(0);
    } finally {
      await personContext.close();
    }
  });

  test("047 EARS-4: an existing account with a verified email gets the role added — no password, its roles kept", async () => {
    test.setTimeout(180_000);
    const doctor = await bootstrapDoctorSession(ADMIN_ORIGIN, "doc-verified");
    verifiedDoctor.email = doctor.email;
    await verifyEmailAtIdp(doctor.email);

    await admin.goto("/access");
    await openGrantForm(admin);
    await fillGrant(admin, {
      email: doctor.email,
      fullName: "Кузнецов Олег",
      role: "event-registrar",
      event: eventA.title,
    });
    await admin.getByTestId("staff-access-grant-submit").click();
    const existing = admin.getByTestId("staff-access-existing-account");
    await expect(existing).toBeVisible({ timeout: 30_000 });
    await expect(existing).toContainText(
      "Роль добавлена к существующей учётной записи",
    );
    await expect(admin.getByTestId("staff-access-password")).toHaveCount(0);
    await evidenceShot(admin, "staff-access-existing-account", {
      fullPage: false,
    });
    await admin.getByTestId("staff-access-grant-done").click();
    expect(await idpRoleKeysOf(doctor.email)).toEqual([
      "doctor_guest",
      "event-registrar",
    ]);
  });

  test("047 EARS-3: a complete grant and a registrar bound elsewhere are refused at the form, the input kept, nothing changed", async () => {
    test.setTimeout(120_000);
    await admin.goto("/access");
    await openGrantForm(admin);
    await fillGrant(admin, {
      email: verifiedDoctor.email,
      fullName: "Кузнецов Олег",
      role: "event-registrar",
      event: eventA.title,
    });
    await admin.getByTestId("staff-access-grant-submit").click();
    const error = admin.getByTestId("staff-access-grant-error");
    await expect(error).toHaveText(/уже есть этот доступ/, { timeout: 30_000 });

    const values = {
      email: verifiedDoctor.email,
      fullName: "Кузнецов Олег",
      role: "event-registrar",
      event: eventB.title,
    };
    await fillGrant(admin, values);
    await admin.getByTestId("staff-access-grant-submit").click();
    await expect(error).toContainText(
      `Сотрудник уже администратор Конгресса другого мероприятия — «${eventA.title}». Ничего не изменено.`,
      { timeout: 30_000 },
    );
    await expect(admin.getByTestId("staff-access-email")).toHaveValue(
      verifiedDoctor.email,
    );
    await evidenceShot(admin, "staff-access-refused", {
      fullPage: false,
      prepare: async () => {
        if (!(await error.isVisible())) {
          await fillGrant(admin, values);
          await admin.getByTestId("staff-access-grant-submit").click();
          await expect(error).toBeVisible({ timeout: 30_000 });
        }
      },
    });
    expect(await idpRoleKeysOf(verifiedDoctor.email)).toEqual([
      "doctor_guest",
      "event-registrar",
    ]);
  });

  test("047 EARS-3: an existing account whose email is not verified is refused and stays exactly as it was", async () => {
    test.setTimeout(120_000);
    const doctor = await bootstrapDoctorSession(ADMIN_ORIGIN, "doc-unverified");
    expect(await idpEmailVerified(doctor.email)).toBe(false);
    const before = await idpRoleKeysOf(doctor.email);

    await admin.goto("/access");
    await openGrantForm(admin);
    const values = {
      email: doctor.email,
      fullName: "Смирнова Ольга",
      role: "platform_admin",
    };
    await fillGrant(admin, values);
    await admin.getByTestId("staff-access-grant-submit").click();
    const error = admin.getByTestId("staff-access-grant-error");
    await expect(error).toContainText(UNVERIFIED_REFUSAL, { timeout: 30_000 });
    await expect(error).toHaveAttribute("data-refusal", "unverified");
    await expect(admin.getByTestId("staff-access-fullName")).toHaveValue(
      "Смирнова Ольга",
    );
    await evidenceShot(admin, "staff-access-refused-unverified", {
      fullPage: false,
      prepare: async () => {
        if (!(await error.isVisible())) {
          await fillGrant(admin, values);
          await admin.getByTestId("staff-access-grant-submit").click();
          await expect(error).toBeVisible({ timeout: 30_000 });
        }
      },
    });

    // Nothing changed: the same roles, the email still unverified, no row.
    expect(await idpRoleKeysOf(doctor.email)).toEqual(before);
    expect(await idpEmailVerified(doctor.email)).toBe(false);
    await admin.getByRole("button", { name: "Отмена" }).click();
    await admin.reload();
    await expect(
      admin.getByRole("table", { name: "Сотрудники с доступом к админке" }),
    ).toBeVisible();
    await rowOf(admin, doctor.email);
    await expect(
      admin
        .getByRole("region", { name: "Фильтры списка" })
        .getByText("Найдено: 0", { exact: true }),
    ).toBeVisible();
  });

  test("047 EARS-8 (V-9): with a 31-minute-old second factor the grant opens the code screen, and after the code it completes with the entered values", async () => {
    test.setTimeout(180_000);
    await ageAdminSecondFactor(adminAccount.email, 31 * 60_000);
    const email = uniqueEmail("committee-stepup");

    await admin.goto("/access");
    await openGrantForm(admin);
    await fillGrant(admin, {
      email,
      fullName: "Орлова Вера Павловна",
      role: "congress-program-committee",
      event: eventB.title,
    });
    await admin.getByTestId("staff-access-grant-submit").click();

    // The code screen of the same session — not the login.
    await admin.waitForURL(/\/mfa\/challenge\?mode=reverify/, {
      timeout: 20_000,
    });
    const challenge = new URL(admin.url());
    expect(challenge.searchParams.get("returnTo")).toBe("/access");
    expect(challenge.searchParams.get("endpoint")).toBe(
      "POST /v1/admin/staff-access/grants",
    );
    await expect(admin.getByTestId("mfa-challenge-form")).toBeVisible();
    await evidenceShot(admin, "staff-access-step-up");
    // Nothing was granted by the refused request.
    await expect.poll(() => idpRoleKeysOf(email).catch(() => [])).toEqual([]);

    const code = await codeAfter(admin, adminSecret, signedInAt);
    await admin
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(code);

    // Back on «Доступы»: the grant was sent again with the entered values.
    await admin.waitForURL(/\/access$/, { timeout: 20_000 });
    await expect(admin.getByTestId("staff-access-password")).toBeVisible({
      timeout: 30_000,
    });
    await expect(admin.getByTestId("staff-access-grant-panel")).toContainText(
      "Орлова Вера Павловна",
    );
    await admin.getByTestId("staff-access-grant-done").click();
    const row = await rowOf(admin, email);
    await expect(row).toContainText("Программный комитет");
    await expect(row).toContainText(eventB.title);

    // Within the fresh window the next grant asks for no code.
    await openGrantForm(admin);
    await fillGrant(admin, {
      email: uniqueEmail("admin-window"),
      fullName: "Белов Игорь",
      role: "platform_admin",
    });
    await admin.getByTestId("staff-access-grant-submit").click();
    await expect(admin.getByTestId("staff-access-password")).toBeVisible({
      timeout: 30_000,
    });
    expect(admin.url()).toMatch(/\/access$/);
  });

  test("047 EARS-1: a congress registrar sees no «Доступы» and the route refuses them", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const registrar = await bootstrapRegistrarAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(
      registrar.email,
      await eventSlugFromDetail(admin, eventA.id),
    );
    const context = await browser.newContext({ locale: "ru-RU" });
    try {
      const desk = await context.newPage();
      await signInAsAdmin(desk, registrar);
      await desk.waitForURL(/\/roster/, { timeout: 20_000 });
      await expect(desk.getByTestId("nav-access")).toHaveCount(0);
      await desk.goto("/access");
      await expect(desk.getByTestId("access-refused")).toBeVisible();
      await expect(desk.getByTestId("staff-access-grant-open")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
