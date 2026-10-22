import type { Page } from "@playwright/test";
import {
  captchaStubScript,
  captchaTestTokenFromEnv,
  isSmartCaptchaScriptUrl,
} from "./captcha-stub.js";

/** S067 observes only the supported third-party script boundary. */
export function failureProviderScript(token: string, onload: string): string {
  return `${captchaStubScript(token, "__s067_delayed_loader")}
(function () {
  var provider = window.smartCaptcha;
  var originalRender = provider.render;
  var originalSubscribe = provider.subscribe;
  var originalDestroy = provider.destroy;
  var entries = {};
  var probe = window.__captchaFailure = {
    widgets: [], calls: [], destroyed: [],
    emit: function (index, event, token) {
      var call = probe.calls[index];
      if (!call) throw new Error("S067 missing provider execution");
      var payload = token === undefined ? call.token : token;
      (call.listeners[event] || []).slice().forEach(function (cb) { cb(payload); });
      if (event === "success" && typeof call.callback === "function") call.callback(payload);
    }
  };
  provider.render = function (container, params) {
    var id = originalRender(container, params);
    var entry = { id: id, theme: params.theme, invisible: params.invisible,
      language: params.hl, listeners: {}, callback: params.callback };
    entries[id] = entry;
    probe.widgets.push(entry);
    return id;
  };
  provider.subscribe = function (id, event, cb) {
    (entries[id].listeners[event] = entries[id].listeners[event] || []).push(cb);
    return originalSubscribe(id, event, cb);
  };
  provider.execute = function (id) {
    var entry = entries[id];
    probe.calls.push({ id: id, theme: entry.theme, invisible: entry.invisible,
      listeners: entry.listeners, callback: entry.callback,
      token: ${JSON.stringify(token)} });
  };
  provider.destroy = function (id) { probe.destroyed.push(id); originalDestroy(id); };
  var onload = ${JSON.stringify(onload)};
  if (typeof window[onload] === "function") window[onload]();
})();`;
}

export async function installFailureProvider(page: Page) {
  const token = captchaTestTokenFromEnv();
  await page.route(isSmartCaptchaScriptUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: failureProviderScript(
        token,
        new URL(route.request().url()).searchParams.get("onload") ??
          "__onSmartCaptchaReady",
      ),
    });
  });
}

interface Probe {
  widgets: { id: number; theme: string; invisible: boolean }[];
  calls: { id: number; theme: string; invisible: boolean }[];
  destroyed: number[];
  emit(index: number, event: string, token?: string): void;
}
export function failureProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __captchaFailure?: Probe })
      .__captchaFailure;
    return {
      widgets:
        probe?.widgets.map(({ id, theme, invisible }) => ({
          id,
          theme,
          invisible,
        })) ?? [],
      calls:
        probe?.calls.map(({ id, theme, invisible }) => ({
          id,
          theme,
          invisible,
        })) ?? [],
      destroyed: probe?.destroyed ?? [],
    };
  });
}
export function failureEvent(
  page: Page,
  index: number,
  event: string,
  token?: string,
  twice = false,
) {
  return page.evaluate(
    ({ index, event, token, twice }) => {
      const probe = (window as unknown as { __captchaFailure: Probe })
        .__captchaFailure;
      probe.emit(index, event, token);
      if (twice) probe.emit(index, event, token);
    },
    { index, event, token, twice },
  );
}
