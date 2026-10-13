import { createHash, randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registrationUrl,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface RevealEffects {
  storageCalls: number;
  cookieWrites: number;
  historyWrites: number;
  sameStores: boolean;
  sameHistory: boolean;
}
interface RevealWindow extends Window {
  __revealEffects2905?: { finish(): RevealEffects };
  __revealDocument2905?: string;
}
interface RevealReload extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  observer: CDPSession;
  document: string;
  effects?: RevealEffects & {
    requests: number;
    logs: number;
    storageEvents: number;
    sameCookies: boolean;
  };
}

const visitors = new WeakMap<Page, RevealReload>();
const SELECTION = { start: 2, end: 7, direction: "forward" } as const;

function visitor(key: Page): RevealReload {
  const state = visitors.get(key);
  if (!state) throw new Error("Password-reveal reload visitor not prepared");
  return state;
}

function field(state: RevealReload): Locator {
  return state.page.locator('input[autocomplete="new-password"]');
}

function toggle(state: RevealReload): Locator {
  return state.page.getByRole("button", {
    name: /^(Показать|Скрыть) пароль$/,
  });
}

async function assertToggle(state: RevealReload, revealed: boolean) {
  await expect(field(state)).toHaveAttribute(
    "type",
    revealed ? "text" : "password",
  );
  await expect(toggle(state)).toHaveAttribute("type", "button");
  await expect(toggle(state)).toHaveAttribute("aria-pressed", String(revealed));
  await expect(toggle(state)).toHaveAccessibleName(
    revealed ? "Скрыть пароль" : "Показать пароль",
  );
}

async function assertValueAndCaret(state: RevealReload) {
  expect(
    await field(state).evaluate(
      (element, expected) => {
        const input = element as HTMLInputElement;
        return {
          sameValue: input.value === expected.password,
          sameCaret:
            input.selectionStart === expected.selection.start &&
            input.selectionEnd === expected.selection.end &&
            input.selectionDirection === expected.selection.direction,
        };
      },
      { password: state.password, selection: SELECTION },
    ),
    "actual reveal preserves password and caret",
  ).toEqual({ sameValue: true, sameCaret: true });
}

Given(
  "a clean Academy guest has entered an owned password on the ready registration form with the account return target",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: RevealReload = {
      context,
      page: owned,
      observer: await context.newCDPSession(owned),
      document: randomUUID(),
      email: `reveal-reload-2905-${randomUUID()}@example.test`,
      password: `Unsubmitted-${randomUUID()}-aA1!`,
    };
    visitors.set(page, state);
    await owned.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    await expect(field(state)).toBeVisible();
    await expect(toggle(state)).toBeEnabled();
    await assertToggle(state, false);
    await inputSecret(field(state), state.password);
    await field(state).focus();
    await field(state).evaluate((element, selection) => {
      (element as HTMLInputElement).setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
    }, SELECTION);
    await assertValueAndCaret(state);
    await assertNoPrivateRegistrationAccess(owned, "", state);
    await owned.waitForLoadState("networkidle");
  },
);

