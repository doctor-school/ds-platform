import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eventSlugFromDetail, signInAsAdmin } from "@ds/e2e/admin-events";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

import { sendOralSubmission } from "./support/congress-submissions";

// Staff MFA and the doctor's confirmation code must stay out of stage artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Stage congress review requires ${name}`);
  return value;
}

test("A program committee member accepts a speaker application and staff find its author on the roster", async ({
  page: staff,
  browser,
}) => {
  test.setTimeout(300_000);
  const adminOrigin = required("E2E_ADMIN_URL");
  const doctorOrigin = required("E2E_DOCTOR_URL");
  const slug = required("E2E_DOCTOR_CONGRESS_SLUG");
  const admin = {
    email: required("E2E_STAGE_ADMIN_EMAIL"),
    password: required("DS_STAGE_AGENT_ADMIN_PASSWORD"),
    totpSecret: required("DS_STAGE_AGENT_ADMIN_TOTP_SECRET"),
  };
  const committee = {
    email: required("E2E_STAGE_COMMITTEE_EMAIL"),
    password: required("DS_STAGE_AGENT_COMMITTEE_PASSWORD"),
    totpSecret: required("DS_STAGE_AGENT_COMMITTEE_TOTP_SECRET"),
  };
  const nonce = randomUUID();
  const author = {
    email: `e2e-review-${nonce}@ds.test`,
    password: `Doc-${nonce}-aA1!`,
  };
  const title = `Тестовый доклад ${nonce}`;
  const eventPath = `/events/${encodeURIComponent(slug)}`;
  const cabinet = new URL("/account/congress", doctorOrigin).href;
  const httpCredentials = standHttpCredentials();
  const authorContext = await browser.newContext({
    baseURL: doctorOrigin,
    locale: "ru-RU",
    httpCredentials,
  });
  const committeeContext = await browser.newContext({
    baseURL: adminOrigin,
    locale: "ru-RU",
    httpCredentials,
    viewport: { width: 1440, height: 900 },
  });

  try {
    // Authenticate before the browser journey so the next spec sharing this
    // staff account does not immediately challenge the same TOTP window.
    await test.step("Sign in as roster staff", async () => {
      await staff.setViewportSize({ width: 1440, height: 900 });
      await signInAsAdmin(staff, admin);
    });
    const doctor = await authorContext.newPage();
    const member = await committeeContext.newPage();
    const eventId =
      await test.step("Sign in as the event-bound committee member", async () => {
        await signInAsAdmin(member, committee);
        await expect(member).toHaveURL(/\/events\/[^/]+\/submissions$/);
        await expect(member.locator("header a")).toHaveCount(1);
        const navigation = member.getByTestId("nav-submissions");
        await expect(navigation).toHaveText("Заявки");
        await expect(navigation).toHaveAttribute(
          "href",
          new URL(member.url()).pathname,
        );
        return new URL(member.url()).pathname.split("/")[2]!;
      });

    const submission = doctor
      .getByTestId("congress-row")
      .filter({ hasText: title });
    await test.step("Register a fresh doctor and send an oral application", async () => {
      await provisionConfirmedAccount(browser, "doctor", doctorOrigin, author);
      await signInPageThroughHost(doctor, doctorOrigin, author);
      await doctor.goto(cabinet, { waitUntil: "domcontentloaded" });
      const eventLink = doctor.getByRole("link", {
        name: /Страница Конгресса/,
      });
      await expect(eventLink).toHaveAttribute("href", eventPath);
      await eventLink.click();
      await expect(doctor).toHaveURL(new URL(eventPath, doctorOrigin).href);
      await doctor.getByTestId("event-register-one-tap").click();
      await expect(
        doctor.getByText("Вы записаны", { exact: true }),
      ).toBeVisible();
      await sendOralSubmission({ page: doctor }, eventId, title);
      await doctor.goto(cabinet, { waitUntil: "domcontentloaded" });
      await expect(submission).toHaveAttribute("data-status", "submitted");
    });

    await test.step("Open the sent application and accept it as the committee member", async () => {
      await member.reload({ waitUntil: "domcontentloaded" });
      await member
        .getByRole("searchbox", { name: "Поиск по теме и авторам" })
        .fill(title);
      const row = member.locator("table tbody tr").filter({ hasText: title });
      await expect(row.getByTestId("submissions-cell-status")).toHaveText(
        "Отправлена",
      );
      await row.getByRole("button").first().click();
      await expect(member.getByTestId("submission-card-title")).toHaveText(
        title,
      );
      await expect(member.getByTestId("submission-card-email")).toHaveText(
        author.email,
      );
      await member
        .getByTestId("submission-decision-status")
        .selectOption("accepted");
      await member.getByTestId("submission-decision-submit").click();
      await expect(member.getByTestId("submission-card-status")).toHaveText(
        "Принята",
      );
      await expect(
        member.getByTestId("submission-decision-saved"),
      ).toContainText("Решение сохранено.");
    });

    await test.step("Read the saved decision in the author's cabinet", async () => {
      await doctor.reload({ waitUntil: "domcontentloaded" });
      await expect(submission).toHaveAttribute("data-status", "accepted");
      await expect(submission).toContainText("Принята");
    });

    await test.step("Find the same doctor in the event roster as staff", async () => {
      expect(await eventSlugFromDetail(staff, eventId)).toBe(slug);
      await staff.goto(`/events/${eventId}`, { waitUntil: "domcontentloaded" });
      await staff.getByTestId("event-roster-link").click();
      await expect(staff).toHaveURL(`${adminOrigin}/events/${eventId}/roster`);
      await expect(staff.getByRole("heading", { level: 1 })).toHaveText(
        "Реестр участников",
      );
      await staff
        .getByRole("searchbox", { name: "Поиск участника" })
        .fill(author.email);
      await expect(staff.getByTestId("roster-total")).toHaveText("Найдено: 1");
      const row = staff.getByTestId("roster-table").locator("tbody tr");
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId("roster-cell-registeredAt")).not.toBeEmpty();
      await row.getByRole("button").first().click();
      await expect(staff.getByTestId("participant-card-email")).toHaveText(
        author.email,
      );
    });
  } finally {
    await Promise.all([authorContext.close(), committeeContext.close()]);
  }
});
