import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  assertNoPrivateRegistrationAccess,
  registerOwnedCredentials,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

type Store = "url" | "local" | "session" | "cookies";
type Phase = "verification" | "reload" | "abandonment";
interface PasswordMemory extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  observer: CDPSession;
  exposed: Record<Store, boolean>;
  phases: Phase[];
  documents: number;
  privateSessionFromResponse: boolean;
  authPosts: string[];
  pending: Set<Promise<void>>;
}
const memories = new WeakMap<Page, PasswordMemory>();
function memory(key: Page): PasswordMemory {
  const state = memories.get(key);
  if (!state)
    throw new Error("Owned password persistence observation not prepared");
  return state;
}

function containsPassword(text: string, password: string): boolean {
  const encoded = Buffer.from(password).toString("base64");
  const forms = [
    password,
    encodeURIComponent(password),
    encoded,
    encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    Buffer.from(password).toString("hex"),
  ];
  let candidates = [text];
  const seen = new Set<string>();
  for (let depth = 0; depth < 4; depth += 1) {
    const decoded: string[] = [];
    for (const candidate of candidates) {
      if (forms.some((form) => candidate.includes(form))) return true;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      decoded.push(
        candidate.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      );
      try {
        decoded.push(decodeURIComponent(candidate.replaceAll("+", " ")));
      } catch {
        /* Not URI encoded. */
      }
      for (const token of candidate.match(/[\w+/-]{12,}={0,2}/g) ?? [])
        decoded.push(Buffer.from(token, "base64url").toString("utf8"));
    }
    candidates = decoded;
  }
  return false;
}

async function snapshot(state: PasswordMemory, phase: Phase): Promise<void> {
  await Promise.all([...state.pending]);
  const readable = await state.page.evaluate(() =>
    (
      window as unknown as {
        __passwordPersistenceSnapshot2742(): Record<Store, boolean>;
      }
    ).__passwordPersistenceSnapshot2742(),
  );
  for (const store of Object.keys(readable) as Store[])
    state.exposed[store] ||= readable[store];
  state.exposed.cookies ||= (await state.context.cookies()).some((cookie) =>
    containsPassword(`${cookie.name}=${cookie.value}`, state.password),
  );
  expect(
    state.exposed,
    `${phase}: no registration password persistence`,
  ).toEqual({
    url: false,
    local: false,
    session: false,
    cookies: false,
  });
  expect(
    state.privateSessionFromResponse,
    `${phase}: no private session was minted`,
  ).toBe(false);
  await assertNoPrivateRegistrationAccess(state.page, "", state);
  state.phases.push(phase);
}