When(
  "the ready guest reveals that password during a bounded side-effect observation",
  async ({ page }) => {
    const state = visitor(page);
    let requests = 0;
    let logs = 0;
    let storageEvents = 0;
    const request = () => {
      requests += 1;
    };
    const log = () => {
      logs += 1;
    };
    const storage = () => {
      storageEvents += 1;
    };
    await state.observer.send("DOMStorage.enable");
    await state.observer.send("Log.enable");
    // Only a digest is retained in Node; cookie bytes never enter assertions.
    const cookiesBefore = createHash("sha256")
      .update(JSON.stringify(await state.context.cookies()))
      .digest("hex");
    await state.page.evaluate((document) => {
      const target = window as RevealWindow;
      target.__revealDocument2905 = document;
      const storesBefore = JSON.stringify({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
        cookie: globalThis.document.cookie,
      });
      const historyBefore = JSON.stringify({
        url: location.href,
        length: history.length,
        state: history.state,
      });
      let storageCalls = 0;
      let cookieWrites = 0;
      let historyWrites = 0;
      const originals = {
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        clear: Storage.prototype.clear,
        pushState: history.pushState,
        replaceState: history.replaceState,
      };
      const historyDescriptors = {
        pushState: Object.getOwnPropertyDescriptor(history, "pushState"),
        replaceState: Object.getOwnPropertyDescriptor(history, "replaceState"),
      };
      Storage.prototype.setItem = function (...args) {
        storageCalls += 1;
        return originals.setItem.apply(this, args);
      };
      Storage.prototype.removeItem = function (...args) {
        storageCalls += 1;
        return originals.removeItem.apply(this, args);
      };
      Storage.prototype.clear = function () {
        storageCalls += 1;
        return originals.clear.call(this);
      };
      const cookie = Object.getOwnPropertyDescriptor(
        Document.prototype,
        "cookie",
      )!;
      Object.defineProperty(Document.prototype, "cookie", {
        ...cookie,
        set(value: string) {
          cookieWrites += 1;
          cookie.set!.call(this, value);
        },
      });
      for (const method of ["pushState", "replaceState"] as const) {
        history[method] = function (...args) {
          historyWrites += 1;
          return originals[method].apply(this, args);
        };
      }
      const navigation = () => {
        historyWrites += 1;
      };
      addEventListener("hashchange", navigation);
      addEventListener("popstate", navigation);
      target.__revealEffects2905 = {
        finish() {
          Storage.prototype.setItem = originals.setItem;
          Storage.prototype.removeItem = originals.removeItem;
          Storage.prototype.clear = originals.clear;
          for (const method of ["pushState", "replaceState"] as const) {
            const descriptor = historyDescriptors[method];
            if (descriptor) Object.defineProperty(history, method, descriptor);
            else Reflect.deleteProperty(history, method);
          }
          Object.defineProperty(Document.prototype, "cookie", cookie);
          removeEventListener("hashchange", navigation);
          removeEventListener("popstate", navigation);
          delete target.__revealEffects2905;
          return {
            storageCalls,
            cookieWrites,
            historyWrites,
            sameStores:
              storesBefore ===
              JSON.stringify({
                local: Object.entries(localStorage),
                session: Object.entries(sessionStorage),
                cookie: globalThis.document.cookie,
              }),
            sameHistory:
              historyBefore ===
              JSON.stringify({
                url: location.href,
                length: history.length,
                state: history.state,
              }),
          };
        },
      };
    }, state.document);
    state.page.on("request", request);
    state.page.on("console", log);
    state.page.on("pageerror", log);
    state.observer.on("Log.entryAdded", log);
    const mutations = [
      "DOMStorage.domStorageItemAdded",
      "DOMStorage.domStorageItemUpdated",
      "DOMStorage.domStorageItemRemoved",
      "DOMStorage.domStorageItemsCleared",
    ] as const;
    for (const mutation of mutations) state.observer.on(mutation, storage);
    let effects: RevealEffects | undefined;
    let cookiesAfter: string | undefined;
    try {
      await toggle(state).click();
      await assertToggle(state, true);
      await assertValueAndCaret(state);
      // A 500ms negative-observation window includes rendering and queued callbacks.
      await state.page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => setTimeout(resolve, 500)),
            );
          }),
      );
      await state.page.waitForLoadState("networkidle");
      effects = await state.page.evaluate(() =>
        (window as RevealWindow).__revealEffects2905!.finish(),
      );
      cookiesAfter = createHash("sha256")
        .update(JSON.stringify(await state.context.cookies()))
        .digest("hex");
    } finally {
      try {
        await state.page.evaluate(() =>
          (window as RevealWindow).__revealEffects2905?.finish(),
        );
      } finally {
        state.page.off("request", request);
        state.page.off("console", log);
        state.page.off("pageerror", log);
        state.observer.off("Log.entryAdded", log);
        for (const mutation of mutations) state.observer.off(mutation, storage);
        await Promise.all([
          state.observer.send("DOMStorage.disable"),
          state.observer.send("Log.disable"),
        ]);
      }
    }
    state.effects = {
      ...effects!,
      requests,
      logs,
      storageEvents,
      sameCookies: cookiesBefore === cookiesAfter,
    };
  },
);

Then(
  "that reveal preserves the value and caret without a request, log or browser persistence write and grants no private access",
  async ({ page }) => {
    const state = visitor(page);
    expect(
      state.effects,
      "all effects observed only around the real reveal",
    ).toEqual({
      storageCalls: 0,
      cookieWrites: 0,
      historyWrites: 0,
      sameStores: true,
      sameHistory: true,
      requests: 0,
      logs: 0,
      storageEvents: 0,
      sameCookies: true,
    });
    await assertValueAndCaret(state);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

When(
  "that revealed registration document is really hard reloaded",
  async ({ page }) => {
    const state = visitor(page);
    expect(
      await state.page.evaluate(
        (document) =>
          (window as RevealWindow).__revealDocument2905 === document,
        state.document,
      ),
      "pre-reload document marker exists",
    ).toBe(true);
    const [response] = await Promise.all([
      state.page.waitForNavigation({ waitUntil: "load" }),
      state.observer.send("Page.reload", { ignoreCache: true }),
    ]);
    expect(response?.status(), "hard reload document accepted").toBe(200);
    expect(
      response?.request().isNavigationRequest(),
      "real document navigation",
    ).toBe(true);
    await state.page.waitForLoadState("networkidle");
    expect(
      await state.page.evaluate(
        () => (window as RevealWindow).__revealDocument2905 === undefined,
      ),
      "hard reload replaced the JavaScript document",
    ).toBe(true);
  },
);

Then(
  "the new registration document masks the password and restores the unpressed show action without private access",
  async ({ page }) => {
    const state = visitor(page);
    expect(
      new URL(state.page.url()).pathname === "/register",
      "same registration door",
    ).toBe(true);
    expect(
      new URL(state.page.url()).searchParams.get("returnTo") === "/account",
      "account return target retained",
    ).toBe(true);
    await assertToggle(state, false);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

After("@password-reveal-reload", async ({ page }) => {
  const state = visitors.get(page);
  if (!state) return;
  try {
    await state.observer.detach();
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    visitors.delete(page);
  }
});
