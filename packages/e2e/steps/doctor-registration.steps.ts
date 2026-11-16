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
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  inputSecret,
  submitOwnedRegistration,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { waitForClientReady } from "../lib/page-ready.js";
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
  /** The owned account a journey registers, once its form is filled. */
  account?: OwnedCredentials;
  /** The mailbox checkpoint taken right before the registration was sent. */
  mailCheckpoint?: Awaited<ReturnType<typeof captureAddressedMailCheckpoint>>;
  /** The code of the specialty the guest chose on the storefront (017 LD-2). */
  specialtyCode?: string;
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
    const item = page.getByTestId("register-medworker-item");
    const slot = await messageSlot(page.getByTestId("register-medworker"));
    await expect(slot).toContainText(/медицинский работник\s+—/);
    // The checkbox's own message slot stands inside its own row.
    const slotId = await slot.getAttribute("id");
    await expect(item.locator(`[id="${slotId}"]`)).toHaveCount(1);
    // The statement without any leading mark: a Unicode-aware strip, so the
    // Cyrillic sentence itself survives and the containment check has teeth.
    const statement = (await slot.innerText())
      .replace(/^[^\p{L}]+/u, "")
      .trim();
    expect(statement).toMatch(/^Отметьте, что вы медицинский работник —/);
    await expect(item).toContainText(statement);
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
  // The press has resolved: its validation marked the unticked row invalid.
  // A submit resolves as invalid OR runs the handler that sends the command,
  // never both, so once the row reports, this press can send nothing more.
  await expect(page.getByTestId("register-medworker")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
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
    const storefrontDocuments = journeyOf(page).documents.filter(
      (r) => new URL(r.url()).origin === origin("doctor"),
    );
    // The gate's own navigation passed through the storefront's entry.
    expect(
      storefrontDocuments.length,
      "the gate reached the doctor storefront's registration entry",
    ).toBeGreaterThan(0);
    for (const response of storefrontDocuments) {
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
    await expectLandedOnEvent(page);
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

// ── 021 EARS-1/2/4/5/7/10: from a gate, registered, back on the эфир ─────────

/** The 021 canvas checks run at the spec's two breakpoints (021 EARS-15). */
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

async function atViewport(
  page: Page,
  size: { width: number; height: number },
  check: () => Promise<void>,
): Promise<void> {
  const previous = page.viewportSize();
  await page.setViewportSize(size);
  try {
    await check();
  } finally {
    if (previous) await page.setViewportSize(previous);
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The split's geometry: the brand-panel aside, the form column, the card. */
async function splitGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const panel = document.querySelector('[data-testid="auth-brand-panel"]');
    const aside = panel?.closest("aside") ?? null;
    const column = aside
      ? [...aside.parentElement!.children].find((child) => child !== aside)
      : null;
    return {
      aside: rect(aside),
      asideShown: aside ? getComputedStyle(aside).display !== "none" : false,
      panel: rect(panel),
      column: rect(column),
      card: rect(
        document.querySelector('[data-testid="registration-form-card"]'),
      ),
    };
  });
}

const centreX = (box: Box) => box.x + box.width / 2;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "the element is laid out").not.toBeNull();
  return box!;
}

async function visibleCount(locators: Locator[]): Promise<number> {
  let shown = 0;
  for (const locator of locators) if (await locator.isVisible()) shown += 1;
  return shown;
}

const wordmarks = (page: Page) => [
  page.getByTestId("auth-wordmark"),
  page.getByTestId("auth-wordmark-dark"),
  page.getByTestId("auth-panel-wordmark"),
];

Given(
  "a guest doctor pressed «Участвовать» on «{}»",
  async ({ page }, title: string) => {
    await freshGuest(page);
    await page.goto(`${base("doctor")}${eventPath("doctor")}`, {
      waitUntil: "load",
    });
    await expect(page.getByRole("main")).toContainText(title);
    markDocuments(page);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Участвовать", exact: true })
      .first()
      .click();
  },
);

When("the registration screen opens", async ({ page }) => {
  await reachRegistrationForm(page);
  await waitForClientReady(page);
});

Then(
  "it renders the auth canvas split composition with no storefront header, navigation or footer",
  async ({ page }) => {
    await atViewport(page, WIDE, async () => {
      const split = await splitGeometry(page);
      expect(split.asideShown, "the brand panel renders").toBe(true);
      const aside = split.aside!;
      const column = split.column!;
      // Two columns side by side, each taking a real share of the width and
      // the full height of the screen.
      expect(aside.x + aside.width).toBeLessThanOrEqual(column.x + 1);
      for (const half of [aside, column]) {
        expect(half.width).toBeGreaterThan(WIDE.width * 0.3);
        expect(half.height).toBeGreaterThanOrEqual(WIDE.height - 1);
      }
      expect(aside.width + column.width).toBeGreaterThanOrEqual(WIDE.width - 1);
    });
    await expect(
      page.locator(
        'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]',
      ),
    ).toHaveCount(0);
  },
);

