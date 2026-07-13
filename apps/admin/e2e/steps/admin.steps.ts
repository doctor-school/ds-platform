import { expect, type Page } from "@playwright/test";
import {
  adminOrigin,
  Given,
  Then,
  When,
  type AdminWorld,
} from "../support/fixtures";
import {
  bootstrapAdminSession,
  bootstrapDoctorSession,
  E2E_PASSWORD,
} from "../support/admin-session";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");
const DEFAULT_MSK = "2026-07-17T19:00";

/**
 * One shared `platform_admin` account for the whole run — provisioned once
 * (register + IdP role grant) and reused across every admin scenario. The api's
 * per-IP auth rate limit (EARS-13, 20 / 15 min) makes a fresh account per scenario
 * unaffordable; each scenario still runs its own browser context + login, so the
 * sessions stay isolated even though the account is shared.
 */
let sharedAdmin: Promise<{ email: string; password: string }> | null = null;
function getSharedAdmin() {
  sharedAdmin ??= bootstrapAdminSession(adminOrigin());
  return sharedAdmin;
}

/**
 * Submit the admin LOGIN UI once (fill + click) — a browser-native navigation so
 * the `__Host-ds_session` Set-Cookie is processed by the browser (an
 * APIRequestContext POST over http does not persist a Secure cookie into the page
 * jar; the real login form does). Returns `true` when the login lands on `/events`
 * (admin admitted), `false` when it is refused / stays on `/login`.
 */
async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<boolean> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  try {
    await page.waitForURL(/\/events/, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Log in as the admin, retrying — the project-role grant projects into the
 * id_token with a short lag, so the first login after the grant can still mint a
 * non-admin token (the app then keeps the operator on `/login`). Re-submit a few
 * times until the admin surface is reached.
 */
async function browserLoginAsAdmin(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    if (await submitLogin(page, email, password)) return;
  }
  throw new Error(`admin login did not reach /events for ${email}`);
}

/** Fill + submit the create-event form; capture the new event id off the redirect URL. */
async function createEvent(page: Page, world: AdminWorld, msk: string) {
  await page.goto("/events/create");
  await page.locator("#title").fill("Актуальная терапия ХСН");
  await page.locator("#school").fill("Кардиология сегодня");
  await page.locator("#startsAtMsk").fill(msk);
  await page.locator("#durationMin").fill("90");
  await page.locator("#description").fill("Разбор клинических рекомендаций.");
  await page.getByTestId("add-speaker").click();
  await page.getByTestId("speaker-name-0").fill("Иванов И.И.");
  await page.getByTestId("speaker-regalia-0").fill("д.м.н., профессор");
  await page.locator("#specialties").fill("cardiology, therapy");
  await page.locator("#partnerRef").fill("sponsor:acme-pharma");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  world.eventId = page.url().split("/").pop();
}

Given("a platform_admin operator in the admin app", async ({ page, world }) => {
  const { email, password } = await getSharedAdmin();
  world.email = email;
  await browserLoginAsAdmin(page, email, password);
  await page.goto("/events");
  await expect(page.getByTestId("create-event")).toBeVisible();
});

Given("a doctor_guest caller with a session", async ({ page, world }) => {
  const { email } = await bootstrapDoctorSession(adminOrigin());
  world.email = email;
  // A non-admin who tries the admin login is refused (authProvider admits only
  // platform_admin, EARS-8) and kept on /login — never admitted to the surface.
  const admitted = await submitLogin(page, email, E2E_PASSWORD);
  expect(admitted, "a doctor_guest must not be admitted to the admin app").toBe(
    false,
  );
  await expect(page.getByTestId("login-error")).toBeVisible();
});

When("the operator creates a draft event with a program PDF", async ({ page, world }) => {
  await createEvent(page, world, DEFAULT_MSK);
});

When(
  "the operator creates a draft event at {string} МСК with a program PDF",
  async ({ page, world }, msk: string) => {
    await createEvent(page, world, msk);
  },
);

/**
 * Realistic provider-scoped embed ids (the `@ds/schemas` `EMBED_REF_SHAPES`
 * SSOT, #665): YouTube = the 11-char video id, Rutube = the 32-hex video id.
 */
const VALID_EMBED_REF: Record<string, string> = {
  rutube: "caafe83ff1c6ed38d394635b83ece578",
  youtube: "dQw4w9WgXcQ",
};

When(
  "the operator configures the stream with provider {string}",
  async ({ page, world }, provider: string) => {
    await page.getByTestId("provider").selectOption(provider);
    await page.getByTestId("embed-ref").fill(VALID_EMBED_REF[provider] ?? "");
    await page.getByTestId("save-stream").click();
    await expect(page.getByTestId("stream-ok")).toBeVisible();
    world.provider = provider;
  },
);

When("the operator publishes the event", async ({ page }) => {
  await page.getByTestId("action-publish").click();
});

When("the operator opens the room", async ({ page }) => {
  await page.getByTestId("action-open").click();
});

When("the operator closes the room", async ({ page }) => {
  await page.getByTestId("action-close").click();
});

When("the operator archives the event", async ({ page }) => {
  await page.getByTestId("action-archive").click();
});

When("the caller opens the events page", async ({ page }) => {
  await page.goto("/events");
});

When("the operator opens the create-event screen", async ({ page }) => {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
});

Then(
  "a one-click link returns the operator to the events list",
  async ({ page }) => {
    // The back-to-list affordance (#664) — one click from any inner admin
    // screen (create / edit) lands on the events list, never a dead end.
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/events$/);
    await expect(page.getByTestId("create-event")).toBeVisible();
  },
);

