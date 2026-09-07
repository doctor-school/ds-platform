import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * 021 EARS-6 (#1542) — the marketing opt-in is GENUINELY optional — and the
 * EARS-7 (#1543) half of the record promise that only the browser can show.
 *
 * "Optional" is not a label: it is the absence of every mechanism that would
 * make withholding cost something. So what is pinned here is behavioural and
 * negative — never pre-ticked in ANY state, never named as a reason the submit
 * is blocked, and, when left alone, simply absent from the command body. That
 * absence is the whole clause: an ungranted purpose produces no record at all,
 * and `consent_records` is append-only, so a row sent by accident is permanent.
 *
 * The EARS-7 assertion here is likewise a negative one: the block states that a
 * change or withdrawal goes through a platform manager (the manager-side
 * operation of feature 037), and NO self-service control contradicts it. A
 * toggle or an "отозвать" link would promise a mechanism this surface does not
 * have. The row-level guarantees — one versioned, dated row per granted
 * purpose, the server-stamped wording version, no row for an undeclared
 * purpose — are proven against real Postgres in
 * `apps/api/test/storefront/doctor-register-consents.e2e-spec.ts`.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the register command is
 * intercepted at the network boundary exactly as
 * `register-bot-protection.spec.ts` does it, which is what makes the SENT BODY
 * assertable without a running API.
 */
const REGISTER_ROUTE = "**/v1/storefront/doctor/register";
const MARKETING_PURPOSE = "marketing-communications";
const PARTNER_PURPOSE = "partner-data-sharing";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

/** Tick a consent through its label — the checkbox primitive own hit area. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** Fill the door to the point where the command is reachable. */
async function fillRegistration(page: Page) {
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
}

/** The enumeration-safe registration answer — identical for every address. */
async function acceptRegistration(page: Page) {
  await page.route(REGISTER_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending_verification" }),
    }),
  );
}

function sentPurposes(request: Request): string[] {
  const parsed = JSON.parse(request.postData() ?? "{}") as {
    consent?: { purpose: string }[];
  };
  return (parsed.consent ?? []).map((entry) => entry.purpose);
}

test.describe("021 EARS-6: the marketing opt-in is genuinely optional", () => {
  test("021 EARS-6.1: the opt-in is unticked on load and stays unticked while the door is filled", async ({
    page,
  }) => {
    await page.goto("/register");

    const marketing = page.getByTestId("register-marketing");
    await expect(marketing, "never pre-ticked on load").not.toBeChecked();

    // The state that would betray a nudge: everything else satisfied. Ticking
    // an access condition must not carry the optional opt-in with it, and the
    // submit turning live must not tick it either.
    await fillRegistration(page);
    await expect(
      marketing,
      "never pre-ticked once the access conditions are met",
    ).not.toBeChecked();
    await expect(page.getByTestId("register-submit")).toBeEnabled();
    await expect(
      marketing,
      "never pre-ticked by the submit turning live",
    ).not.toBeChecked();
  });

  test("021 EARS-6.2: the blocked submit never names the marketing opt-in as a reason", async ({
    page,
  }) => {
    await page.goto("/register");

    // Blocked at its most blocked: nothing filled at all. If withholding the
    // opt-in ever cost the doctor anything, this line is where it would say so.
    const reason = page.getByTestId("register-submit-reason");
    await expect(page.getByTestId("register-submit")).toBeDisabled();
    await expect(reason).toBeVisible();
    await expect(reason).not.toContainText(/рассылк|маркетинг|материал/i);

    // And the opt-in is marked optional on its own label rather than merely
    // being left out of the reason line.
    await expect(
      page.getByTestId("register-marketing-optional-tag"),
    ).toBeVisible();
  });

  test("021 EARS-6.3: left alone, the opt-in sends no consent entry at all", async ({
    page,
  }) => {
    await page.goto("/register");
    await acceptRegistration(page);

    const sent = page.waitForRequest(REGISTER_ROUTE);
    await fillRegistration(page);
    await page.getByTestId("register-submit").click();

    const purposes = sentPurposes(await sent);
    // No "granted: false" entry, no empty-version placeholder — nothing. That
    // absence is what "no record at all when withheld" means at the wire.
    expect(purposes).not.toContain(MARKETING_PURPOSE);
    // The access condition IS there, so this is a real submit and not an empty
    // array from a body that failed to build.
    expect(purposes).toContain(PARTNER_PURPOSE);
  });

  test("021 EARS-6.4: ticked, the opt-in sends exactly one marketing entry and the door behaves identically", async ({
    page,
  }) => {
    await page.goto("/register");
    await acceptRegistration(page);

    const sent = page.waitForRequest(REGISTER_ROUTE);
    await fillRegistration(page);
    await tick(page, "register-marketing");
    // Granting it changes nothing about reaching the door.
    await expect(page.getByTestId("register-submit")).toBeEnabled();
    await page.getByTestId("register-submit").click();

    const purposes = sentPurposes(await sent);
    // Exactly one — a duplicate would make "the granted version" ambiguous for
    // the manager view that reads these rows.
    expect(purposes.filter((purpose) => purpose === MARKETING_PURPOSE)).toEqual([
      MARKETING_PURPOSE,
    ]);
    expect(purposes).toContain(PARTNER_PURPOSE);
  });
});

test.describe("021 EARS-7: one record per purpose, changed only through a manager", () => {
  test("021 EARS-7.1: the block states that a change or withdrawal goes through a platform manager", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(
      page.getByText(/через менеджера платформы/i).first(),
      "the withdrawal route is stated on the surface, not left implicit",
    ).toBeVisible();
  });

  test("021 EARS-7.2: no self-service withdrawal control contradicts that statement", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(page.getByTestId("register-marketing")).toHaveCount(1);

    // A switch reads as "flip it back whenever you like" — the opposite of a
    // dated, append-only record changed through a manager.
    await expect(page.locator("[role=switch]")).toHaveCount(0);

    // Any actionable control OFFERING withdrawal, by its accessible name —
    // scanned across the whole surface rather than inside the consent block, so
    // moving such a control elsewhere could not hide it from this assertion.
    const withdrawalControls = await page.evaluate(() => {
      const pattern = /отозв|отзыв|withdraw/i;
      const nodes = Array.from(
        document.querySelectorAll(
          "button, a[href], input[type=checkbox], input[type=radio], [role=button], [role=link], [role=checkbox], [role=switch]",
        ),
      );
      return nodes
        .map((node) =>
          [node.getAttribute("aria-label"), node.textContent]
            .filter(Boolean)
            .join(" "),
        )
        .filter((name) => pattern.test(name));
    });
    expect(withdrawalControls).toEqual([]);
  });
});