Given(
  "a uniquely owned Academy registrant whose password persistence is observed before registration",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: PasswordMemory = {
      context,
      page: owned,
      observer: await context.newCDPSession(owned),
      email: `memory-2742-${randomUUID()}@example.test`,
      password: `Memory-${randomUUID()}-aA1!`,
      exposed: { url: false, local: false, session: false, cookies: false },
      phases: [],
      documents: 0,
      privateSessionFromResponse: false,
      authPosts: [],
      pending: new Set(),
    };
    memories.set(page, state);
    const observe = (store: Store, text: string) => {
      state.exposed[store] ||= containsPassword(text, state.password);
    };
    // DOMStorage events also see named-property writes that bypass setItem.
    state.observer.on(
      "DOMStorage.domStorageItemAdded",
      ({ storageId, key, newValue }) =>
        observe(
          storageId.isLocalStorage ? "local" : "session",
          `${key}=${newValue}`,
        ),
    );
    state.observer.on(
      "DOMStorage.domStorageItemUpdated",
      ({ storageId, key, newValue }) =>
        observe(
          storageId.isLocalStorage ? "local" : "session",
          `${key}=${newValue}`,
        ),
    );
    await state.observer.send("DOMStorage.enable");
    await context.exposeBinding(
      "__passwordPersistence2742",
      (_source, store: Store | "document", exposed: boolean) => {
        if (store === "document") state.documents += 1;
        else state.exposed[store] ||= exposed;
      },
    );
    await context.addInitScript((password) => {
      const encoded = btoa(password);
      const forms = [
        password,
        encodeURIComponent(password),
        encoded,
        encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
        Array.from(password, (char) =>
          char.charCodeAt(0).toString(16).padStart(2, "0"),
        ).join(""),
      ];
      const contains = (text: string) => {
        let candidates = [text];
        const seen = new Set<string>();
        for (let depth = 0; depth < 4; depth += 1) {
          const decoded: string[] = [];
          for (const candidate of candidates) {
            if (forms.some((form) => candidate.includes(form))) return true;
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            decoded.push(
              candidate.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              ),
            );
            try {
              decoded.push(decodeURIComponent(candidate.replaceAll("+", " ")));
            } catch {
              /* Not URI encoded. */
            }
            for (const token of candidate.match(/[\w+/-]{12,}={0,2}/g) ?? []) {
              try {
                decoded.push(
                  atob(token.replaceAll("-", "+").replaceAll("_", "/")),
                );
              } catch {
                /* Not base64 encoded. */
              }
            }
          }
          candidates = decoded;
        }
        return false;
      };
      const observed = {
        url: false,
        local: false,
        session: false,
        cookies: false,
      };
      (
        window as unknown as {
          __passwordPersistenceSnapshot2742(): Record<Store, boolean>;
        }
      ).__passwordPersistenceSnapshot2742 = () => ({
        url: observed.url || contains(location.href),
        local:
          observed.local ||
          contains(JSON.stringify(Object.entries(localStorage))),
        session:
          observed.session ||
          contains(JSON.stringify(Object.entries(sessionStorage))),
        cookies: observed.cookies || contains(document.cookie),
      });
      const report = (store: Store | "document", text = "") => {
        const exposed = contains(text);
        if (store !== "document") observed[store] ||= exposed;
        // Only booleans cross the binding; persisted diagnostics cannot echo bytes.
        void (
          window as unknown as {
            __passwordPersistence2742(
              store: Store | "document",
              exposed: boolean,
            ): Promise<void>;
          }
        ).__passwordPersistence2742(store, exposed);
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        setItem.call(this, key, value);
        report(this === localStorage ? "local" : "session", `${key}=${value}`);
      };
      const cookie = Object.getOwnPropertyDescriptor(
        Document.prototype,
        "cookie",
      )!;
      Object.defineProperty(Document.prototype, "cookie", {
        ...cookie,
        set(value: string) {
          cookie.set!.call(this, value);
          report("cookies", cookie.get!.call(this));
        },
      });
      for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method];
        history[method] = function (...args) {
          original.apply(this, args);
          report("url", location.href);
        };
      }
      addEventListener("hashchange", () => report("url", location.href));
      addEventListener("popstate", () => report("url", location.href));
      report("document");
      report("url", location.href);
    }, state.password);
    owned.on("request", (request) => {
      observe("url", request.url());
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    owned.on("framenavigated", (frame) => observe("url", frame.url()));
    owned.on("response", (response) => {
      const pending = response.headerValues("set-cookie").then((cookies) => {
        for (const cookie of cookies) {
          observe("cookies", cookie);
          state.privateSessionFromResponse ||=
            /(?:^|\s)__Host-ds_session=[^;\s]/.test(cookie);
        }
      });
      state.pending.add(pending);
      void pending.finally(() => state.pending.delete(pending));
    });
    await installCaptchaStub(context);
  },
);

When(
  "the observed registrant submits the Academy registration form and reaches the unconsumed code step",
  async ({ page, world }) => {
    const state = memory(page);
    const { response, code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      state,
    );
    expect(
      /^\d{6}$/.test(code),
      "fresh owned confirmation remains unconsumed",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
    await snapshot(state, "verification");
  },
);

When(
  "the observed registrant really reloads verification and abandons it through Change email without submitting a code",
  async ({ page, world }) => {
    const state = memory(page);
    const response = await state.page.reload({ waitUntil: "load" });
    expect(response?.status(), "verification document reload accepted").toBe(
      200,
    );
    expect(
      response?.request().isNavigationRequest(),
      "actual document reload",
    ).toBe(true);
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    expect(
      new URL(state.page.url()).pathname === "/verify",
      "same code step after reload",
    ).toBe(true);
    await snapshot(state, "reload");
    await state.page.getByTestId("verify-back").click();
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/register",
    );
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.locator('input[autocomplete="new-password"]'),
    ).toBeVisible();
    await snapshot(state, "abandonment");
  },
);

Then(
  "the entered registration password never appears in URLs, browser stores or cookies during transition, reload or abandonment",
  async ({ page }) => {
    const state = memory(page);
    expect(state.phases).toEqual(["verification", "reload", "abandonment"]);
    expect(
      state.documents >= 2,
      "observer installed before registration and after real reload",
    ).toBe(true);
    expect(
      state.authPosts,
      "one registration, no replay, confirmation or other auth step",
    ).toEqual(["/v1/auth/register"]);
    expect(
      state.exposed,
      "including transient writes and encoded representations",
    ).toEqual({
      url: false,
      local: false,
      session: false,
      cookies: false,
    });
  },
);

After("@registration-password-memory", async ({ page }) => {
  const state = memories.get(page);
  if (!state) return;
  try {
    await state.observer.detach();
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    memories.delete(page);
  }
});
