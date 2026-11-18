import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createPublishedEvent,
  eventSlugFromDetail,
  openEventLive,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { signInPageThroughHost } from "@ds/e2e/host-sign-in";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

// The stage workflow publishes its reports. Keep the staff login and MFA
// challenge out of the trace and captures, including on a failed attempt.
test.use({ trace: "off", screenshot: "off", video: "off" });

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Stage event lifecycle requires ${name}`);
  return value;
}

test("Staff publishes an event on both storefronts and ends its open room", async ({
  page: admin,
  browser,
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
  const title = `Тестовый эфир ${randomUUID()}`;
  // The same public Rutube video linked in the Academy's footer fixtures.
  const embedRef = "a682bead10b37ce96beef4f3a6d59b08";

  await signInAsAdmin(admin, staffCredentials);
  const id = await createPublishedEvent(admin, title, {
    startsInMs: 5 * 60_000,
    audience: "doctors",
    rutubeEmbedRef: embedRef,
  });
  const slug = encodeURIComponent(await eventSlugFromDetail(admin, id));

  const context = await browser.newContext({
    locale: "ru-RU",
    httpCredentials: standHttpCredentials(),
  });
  try {
    const doctor = await context.newPage();
    // Discovery lists are audience-scoped. The two public detail URLs must
    // present the same title from the freshly published event.
    const doctorPath = `/events/${slug}`;
    const doctorUrl = new URL(doctorPath, doctorOrigin).href;
    for (const url of [
      new URL(`/webinars/${slug}`, academyOrigin).href,
      doctorUrl,
    ]) {
      await doctor.goto(url);
      await expect(doctor).toHaveURL(url);
      await expect(
        doctor.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    }

    try {
      await signInPageThroughHost(doctor, doctorOrigin, doctorCredentials);
    } catch {
      throw new Error(
        "The stage doctor could not sign in through the sign-in host",
      );
    }
    await doctor.goto(doctorUrl);
    await doctor.getByTestId("event-register-one-tap").click();
    await expect(
      doctor.getByText("Вы записаны", { exact: true }),
    ).toBeVisible();

    await openEventLive(admin);
    const roomUrl = `${doctorUrl}/room`;
    await doctor.goto(roomUrl, { waitUntil: "domcontentloaded" });
    await expect(doctor).toHaveURL(roomUrl);
    const player = doctor.getByTestId("room-player-rutube");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute(
      "src",
      `https://rutube.ru/play/embed/${embedRef}`,
    );

    await admin.getByTestId("action-close").click();
    await expect(admin.getByTestId("state-ended")).toBeVisible();

    // The already-open room learns about the close on an authenticated
    // heartbeat. Wait for the real delivery (the stage cadence is 60 seconds).
    await doctor.bringToFront();
    await expect(doctor.getByTestId("room-player-ended")).toBeVisible({
      timeout: 75_000,
    });
    await expect(player).toHaveCount(0);
    await expect(doctor).toHaveURL(roomUrl);
  } finally {
    await context.close();
  }
});