Then(
  "exactly one wordmark renders for the viewport — pinned to the top of the brand panel on the wide layout, above the card on the narrow one where the panel does not render",
  async ({ page }) => {
    await atViewport(page, WIDE, async () => {
      expect(await visibleCount(wordmarks(page))).toBe(1);
      const mark = page.getByTestId("auth-panel-wordmark");
      await expect(mark).toBeVisible();
      const panel = (await splitGeometry(page)).panel!;
      const markBox = await boxOf(mark);
      // Zone 1 of the panel: the mark is its first, top-most element.
      expect(Math.abs(markBox.y - panel.y)).toBeLessThanOrEqual(1);
    });
    await atViewport(page, NARROW, async () => {
      expect((await splitGeometry(page)).asideShown).toBe(false);
      await expect(page.getByTestId("auth-panel-wordmark")).toBeHidden();
      expect(await visibleCount(wordmarks(page))).toBe(1);
      const mark = (await page.getByTestId("auth-wordmark").isVisible())
        ? page.getByTestId("auth-wordmark")
        : page.getByTestId("auth-wordmark-dark");
      const markBox = await boxOf(mark);
      const card = await boxOf(page.getByTestId("registration-form-card"));
      expect(markBox.y + markBox.height).toBeLessThanOrEqual(card.y);
    });
  },
);

Then(
  "the card stands centred on the vertical axis of the form column",
  async ({ page }) => {
    for (const size of [WIDE, NARROW]) {
      await atViewport(page, size, async () => {
        const { column, card } = await splitGeometry(page);
        expect(card!.width).toBeLessThan(column!.width);
        expect(
          Math.abs(centreX(card!) - centreX(column!)),
          `centred at ${size.width}`,
        ).toBeLessThanOrEqual(1);
      });
    }
  },
);

Then(
  "the left half shows the эфир through the canonical event-card unit feature 004 owns and feature 019 widens",
  async ({ page }) => {
    await atViewport(page, WIDE, async () => {
      const panel = page.getByTestId("return-context-panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("return-context-plate")).toBeHidden();
      // In the split's left column, in place of the value prop.
      const { aside, column } = await splitGeometry(page);
      const panelBox = await boxOf(panel);
      expect(panelBox.x).toBeGreaterThanOrEqual(aside!.x);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(column!.x);
      // 019's wide split: the panel takes the larger share when it shows content.
      expect(aside!.width).toBeGreaterThan(column!.width);
      const unit = panel.locator("[data-webinar-card]");
      await expect(unit).toHaveCount(1);
      await expect(unit).toBeVisible();
      await expect(unit).toHaveAttribute("data-testid", "return-context-card");
      await expect(unit).toContainText(EVENT.title);
    });
  },
);

Then("that card carries no back-navigation control", async ({ page }) => {
  for (const context of [
    page.getByTestId("return-context-panel"),
    page.getByTestId("return-context-plate"),
  ]) {
    await expect(context.locator("[data-webinar-card]")).toHaveCount(1);
    await expect(
      context.locator(
        'a, button, [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])',
      ),
    ).toHaveCount(0);
  }
  const tags = await page
    .locator("[data-webinar-card]")
    .evaluateAll((cards) => cards.map((card) => card.tagName));
  expect(tags).not.toContain("A");
});

Then(
  "the form asks only for email, password and an optional promo code",
  async ({ page }) => {
    const fields = await page
      .getByTestId("registration-form")
      .locator(
        'input:not([type="hidden"]):not([type="checkbox"]), select, textarea',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")),
      );
    expect(fields.sort()).toEqual([
      "register-email",
      "register-password",
      "register-promo",
    ]);
    const promo = page.getByTestId("register-promo");
    await expect(promo).not.toHaveAttribute("required", /.*/);
    await expect(promo).not.toHaveAttribute("aria-required", "true");
  },
);

Then(
  "no file input, document field or document copy exists anywhere on the screen",
  async ({ page }) => {
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /документ|диплом|сертификат|удостоверени|скан/i,
    );
  },
);

Then(
  "the form makes no points promise and renders no placeholder in its place",
  async ({ page }) => {
    await expect(page.getByTestId("registration-points-promise")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("registration-form-card")).not.toContainText(
      /\bPul\b|балл/i,
    );
  },
);

Then(
  "the medical-worker declaration and the partner-data consent are framed together above the submit button",
  async ({ page }) => {
    const access = page.getByTestId("registration-consent-access");
    await expect(access.getByTestId("register-medworker")).toHaveCount(1);
    await expect(access.getByTestId("register-partner-data")).toHaveCount(1);
    const frame = await boxOf(access);
    const submit = await boxOf(page.getByTestId("register-submit"));
    expect(frame.y + frame.height).toBeLessThanOrEqual(submit.y);
  },
);

