import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import {
  createDraftEvent,
  eventSlugFromDetail,
  openEventLive,
  publishEvent,
  retireEventFromStorefronts,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { signInPageThroughHost } from "@ds/e2e/host-sign-in";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

const test = base.extend<{ ownedEvent: { id?: string } }>({
  ownedEvent: async ({ page }, use) => {
    const event: { id?: string } = {};
    await use(event);
    const id = event.id;
    if (id) {
      await test.step("Retire the event created by this run", async () => {
        await retireEventFromStorefronts(page, id);
      });
    }
  },
});

// The stage workflow publishes its reports. Keep the staff login and MFA
// challenge out of the trace and captures, including on a failed attempt.
test.use({ trace: "off", screenshot: "off", video: "off" });

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim())
    throw new Error(`Stage recording publish requires ${name}`);
  return value;
}

/** The one visible copy of a row control (the history list renders twice). */
function visibleByTestId(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

/**
 * The signed-in doctor's event page shows the published recording in the
 * player card: the edited cut's frame with its source, never the readiness
 * plaque or the guest gate.
 */
async function expectRecordingPlays(
  page: Page,
  url: string,
  title: string,
  embedRef: string,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const frame = page.getByTestId("recording-player-rutube");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute(
    "src",
    `https://rutube.ru/play/embed/${embedRef}`,
  );
  await expect(frame).toHaveAttribute("title", /Монтаж/);
  await expect(page.getByTestId("recording-plaque")).toHaveCount(0);
  await expect(page.getByTestId("recording-gate")).toHaveCount(0);
}

test("Staff attaches and publishes a recording and it plays on both storefronts", async ({
  page: admin,
  browser,
  ownedEvent,
}) => {
  test.setTimeout(240_000);
  const staffCredentials = {
    email: required("E2E_STAGE_ADMIN_EMAIL"),
    password: required("DS_STAGE_AGENT_ADMIN_PASSWORD"),
    totpSecret: required("DS_STAGE_AGENT_ADMIN_TOTP_SECRET"),
  };
  const doctorCredentials = {
    email: required("E2E_DOCTOR_EMAIL"),
    password: required("E2E_DOCTOR_PASSWORD"),
  };
  const doctorOrigin = required("E2E_DOCTOR_URL");
  const academyOrigin = required("E2E_PORTAL_URL");
  const title = `Тестовая запись ${randomUUID()}`;
  // The same public Rutube video linked in the Academy's footer fixtures.
  const embedRef = "a682bead10b37ce96beef4f3a6d59b08";

  await test.step("Take a new event through published, live and ended", async () => {
    await signInAsAdmin(admin, staffCredentials);
    ownedEvent.id = await createDraftEvent(admin, title, {
      startsInMs: 5 * 60_000,
      audience: "doctors",
    });
    await admin.getByTestId("provider").selectOption("rutube");
    await admin.getByTestId("embed-ref").fill(embedRef);
    await admin.getByTestId("save-stream").click();
    await expect(admin.getByTestId("stream-ok")).toBeVisible();
    // Saving the stream advances the event version; publish from a fresh read.
    await admin.reload({ waitUntil: "domcontentloaded" });
    await expect(admin.getByTestId("state-draft")).toBeVisible();
    await publishEvent(admin);
    await openEventLive(admin);
    await admin.getByTestId("action-close").click();
    await expect(admin.getByTestId("state-ended")).toBeVisible();
  });

  await test.step("Attach the edited recording and publish it", async () => {
    await admin.getByTestId("tab-recordings").click();
    await expect(admin.getByTestId("recordings-panel")).toBeVisible();
    await expect(admin.getByTestId("recordings-event-state")).toContainText(
      "Эфир завершён",
    );
    const attach = "recording-attach-edited";
    await admin.getByTestId(attach).click();
    await expect(admin.getByTestId(`${attach}-form`)).toBeVisible();
    await admin.getByTestId(`${attach}-provider`).selectOption("rutube");
    await admin.getByTestId(`${attach}-embed-ref`).fill(embedRef);
    await admin.getByTestId(`${attach}-submit`).click();
    await expect(admin.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    const publish = "recording-edited-publish";
    await visibleByTestId(admin, publish).click();
    const dialog = admin.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await visibleByTestId(admin, `${publish}-submit`).click();
    await expect(dialog).toBeHidden();
    await expect(admin.getByTestId("recording-status-edited")).toContainText(
      "Опубликована",
    );
  });

  const slug = encodeURIComponent(
    await eventSlugFromDetail(admin, ownedEvent.id!),
  );
  for (const [storefront, origin, path] of [
    ["Academy", academyOrigin, `/webinars/${slug}`],
    ["doctor.school", doctorOrigin, `/events/${slug}`],
  ] as const) {
    await test.step(`The recording plays on the ${storefront} event page`, async () => {
      // A fresh context per storefront: the password sign-in expects the
      // sign-in host's form, which an earlier session in the same context skips.
      const context = await browser.newContext({
        locale: "ru-RU",
        httpCredentials: standHttpCredentials(),
      });
      try {
        const doctor = await context.newPage();
        try {
          await signInPageThroughHost(doctor, origin, doctorCredentials);
        } catch {
          throw new Error(
            `The stage doctor could not sign in on the ${storefront} storefront`,
          );
        }
        await expectRecordingPlays(
          doctor,
          new URL(path, origin).href,
          title,
          embedRef,
        );
      } finally {
        await context.close();
      }
    });
  }
});
