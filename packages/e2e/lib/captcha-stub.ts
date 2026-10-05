/**
 * Yandex SmartCaptcha stub for agent-driven browser journeys on a staging slot
 * (#2605).
 *
 * Yandex SmartCaptcha ships no vendor test keypair and its invisible widget
 * never yields a token in headless Playwright, so captcha-gated journeys
 * (registration, login-OTP request, verification resend, password reset) could
 * not be driven on a slot. This helper routes ONLY the third-party `captcha.js`
 * request to an inline stand-in that implements the `window.smartCaptcha`
 * surface `@yandex/smart-captcha` calls and resolves every `execute` with the
 * box's non-production test token. Everything else is real: the design-system
 * widget wrapper, the `x-smartcaptcha-token` header plumbing, the api guard and
 * the provider, which accepts the token only on a non-production stand
 * (`BOT_PROTECTION_TEST_TOKEN`, `apps/api/src/bot-protection/README.md`).
 *
 * The token is the one on stage-1 (`/etc/ds-platform/stage.env`), exported by
 * the operator as `E2E_CAPTCHA_TEST_TOKEN` (`tools/staging/README.md`); it is
 * never committed and never invented.
 */

/** Hosts `@yandex/smart-captcha` loads `captcha.js` from (its default + the cloud alias). */
const SMARTCAPTCHA_SCRIPT_HOSTS = new Set([
  "smartcaptcha.cloud.yandex.ru",
  "smartcaptcha.yandexcloud.net",
]);

/** The adapter's default `onload` callback name (`captcha.js?render=onload&onload=…`). */
const DEFAULT_ONLOAD = "__onSmartCaptchaReady";

export const CAPTCHA_TEST_TOKEN_ENV = "E2E_CAPTCHA_TEST_TOKEN";

export class CaptchaTestTokenMissingError extends Error {
  constructor() {
    super(
      `${CAPTCHA_TEST_TOKEN_ENV} is not set — export the stage-1 bot-protection test token ` +
        "(BOT_PROTECTION_TEST_TOKEN in /etc/ds-platform/stage.env, read over SSH; " +
        "tools/staging/README.md → «Driving captcha-gated auth on a slot»). " +
        "A captcha-gated journey cannot be driven without it, and it is never invented.",
    );
    this.name = "CaptchaTestTokenMissingError";
  }
}

/** Reads the operator-exported test token; absent ⇒ a named error, never a skip. */
export function captchaTestTokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const token = (env[CAPTCHA_TEST_TOKEN_ENV] ?? "").trim();
  if (token === "") throw new CaptchaTestTokenMissingError();
  return token;
}

/** True for the Yandex `captcha.js` loader request — and nothing else. */
export function isSmartCaptchaScriptUrl(url: URL): boolean {
  return (
    SMARTCAPTCHA_SCRIPT_HOSTS.has(url.hostname) &&
    url.pathname === "/captcha.js"
  );
}

/**
 * The inline stand-in for `captcha.js`: defines `window.smartCaptcha`
 * (render / subscribe / execute / getResponse / reset / destroy / setTheme) and
 * then calls the loader's `onload` callback, exactly as the real script does.
 * `execute` resolves asynchronously through the `success` subscription, like
 * the real invisible check.
 */
export function captchaStubScript(token: string, onload: string): string {
  return `(function () {
  var TOKEN = ${JSON.stringify(token)};
  var ONLOAD = ${JSON.stringify(onload)};
  var nextId = 1;
  var widgets = {};
  function widget(id) { return widgets[id]; }
  window.smartCaptcha = {
    render: function (_container, params) {
      var id = nextId++;
      widgets[id] = { params: params || {}, listeners: {}, response: "" };
      return id;
    },
    subscribe: function (id, event, cb) {
      var w = widget(id);
      if (!w) return function () {};
      (w.listeners[event] = w.listeners[event] || []).push(cb);
      return function () {
        var list = w.listeners[event] || [];
        var at = list.indexOf(cb);
        if (at !== -1) list.splice(at, 1);
      };
    },
    execute: function (id) {
      setTimeout(function () {
        var w = widget(id);
        if (!w) return;
        w.response = TOKEN;
        (w.listeners.success || []).slice().forEach(function (cb) { cb(TOKEN); });
        if (typeof w.params.callback === "function") w.params.callback(TOKEN);
      }, 0);
    },
    getResponse: function (id) { var w = widget(id); return w ? w.response : ""; },
    reset: function (id) { var w = widget(id); if (w) w.response = ""; },
    destroy: function (id) { delete widgets[id]; },
    setTheme: function () {}
  };
  if (typeof window[ONLOAD] === "function") window[ONLOAD]();
})();
`;
}

/** The route surface shared by Playwright's `Page` and `BrowserContext`. */
interface Routable {
  route(
    url: (url: URL) => boolean,
    handler: (route: {
      request(): { url(): string };
      fulfill(response: {
        status: number;
        contentType: string;
        body: string;
      }): Promise<void>;
    }) => Promise<void>,
  ): Promise<unknown>;
}

/**
 * Routes the Yandex `captcha.js` request of `target` (a page or a whole browser
 * context) to the stub resolving with `token` — by default the operator's
 * `E2E_CAPTCHA_TEST_TOKEN`. Call it before the first navigation.
 */
export async function installCaptchaStub(
  target: Routable,
  token: string = captchaTestTokenFromEnv(),
): Promise<void> {
  await target.route(isSmartCaptchaScriptUrl, async (route) => {
    const onload =
      new URL(route.request().url()).searchParams.get("onload") ??
      DEFAULT_ONLOAD;
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: captchaStubScript(token, onload),
    });
  });
}