Then(
  "the partner-data consent carries the shared wording «{}» with its help line «{}»",
  async ({ page }, label: string, help: string) => {
    await expect(
      page.getByTestId("register-partner-data-statement"),
    ).toHaveText(label);
    await expect(page.getByTestId("register-partner-data-help")).toHaveText(
      help,
    );
  },
);

Then(
  "no rendered string names a condition of free education",
  async ({ page }) => {
    await expect(page.locator("body")).not.toContainText(/бесплатн/i);
  },
);

Then(
  "it does not enumerate the composition of the shared data",
  async ({ page }) => {
    const item = page.getByTestId("register-partner-data-item");
    // The row says its label and its help line, and nothing more.
    const label = await page
      .getByTestId("register-partner-data-statement")
      .innerText();
    const help = await page
      .getByTestId("register-partner-data-help")
      .innerText();
    const said = (await item.innerText()).replace(/\s+/g, " ").trim();
    expect(said).toBe(`${label} ${help}`.replace(/\s+/g, " ").trim());
    await expect(item.locator("ul, ol, li, table")).toHaveCount(0);
  },
);

Then(
  "the marketing opt-in stands separately below the submit button and is not pre-ticked",
  async ({ page }) => {
    const marketing = page.getByTestId("registration-consent-marketing");
    await expect(marketing.getByTestId("register-marketing")).toHaveCount(1);
    await expect(
      page
        .getByTestId("registration-consent-access")
        .getByTestId("register-marketing"),
    ).toHaveCount(0);
    const submit = await boxOf(page.getByTestId("register-submit"));
    expect((await boxOf(marketing)).y).toBeGreaterThanOrEqual(
      submit.y + submit.height,
    );
    await expect(page.getByTestId("register-marketing")).not.toBeChecked();
  },
);

/** The doctor door's register command, as the form sends it. */
async function submitRegistration(page: Page): Promise<Response> {
  const journey = journeyOf(page);
  const account = journey.account!;
  const mailbox = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base("academy"));
  journey.mailCheckpoint = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    mailbox,
    account.email,
  );
  const sent = captureResponse(page, signInHostApiPath(DOCTOR_REGISTER));
  await page.getByTestId("register-submit").click();
  const { response } = await sent;
  expect(response.ok(), "the registration is accepted").toBe(true);
  await page.waitForURL((url) => url.pathname === "/verify");
  await waitForClientReady(page);
  return response;
}

/** Enters the code the letter carried, on the code step the form opened. */
async function confirmFromLetter(page: Page): Promise<void> {
  const journey = journeyOf(page);
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base("academy")),
    journey.account!.email,
    journey.mailCheckpoint!,
    "register",
  );
  markDocuments(page);
  await inputSecret(page.locator('input[autocomplete="one-time-code"]'), code);
}

async function fillOwnedAccount(page: Page, password: string): Promise<void> {
  const account: OwnedCredentials = {
    email: `doctor-reg-021-${randomUUID()}@example.test`,
    password,
  };
  journeyOf(page).account = account;
  await inputSecret(page.getByTestId("register-email"), account.email);
  await inputSecret(page.getByTestId("register-password"), account.password);
}

/** The doctor is on the эфир page of the doctor storefront and nothing rendered on the way. */
async function expectLandedOnEvent(page: Page): Promise<void> {
  await page.waitForURL(
    (url) =>
      url.origin === origin("doctor") && url.pathname === eventPath("doctor"),
  );
  await page.waitForLoadState("load");
  expect(await hasSession(page, "doctor"), "a doctor session").toBe(true);
  expect(await sessionStatus(page), "the session is live").toBe(200);
  // Every document between the code and the эфир only redirected.
  const rendered = journeyOf(page).documents.filter((r) => r.status() === 200);
  expect(rendered, "one rendered document: the эфир page").toHaveLength(1);
  expect(new URL(rendered[0]!.url()).pathname).toBe(eventPath("doctor"));
}

When(
  "the doctor fills a valid email and an eight-character password",
  async ({ page }) => {
    // Eight characters exactly: every class, so the length is the only edge.
    const password = `Aa1!${randomUUID().replace(/-/g, "").slice(0, 4)}`;
    expect(password).toHaveLength(8);
    await fillOwnedAccount(page, password);
  },
);

When("ticks both access-condition consents", async ({ page }) => {
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
});

When("submits the form", async ({ page }) => {
  await submitRegistration(page);
});

Then("the screen states that a letter was sent", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Проверьте почту" }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    `Мы отправили код на ${journeyOf(page).account!.email}`,
  );
});

