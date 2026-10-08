import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

type RevealSurface = "registration" | "reset-complete" | "password login";
interface RevealVisitor extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  surface: RevealSurface;
  resetRequests: number;
  resetInputsMatch: boolean[];
  resetSetCookie: string;
  otherAuthCommands: number;
}

const visitors = new WeakMap<Page, RevealVisitor>();
const SELECTION = { start: 2, end: 7, direction: "forward" } as const;

function visitor(key: Page): RevealVisitor {
  const state = visitors.get(key);
  if (!state) throw new Error("Password-reveal visitor was not prepared");
  return state;
}

function passwordField(state: RevealVisitor): Locator {
  const purpose =
    state.surface === "password login" ? "current-password" : "new-password";
  return state.page.locator(`input[autocomplete="${purpose}"]`);
}

function toggle(state: RevealVisitor): Locator {
  return state.page.getByRole("button", {
    name: /^(Показать|Скрыть) пароль$/,
  });
}

async function assertValueAndCaret(state: RevealVisitor): Promise<void> {
  expect(
    await passwordField(state).evaluate(
      (element, expected) => {
        const input = element as HTMLInputElement;
        return {
          sameValue: input.value === expected.password,
          sameSelection:
            input.selectionStart === expected.selection.start &&
            input.selectionEnd === expected.selection.end &&
            input.selectionDirection === expected.selection.direction,
        };
      },
      { password: state.password, selection: SELECTION },
    ),
    "reveal preserves the entered password and selection",
  ).toEqual({ sameValue: true, sameSelection: true });
}

async function assertToggleState(
  state: RevealVisitor,
  revealed: boolean,
): Promise<void> {
  await expect(passwordField(state)).toHaveAttribute(
    "type",
    revealed ? "text" : "password",
  );
  await expect(toggle(state)).toHaveAttribute("type", "button");
  await expect(toggle(state)).toHaveAttribute("aria-pressed", String(revealed));
  await expect(toggle(state)).toHaveAccessibleName(
    revealed ? "Скрыть пароль" : "Показать пароль",
  );
  await expect(toggle(state)).toHaveText(revealed ? "Скрыть" : "Показать");
  const inputId = await passwordField(state).getAttribute("id");
  expect(inputId, "toggle controls a named password field").toBeTruthy();
  await expect(toggle(state)).toHaveAttribute("aria-controls", inputId!);
}

Given(
  /^an Academy guest on the (registration|reset-complete|password login) password-reveal form$/,
  async ({ page, browser, httpCredentials, world }, surface: RevealSurface) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: RevealVisitor = {
      context,
      page: owned,
      surface,
      email: `reveal-2729-${randomUUID()}@example.test`,
      password: `Unsubmitted-${randomUUID()}-aA1!`,
      resetRequests: 0,
      resetInputsMatch: [],
      resetSetCookie: "",
      otherAuthCommands: 0,
    };
    visitors.set(page, state);
    owned.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/v1/auth/")) return;
      if (path !== "/v1/auth/password/reset") {
        state.otherAuthCommands += 1;
        return;
      }
      state.resetRequests += 1;
      try {
        const body: unknown = JSON.parse(request.postData() ?? "");
        state.resetInputsMatch.push(
          body !== null &&
            typeof body === "object" &&
            Object.keys(body).length === 1 &&
            "identifier" in body &&
            body.identifier === state.email,
        );
      } catch {
        state.resetInputsMatch.push(false);
      }
    });
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "password-reveal visitor starts without a private session",
    ).toBe(false);
    if (surface === "reset-complete") await installCaptchaStub(context);
    const path =
      surface === "registration"
        ? "/register"
        : surface === "reset-complete"
          ? "/reset"
          : world.host.loginPath;
    await owned.goto(new URL(path, world.hostBaseUrl).toString(), {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    if (surface === "reset-complete") {
      await inputSecret(
        owned.locator('input[autocomplete="username"]'),
        state.email,
      );
      const pending = owned.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/password/reset" &&
          response.request().method() === "POST",
      );
      await owned.getByTestId("reset-request-submit").click();
      const response = await pending;
      expect(response.status(), "real reset initiation accepted").toBe(200);
      const acknowledgement: unknown = await response.json().catch(() => null);
      expect(
        acknowledgement !== null &&
          typeof acknowledgement === "object" &&
          Object.keys(acknowledgement).length === 1 &&
          "status" in acknowledgement &&
          acknowledgement.status === "reset_requested",
        "real reset initiation acknowledges the complete step neutrally",
      ).toBe(true);
      state.resetSetCookie = (await response.headerValue("set-cookie")) ?? "";
      await expect(
        owned.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
    }
    await expect(passwordField(state)).toBeVisible();
    await assertToggleState(state, false);
  },
);

When(
  "the reveal visitor enters a password and selects a caret range",
  async ({ page }) => {
    const state = visitor(page);
    await inputSecret(passwordField(state), state.password);
    await passwordField(state).focus();
    await passwordField(state).evaluate((element, selection) => {
      (element as HTMLInputElement).setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
    }, SELECTION);
    await assertValueAndCaret(state);
  },
);

Then(
  "the reveal field is masked by default and its localized toggle is unpressed",
  async ({ page }) => {
    await assertToggleState(visitor(page), false);
  },
);

When(
  "the reveal visitor tabs to the toggle and reveals with Space",
  async ({ page }) => {
    const state = visitor(page);
    await expect(passwordField(state)).toBeFocused();
    await state.page.keyboard.press("Tab");
    await expect(toggle(state)).toBeFocused();
    await state.page.keyboard.press("Space");
  },
);

Then(
  "the reveal field is plain with a pressed localized hide action and unchanged value and caret",
  async ({ page }) => {
    const state = visitor(page);
    await assertToggleState(state, true);
    await expect(toggle(state)).toBeFocused();
    await assertValueAndCaret(state);
  },
);

When("the reveal visitor masks again with Enter", async ({ page }) => {
  const state = visitor(page);
  await expect(toggle(state)).toBeFocused();
  await state.page.keyboard.press("Enter");
});

Then(
  "the reveal field is masked with an unpressed localized show action and unchanged value and caret",
  async ({ page }) => {
    const state = visitor(page);
    await assertToggleState(state, false);
    await expect(toggle(state)).toBeFocused();
    await assertValueAndCaret(state);
  },
);

Then(
  "revealing issued no registration, password-login or reset-completion request and grants no private access",
  async ({ page }) => {
    const state = visitor(page);
    await state.page.waitForLoadState("networkidle");
    expect(state.otherAuthCommands, "no credential submission").toBe(0);
    const reset = state.surface === "reset-complete";
    expect(state.resetRequests, "only the reset prerequisite is sent").toBe(
      reset ? 1 : 0,
    );
    expect(state.resetInputsMatch, "reset uses only the owned address").toEqual(
      reset ? [true] : [],
    );
    await assertNoPrivateRegistrationAccess(
      state.page,
      state.resetSetCookie,
      state,
    );
  },
);

After("@password-reveal", async ({ page }) => {
  const state = visitors.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    visitors.delete(page);
  }
});
