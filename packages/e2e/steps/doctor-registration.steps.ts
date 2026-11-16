import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  inputSecret,
  submitOwnedRegistration,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { Given, Then, When } from "./support/fixtures.js";

/**
 * 021 — the doctor-registration journeys (#4073), driven on the real stack: the
 * doctor storefront's gate, the sign-in host's registration door (ADR-0015 §4,
 * #3006) and the storefront callback. Every account is a fresh owned address
 * (`lib/owned-registration.ts`), so a run never reuses another run's mail.
 *
 * The Background's эфир is the golden published upcoming event: the doctor
 * storefront serves it at its stable slug (020 EARS-1) and offers a guest its
 * «Участвовать» gate.
 */

const SESSION_COOKIE = "__Host-ds_session";
/** The doctor door's register command (021 EARS-4/5/7 stamping). */
const DOCTOR_REGISTER = "/v1/storefront/doctor/register";
/** Every register command a door on the sign-in host can send. */
const REGISTER_COMMANDS = [
  signInHostApiPath(DOCTOR_REGISTER),
  signInHostApiPath("/v1/auth/register"),
];
const EVENT = golden.events.upcoming;

const base = (id: HostId) => baseUrlFor(HOSTS[id]);
const origin = (id: HostId) => new URL(base(id)).origin;
const eventPath = (id: HostId) => `${HOSTS[id].eventsPath}/${EVENT.slug}`;
const onStorefront = (url: URL) =>
  url.origin === origin("doctor") || url.origin === origin("academy");

/** What one journey remembers between its steps, per page. */
interface Journey {
  documents: Response[];
  registerCommands: number;
}
const journeys = new WeakMap<Page, Journey>();

function journeyOf(page: Page): Journey {
  let journey = journeys.get(page);
  if (!journey) {
    journey = { documents: [], registerCommands: 0 };
    journeys.set(page, journey);
    page.on("response", (response) => {
      const request = response.request();
      if (
        request.resourceType() === "document" &&
        request.frame() === page.mainFrame()
      ) {
        journey!.documents.push(response);
      }
    });
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        REGISTER_COMMANDS.includes(new URL(request.url()).pathname)
      ) {
        journey!.registerCommands += 1;
      }
    });
  }
  return journey;
}

/** Forget the documents seen so far: the next assertion reads only what follows. */
function markDocuments(page: Page): void {
  journeyOf(page).documents.length = 0;
}

async function hasSession(page: Page, id: HostId): Promise<boolean> {
  const cookies = await page.context().cookies(base(id));
  return cookies.some((c) => c.name === SESSION_COOKIE);
}