When(
  "the doctor confirms the email with the code from the letter",
  async ({ page }) => {
    await confirmFromLetter(page);
  },
);

Then(
  "the doctor lands on the page of «{}» with no screen in between",
  async ({ page }, title: string) => {
    await expectLandedOnEvent(page);
    await expect(page.getByRole("main")).toContainText(title);
  },
);

Then(
  "no success card, no «в личный кабинет» action and no points line is rendered after confirmation",
  async ({ page }) => {
    await expect(page.locator('[data-testid*="success"]')).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /в личный кабинет/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /в личный кабинет/i }),
    ).toHaveCount(0);
    await expect(page.getByTestId("registration-points-promise")).toHaveCount(
      0,
    );
    await expect(page.locator("body")).not.toContainText(/\bPul\b/);
  },
);

Then("the confirmation screen is gone from the document", async ({ page }) => {
  expect(new URL(page.url()).pathname).not.toBe("/verify");
  await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(
    0,
  );
  await expect(page.getByText("Проверьте почту")).toHaveCount(0);
});

// ── 021 EARS-3/6: a direct arrival, no marketing opt-in, onto the feed ──────

Given(
  "a guest doctor opens the registration route with no return target",
  async ({ page }) => {
    await freshGuest(page);
    // The guest has a remembered specialty (017 LD-2), chosen as a guest does:
    // in the storefront's specialty catalog. It is what LD-4 lands them on.
    await page.goto(`${base("doctor")}/`, { waitUntil: "load" });
    await waitForClientReady(page);
    const chosen = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/public/specialty-choice" &&
        response.request().method() === "POST",
    );
    await page
      .getByTestId("specialty-catalog")
      .getByRole("button", { name: "Кардиология", exact: true })
      .click();
    const response = await chosen;
    expect(response.status(), "the specialty choice is remembered").toBe(200);
    const { specialty } = (await response.json()) as {
      specialty: { code: string };
    };
    journeyOf(page).specialtyCode = specialty.code;
    await page.goto(`${base("doctor")}/register`, { waitUntil: "load" });
    await reachRegistrationForm(page);
    await waitForClientReady(page);
  },
);

Then(
  "the return-context element is absent from the DOM rather than rendered empty",
  async ({ page }) => {
    for (const testId of [
      "registration-return-context",
      "return-context-panel",
      "return-context-plate",
      "return-context-card",
    ]) {
      await expect(page.getByTestId(testId), testId).toHaveCount(0);
    }
    await expect(page.locator("[data-webinar-card]")).toHaveCount(0);
    // The panel's middle zone holds the value prop instead.
    await atViewport(page, WIDE, async () => {
      await expect(page.getByTestId("auth-brand-panel")).toBeVisible();
      await expect(page.getByTestId("auth-brand-panel")).toContainText(
        /[А-Яа-яЁё]{3,}/,
      );
    });
  },
);

When(
  "the doctor completes the form with both access-condition consents and leaves the marketing opt-in unticked",
  async ({ page }) => {
    await fillOwnedAccount(page, `Reg-${randomUUID()}-aA1!`);
    await tick(page, "register-medworker");
    await tick(page, "register-partner-data");
    await expect(page.getByTestId("register-marketing")).not.toBeChecked();
    const response = await submitRegistration(page);
    // What the browser sent: the two access conditions, no marketing purpose.
    const sent = response.request().postDataJSON() as {
      medicalWorkerDeclaration?: unknown;
      consent?: { purpose?: unknown }[];
    };
    expect(sent.medicalWorkerDeclaration).toBe(true);
    expect((sent.consent ?? []).map((c) => c.purpose)).toEqual([
      "partner-data-sharing",
    ]);
  },
);

When("confirms the email", async ({ page }) => {
  await confirmFromLetter(page);
});

Then("registration completes", async ({ page }) => {
  await page.waitForURL((url) => url.origin === origin("doctor"));
  await page.waitForLoadState("load");
  expect(await hasSession(page, "doctor"), "a doctor session").toBe(true);
  expect(await sessionStatus(page), "the session is live").toBe(200);
});

Then(
  "the doctor lands on the remembered specialty's 018 feed rather than the account page",
  async ({ page }) => {
    const code = journeyOf(page).specialtyCode!;
    expect(new URL(page.url()).pathname).toBe(`/feed/${code}`);
    await expect(page.locator('[data-surface="specialty-feed"]')).toBeVisible();
    // Nothing rendered on the way: the code's redirects led straight here.
    const rendered = journeyOf(page).documents.filter(
      (r) => r.status() === 200,
    );
    expect(rendered).toHaveLength(1);
    expect(new URL(rendered[0]!.url()).pathname).toBe(`/feed/${code}`);
  },
);
