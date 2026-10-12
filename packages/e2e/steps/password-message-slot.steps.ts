import { randomUUID } from "node:crypto";
import { expect, type ElementHandle, type Page } from "@playwright/test";

import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registrationUrl,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { Given, Then, When } from "./support/auth-fixtures.js";

interface PasswordMessageSlot extends OwnedCredentials {
  description: string;
  messageId: string;
  message: ElementHandle<HTMLElement | SVGElement> | null;
  rule: string;
  registrationRequests: number;
}

const slots = new WeakMap<Page, PasswordMessageSlot>();
const passwordField = (page: Page) => page.getByTestId("register-password");
const passwordGroup = (page: Page) =>
  passwordField(page).locator("xpath=../..");

function slot(page: Page): PasswordMessageSlot {
  const state = slots.get(page);
  if (!state) throw new Error("The original password message was not captured");
  return state;
}

async function formInteractions(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          passwordMessageSlotInteractions: string[];
        }
      ).passwordMessageSlotInteractions,
  );
}

async function expectOneRule(page: Page) {
  await expect(passwordGroup(page).locator("p")).toHaveCount(1);
  await expect(passwordGroup(page)).toHaveText(
    /^Показать\s*(?:⚠\s*)?Не менее 8 символов\.?$/,
  );
  const form = page.getByTestId("registration-form");
  await expect(form.getByText(/^(?:⚠\s*)?Не менее 8 символов\.?$/)).toHaveCount(
    1,
  );
  await expect(
    form.locator(
      'ul:visible, ol:visible, [role="list"]:visible, meter:visible, progress:visible, [role="meter"]:visible, [role="progressbar"]:visible',
    ),
  ).toHaveCount(0);
}

Given(
  "an Academy visitor captures the untouched registration password message and its single rule",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    const state: PasswordMessageSlot = {
      email: `register-2765-${randomUUID()}@example.test`,
      password: "sapling",
      description: "",
      messageId: "",
      message: null,
      rule: "",
      registrationRequests: 0,
    };
    slots.set(page, state);
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/auth/register"
      ) {
        state.registrationRequests += 1;
      }
    });
    await page.addInitScript(() => {
      const interactions: string[] = [];
      Object.defineProperty(window, "passwordMessageSlotInteractions", {
        value: interactions,
      });
      for (const type of ["focus", "input", "blur", "submit"]) {
        document.addEventListener(
          type,
          (event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-testid="registration-form"]')
            ) {
              interactions.push(type);
            }
          },
          true,
        );
      }
    });
    await page.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await expect(page.getByTestId("registration-form")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const field = passwordField(page);
    await expect(field).toHaveValue("");
    await expect(field).not.toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "false");
    expect(await formInteractions(page), "untouched registration form").toEqual(
      [],
    );
    state.description = (await field.getAttribute("aria-describedby")) ?? "";
    const ids = state.description.trim().split(/\s+/);
    expect(ids, "one original associated message").toHaveLength(1);
    expect(ids[0]).not.toBe("");
    state.messageId = ids[0]!;
    const message = page.locator(`[id="${state.messageId}"]`);
    await expect(message).toHaveCount(1);
    await expect(message).toBeVisible();
    await expect(message).not.toHaveAttribute("role", "alert");
    await expect(message).toHaveText(/^Не менее 8 символов\.?$/);
    state.message = await message.elementHandle();
    expect(
      state.message,
      "the original message element was captured",
    ).not.toBeNull();
    state.rule = (await message.innerText()).trim().replace(/\.$/, "");
    await expectOneRule(page);
    expect(state.registrationRequests).toBe(0);
    await assertNoPrivateRegistrationAccess(page, "", state);
  },
);

When(
  "that visitor attempts the normal registration submit with a seven-character password",
  async ({ page }) => {
    const state = slot(page);
    expect(state.password.length, "short-password boundary").toBe(7);
    await inputSecret(page.getByTestId("register-email"), state.email);
    await inputSecret(passwordField(page), state.password);
    await page.getByTestId("register-submit").click();
    await expect(passwordField(page)).toHaveAttribute("aria-invalid", "true");
    expect(
      (await formInteractions(page)).filter((type) => type === "submit"),
      "one normal form submission was attempted",
    ).toHaveLength(1);
    await page.waitForLoadState("networkidle");
  },
);

Then(
  "the same single associated password message becomes the alert naming the original rule without a coexisting hint, checklist or meter",
  async ({ page }) => {
    const state = slot(page);
    const description =
      (await passwordField(page).getAttribute("aria-describedby")) ?? "";
    const ids = description.trim().split(/\s+/);
    expect(ids[0], "the invalid field has an associated message").not.toBe("");
    expect(new Set(ids).size, "no duplicate message associations").toBe(
      ids.length,
    );
    const message = page.locator(ids.map((id) => `[id="${id}"]`).join(", "));
    await expect(message).toHaveCount(1);
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute("role", "alert");
    expect(
      await state.message!.evaluate(
        (original, associatedIds) =>
          original.isConnected &&
          associatedIds.includes(original.id) &&
          document.getElementById(original.id) === original,
        ids,
      ),
      "the originally captured message node is still the associated slot",
    ).toBe(true);
    await expect(page.locator(`[id="${state.messageId}"]`)).toHaveCount(0);
    await expect
      .poll(async () =>
        (await message.ariaSnapshot())
          .replace(/^- alert: /, "")
          .replace(/\.$/, ""),
      )
      .toBe(state.rule);
    await expect(
      page.getByTestId("registration-form").getByRole("alert"),
    ).toHaveCount(1);
    await expectOneRule(page);
    await expect(page.getByTestId("register-command-error")).toHaveCount(0);
    await expect(page.getByTestId("register-captcha-error")).toHaveCount(0);
  },
);

Then(
  "the message-slot refusal sends no registration POST and grants no private access",
  async ({ page, world }) => {
    const state = slot(page);
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(world.hostBaseUrl).origin);
    expect(url.pathname).toBe("/register");
    expect(url.searchParams.get("returnTo")).toBe("/account");
    expect(state.registrationRequests, "no registration command was sent").toBe(
      0,
    );
    await assertNoPrivateRegistrationAccess(page, "", state);
  },
);