/** The session as the page itself reads it (device-bound, 003 EARS-64). */
async function sessionStatus(page: Page): Promise<number> {
  return page.evaluate(
    async () =>
      (
        await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
  );
}

async function freshGuest(page: Page): Promise<void> {
  await page.context().clearCookies();
  await prepareCaptchaForJourney(
    page.context(),
    base("doctor"),
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  journeyOf(page);
}

/** The message slot a control's `aria-describedby` points at (its last id). */
async function messageSlot(control: Locator): Promise<Locator> {
  const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
  const id = describedBy.trim().split(/\s+/).at(-1);
  expect(id, "the control is wired to its message slot").toBeTruthy();
  return control.page().locator(`[id="${id}"]`);
}

async function tick(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

async function reachRegistrationForm(page: Page): Promise<void> {
  await page.waitForURL((url) => !onStorefront(url));
  await expect(page.getByTestId("register-submit")).toBeVisible();
}

// ── Background ────────────────────────────────────────────────────────────

Given("feature 017's storefront shell is in place", async ({ page }) => {
  const response = await page.goto(`${base("doctor")}/`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "the doctor storefront home").toBe(200);
  await expect(page.locator("header").first()).toBeVisible();
  await expect(page.locator("footer").first()).toBeVisible();
});

Given("feature 020's event page is in place", async ({ page }) => {
  const response = await page.goto(`${base("doctor")}${eventPath("doctor")}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "the doctor event page").toBe(200);
  await expect(page.getByTestId("event-page-shell")).toBeVisible();
});

Given("feature 003's authentication engine is running", async ({ page }) => {
  // A guest's session read is answered by the engine, not by a dead upstream.
  expect(await sessionStatus(page), "the engine answers a guest").toBe(401);
});

Given(
  "an эфир «{}» exists with a public event page",
  async ({ page }, title: string) => {
    const read = await page.request.get(
      `${base("doctor")}/v1/public/events/${EVENT.slug}`,
    );
    expect(read.status(), "the public event read").toBe(200);
    const event = (await read.json()) as { title: string; state: string };
    expect(event.title).toBe(title);
    expect(event.state).toBe("published");
  },
);

// ── 021 EARS-11 / EARS-12: field errors and the unticked condition's row ────

Given("a guest doctor on the registration screen", async ({ page }) => {
  await freshGuest(page);
  await page.goto(`${base("doctor")}/register`, { waitUntil: "load" });
  await reachRegistrationForm(page);
});

When(
  "the doctor enters «{}» in the email field",
  async ({ page }, value: string) => {
    const email = page.getByTestId("register-email");
    await email.fill(value);
    await email.blur();
  },
);

Then(
  "the email field states what to correct, in Russian, tied to that field",
  async ({ page }) => {
    const email = page.getByTestId("register-email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const slot = await messageSlot(email);
    await expect(slot).toContainText(/[А-Яа-яЁё]{3,}/);
    await expect(slot).toContainText(/адрес/i);
  },
);

When("the doctor enters a five-character password", async ({ page }) => {
  const password = page.getByTestId("register-password");
  await password.fill("aB3d!");
  await password.blur();
});

Then(
  "the error restates «{}» in that field's single message slot",
  async ({ page }, rule: string) => {
    const password = page.getByTestId("register-password");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(await messageSlot(password)).toContainText(rule);
    // ONE slot: the error replaces the hint rather than stacking under it.
    await expect(
      page.getByTestId("registration-form").getByText(rule),
    ).toHaveCount(1);
  },
);

When(
  "the doctor leaves the medical-worker declaration unticked and presses the submit control",
  async ({ page }) => {
    await expect(page.getByTestId("register-medworker")).not.toBeChecked();
    await page.getByTestId("register-submit").click();
  },
);

Then(
  "the submit control stays live and no reason line stands beside it",
  async ({ page }) => {
    const submit = page.getByTestId("register-submit");
    await expect(submit).toBeEnabled();
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    expect(await submit.getAttribute("aria-describedby")).toBeNull();
  },
);

Then(
  "the statement naming that specific unticked condition is rendered under its own checkbox",
  async ({ page }) => {
    const item = page.getByTestId("register-medworker-item");
    await expect(item).toContainText(/медицинский работник\s+—/);
  },
);

Then(
  "that statement is tied to the checkbox it belongs to",
  async ({ page }) => {
    const slot = await messageSlot(page.getByTestId("register-medworker"));
    await expect(slot).toContainText(/медицинский работник\s+—/);
    await expect(page.getByTestId("register-medworker-item")).toContainText(
      (await slot.innerText()).replace(/^\W+/, "").trim(),
    );
  },
);

Then("the optional marketing opt-in states nothing", async ({ page }) => {
  const marketing = page.getByTestId("register-marketing");
  await expect(marketing).not.toHaveAttribute("aria-invalid", "true");
  const ids = ((await marketing.getAttribute("aria-describedby")) ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const id of ids) {
    // Only its own help line may describe it — never an unmet-condition report.
    // An id with no element is the primitive's idle message slot: it says nothing.
    const described = page.locator(`[id="${id}"]`);
    if ((await described.count()) === 0) continue;
    await expect(described).not.toContainText("Отметьте");
  }
  await expect(
    page.getByTestId("registration-consent-marketing"),
  ).not.toContainText("Отметьте");
});

Then("no registration command is sent", async ({ page }) => {
  // The press resolved locally; give a stray command time to show itself.
  await page.waitForTimeout(1_000);
  expect(journeyOf(page).registerCommands).toBe(0);
});

When("the doctor ticks the medical-worker declaration", async ({ page }) => {
  await tick(page, "register-medworker");
});

Then("only that row's statement is cleared", async ({ page }) => {
  await expect(page.getByTestId("register-medworker-item")).not.toContainText(
    "Отметьте",
  );
  await expect(page.getByTestId("register-medworker")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The other unmet condition and the field errors still stand.
  await expect(page.getByTestId("register-partner-data-item")).toContainText(
    "Отметьте",
  );
  await expect(page.getByTestId("register-email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByTestId("register-password")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

// ── 021 EARS-20 / EARS-10: from the doctor gate, signed in on both storefronts ─

Given(
  "a guest on the doctor storefront in a browser with no session on either storefront",
  async ({ page }) => {
    await freshGuest(page);
    await page.goto(`${base("doctor")}${eventPath("doctor")}`, {
      waitUntil: "load",
    });
    expect(await hasSession(page, "doctor"), "no doctor session").toBe(false);
    expect(await hasSession(page, "academy"), "no Academy session").toBe(false);
  },
);

When(
  "the guest follows the gate of the эфир «{}» to registration",
  async ({ page }, title: string) => {
    await expect(page.getByRole("main")).toContainText(title);
    markDocuments(page);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Участвовать", exact: true })
      .first()
      .click();
  },
);

Then(
  "the doctor storefront renders no form and the browser reaches the sign-in host's registration form with the promo field and the two-tier consents",
  async ({ page }) => {
    await reachRegistrationForm(page);
    for (const response of journeyOf(page).documents.filter(
      (r) => new URL(r.url()).origin === origin("doctor"),
    )) {
      expect(response.status(), response.url()).toBe(303);
    }
    await expect(page.getByTestId("register-promo")).toBeVisible();
    const access = page.getByTestId("registration-consent-access");
    await expect(access.getByTestId("register-medworker")).toHaveCount(1);
    await expect(access.getByTestId("register-partner-data")).toHaveCount(1);
    await expect(
      page
        .getByTestId("registration-consent-marketing")
        .getByTestId("register-marketing"),
    ).toHaveCount(1);
  },
);

When(
  "the guest registers there and enters the code sent to their address",
  async ({ page }) => {
    await tick(page, "register-medworker");
    await tick(page, "register-partner-data");
    const account: OwnedCredentials = {
      email: `doctor-reg-021-${randomUUID()}@example.test`,
      password: `Reg-${randomUUID()}-aA1!`,
    };
    // The stand's one Mailpit is addressed from the Academy slot URL
    // (`lib/mailpit.ts`); the mail is the same whichever storefront sent it.
    const { code } = await submitOwnedRegistration(
      page,
      base("academy"),
      account,
      DOCTOR_REGISTER,
    );
    markDocuments(page);
    await inputSecret(
      page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
  },
);

Then(
  "the browser lands on the эфир page on the doctor storefront, signed in, with no interstitial",
  async ({ page }) => {
    await page.waitForURL(
      (url) =>
        url.origin === origin("doctor") && url.pathname === eventPath("doctor"),
    );
    await page.waitForLoadState("load");
    expect(await hasSession(page, "doctor"), "a doctor session").toBe(true);
    expect(await sessionStatus(page), "the session is live").toBe(200);
    // Every document between the code and the эфир only redirected.
    const documents = journeyOf(page).documents;
    const rendered = documents.filter((r) => r.status() === 200);
    expect(rendered, "one rendered document: the эфир page").toHaveLength(1);
    expect(new URL(rendered[0]!.url()).pathname).toBe(eventPath("doctor"));
  },
);

When(
  "the same browser requests an Academy page as a document",
  async ({ page }) => {
    expect(await hasSession(page, "academy"), "no Academy session yet").toBe(
      false,
    );
    markDocuments(page);
    const response = await page.goto(
      `${base("academy")}${eventPath("academy")}`,
      {
        waitUntil: "load",
      },
    );
    expect(response?.status(), "the Academy page document").toBe(200);
  },
);

Then(
  "the Academy page renders signed in with no form and no guest render first",
  async ({ page }) => {
    expect(await hasSession(page, "academy"), "an Academy session").toBe(true);
    expect(await sessionStatus(page), "the Academy session is live").toBe(200);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const documents = journeyOf(page).documents;
    const rendered = documents.filter((r) => r.status() === 200);
    expect(rendered, "exactly one render, the signed-in one").toHaveLength(1);
    expect(rendered[0]).toBe(documents.at(-1));
    for (const response of documents.slice(0, -1)) {
      const status = response.status();
      expect(status >= 300 && status < 400, response.url()).toBe(true);
    }
  },
);
