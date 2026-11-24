import { errors, type Page } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import { signInAsAdmin } from "./admin/sign-in";

vi.mock("./lib/owned-registration", () => ({ inputSecret: vi.fn() }));

const credentials = {
  email: "operator@example.test",
  password: "test-fixture-password",
  totpSecret: "JBSWY3DPEHPK3PXP",
};

type AuthPath = "/login" | "/mfa/challenge" | "/events";

function signInPage(entries: AuthPath[], transitions: (AuthPath | null)[]) {
  const origin = "https://admin.example.test";
  let path: AuthPath = "/login";
  const fillEmail = vi.fn(async () => {
    if (path !== "/login") throw new Error("The login input is absent");
  });
  const submit = vi.fn(async () => {});
  const codeInput = vi.fn(() => ({}));
  const advance = (next: AuthPath) => {
    path = next;
    vi.stubGlobal("location", new URL(next, origin));
    vi.stubGlobal("document", {
      querySelector: () =>
        next === "/login" ? { getClientRects: () => [1] } : null,
    });
  };
  const page = {
    goto: vi.fn(async () => advance(entries.shift()!)),
    locator: (selector: string) =>
      selector === "#email" ? { fill: fillEmail } : {},
    getByTestId: (id: string) =>
      id === "login-submit" ? { click: submit } : { getByRole: codeInput },
    url: () => new URL(path, origin).href,
    waitForFunction: vi.fn(async (readState: () => string | false) => {
      const state = readState();
      if (!state) throw new errors.TimeoutError("No admin form or destination");
      return { jsonValue: async () => state, dispose: async () => {} };
    }),
    waitForTimeout: vi.fn(async () => {}),
    waitForURL: vi.fn(async (match: RegExp | ((url: URL) => boolean)) => {
      const next = transitions.shift();
      if (!next) throw new errors.TimeoutError("Transition arrived late");
      const url = new URL(next, origin);
      expect(match instanceof RegExp ? match.test(url.href) : match(url)).toBe(
        true,
      );
      advance(next);
    }),
  };
  return { page: page as unknown as Page, fillEmail, submit, codeInput };
}

afterEach(() => vi.unstubAllGlobals());

it("continues the pending MFA step when the retry's login page redirects", async () => {
  const { page, fillEmail, submit, codeInput } = signInPage(
    ["/login", "/mfa/challenge"],
    [null, "/events"],
  );
  await expect(signInAsAdmin(page, credentials)).resolves.toBe(
    credentials.totpSecret,
  );
  expect(fillEmail).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(codeInput).toHaveBeenCalledTimes(1);
});

it("recognizes a completed MFA login when the retry redirects to events", async () => {
  const { page, fillEmail, submit, codeInput } = signInPage(
    ["/login", "/events"],
    ["/mfa/challenge", null],
  );
  await expect(signInAsAdmin(page, credentials)).resolves.toBe(
    credentials.totpSecret,
  );
  expect(fillEmail).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(codeInput).toHaveBeenCalledTimes(1);
});

it("refuses an existing admin session without proof from this login", async () => {
  const { page, submit, codeInput } = signInPage(["/events"], []);
  await expect(signInAsAdmin(page, credentials)).rejects.toThrow(
    "already active before this sign-in completed MFA",
  );
  expect(submit).not.toHaveBeenCalled();
  expect(codeInput).not.toHaveBeenCalled();
});