Then(
  "the event is shown in the {string} state",
  async ({ page }, state: string) => {
    await expect(page.getByTestId(`state-${state}`)).toBeVisible();
  },
);

Then("only the {string} lifecycle action is offered", async ({ page }, action: string) => {
  await expect(page.getByTestId(`action-${action}`)).toBeVisible();
});

Then("no invalid transition action is offered from draft", async ({ page }) => {
  for (const forbidden of ["action-open", "action-close", "action-archive"]) {
    await expect(page.getByTestId(forbidden)).toHaveCount(0);
  }
});

Then("no lifecycle action is offered", async ({ page }) => {
  await expect(page.getByTestId("no-transitions")).toBeVisible();
  await expect(page.getByTestId("lifecycle-actions")).toHaveCount(0);
});

Then("the stream provider choices are exactly rutube and youtube", async ({ page }) => {
  // `evaluateAll` has no auto-wait — anchor on the rendered select first (the edit
  // page loads the detail via useOne, so the stream form appears a beat later).
  await expect(page.getByTestId("provider")).toBeVisible();
  const options = await page
    .getByTestId("provider")
    .locator("option")
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toEqual(["rutube", "youtube"]);
});

Then(
  "the event air time renders as {string} МСК in the admin list",
  async ({ page, world }, time: string) => {
    await page.goto("/events");
    const row = page.getByTestId(`event-row-${world.eventId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(time);
    await expect(row).toContainText("МСК");
  },
);

Then("no untranslated catalog key is visible on the surface", async ({ page }) => {
  const body = await page.locator("body").innerText();
  // A missing translation would render the raw dotted catalog key (e.g.
  // `events.state.draft`) — assert none leaked onto the surface (EARS-10).
  expect(body).not.toMatch(/\b(?:events|common|app|login)\.[a-zA-Z][\w.]+/);
});

Then("the caller is bounced to the login screen", async ({ page }) => {
  await page.waitForURL(/\/login/);
  await expect(page.getByTestId("login-submit")).toBeVisible();
});

// ── #675 authenticated-session auth-surface guard ────────────────────────────

When("the operator opens the login screen", async ({ page }) => {
  await page.goto("/login");
});

Then(
  "the operator is redirected to the events list without a login form",
  async ({ page }) => {
    // #675: the admin `/login` gates on `useIsAuthenticated` — an already-admitted
    // platform_admin is sent to the `events` resource root and the login form is
    // never rendered (the form shows only when unauthenticated).
    await page.waitForURL(/\/events/);
    await expect(page.getByTestId("login-form")).toHaveCount(0);
  },
);

// ── #665 client-side validation with rendered RU errors ──────────────────────

When(
  "the operator submits the create-event form with no fields filled",
  async ({ page }) => {
    await page.goto("/events/create");
    await expect(page.getByTestId("event-form")).toBeVisible();
    await page.getByTestId("submit-event").click();
  },
);

When("the operator enters {string} as the duration", async ({ page }, value: string) => {
  await page.locator("#durationMin").fill(value);
  // `mode: onTouched` — blur surfaces the inline error without a submit.
  await page.locator("#durationMin").blur();
});

When(
  "the operator adds a speaker and leaves the name empty",
  async ({ page }) => {
    await page.getByTestId("add-speaker").click();
    await expect(page.getByTestId("speaker-name-0")).toBeVisible();
    // Re-submit: the row was added AFTER the first submit, and RHF revalidates
    // an untouched field only on the next submit — which surfaces the required
    // speaker-name error inline under the new row.
    await page.getByTestId("submit-event").click();
  },
);

When("the operator attaches a non-PDF program file", async ({ page }) => {
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.getByTestId("program-pdf-error")).toBeVisible();
});

When(
  "the operator saves the stream with embed reference {string}",
  async ({ page }, ref: string) => {
    await page.getByTestId("embed-ref").fill(ref);
    await page.getByTestId("save-stream").click();
  },
);

Then(
  "the form shows the RU validation error {string}",
  async ({ page }, message: string) => {
    // The error renders inline (role=alert) under its control, in Russian (EARS-10).
    const error = page.getByText(message, { exact: false }).first();
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/[А-Яа-яЁё]/);
  },
);

Then("the operator stays on the create-event screen", async ({ page }) => {
  await expect(page).toHaveURL(/\/events\/create/);
  await expect(page.getByTestId("event-form")).toBeVisible();
});

Then("the stream configuration is not saved", async ({ page }) => {
  await expect(page.getByTestId("stream-ok")).toHaveCount(0);
});

// ── #665 rework — login form DS RU validation (Stage-B: native bubbles) ───────

Given("an anonymous visitor on the admin login screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-submit")).toBeVisible();
});

Then(
  "native browser validation is suppressed on the login form",
  async ({ page }) => {
    // The Stage-B finding: the login form surfaced native «Please fill out this
    // field.» bubbles. With `noValidate` the browser never intercepts the submit,
    // so the DS RU errors below are the ONLY validation surface.
    await expect(page.getByTestId("login-form")).toHaveAttribute("novalidate", "");
  },
);

When(
  "the visitor submits the login form with no fields filled",
  async ({ page }) => {
    await page.getByTestId("login-submit").click();
  },
);

Then("the visitor stays on the login screen", async ({ page }) => {
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-form")).toBeVisible();
});
