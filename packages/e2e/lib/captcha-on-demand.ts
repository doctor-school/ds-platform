import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  captchaStubScript,
  captchaTestTokenFromEnv,
  isSmartCaptchaScriptUrl,
} from "./captcha-stub.js";

/** Private S064 instrumentation of the supported provider adapter, never the API. */
export function onDemandProviderScript(
  token: string,
  onload: string,
  distinctTokens = true,
): string {
  // Delay the loader notification until observation is installed. Tokens below
  // are browser-policy probes only with BOTOFF; BOTON retains the accepted test token.
  return `${captchaStubScript(token, "__s064_delayed_loader")}
(function () {
  var provider = window.smartCaptcha;
  var render = provider.render;
  var subscribe = provider.subscribe;
  var entries = {};
  var calls = [];
  var probe = window.__captchaOnDemand = {
    calls: calls,
    visible: false,
    emit: function (index, event) {
      var call = calls[index];
      if (!call) throw new Error("Missing provider execution");
      if (event === "challenge-visible") {
        probe.visible = true;
        var frame = document.createElement("iframe");
        frame.title = "S064 deterministic provider interaction";
        frame.dataset.s064Challenge = "true";
        document.body.appendChild(frame);
      }
      if (event === "success") {
        document.querySelectorAll("[data-s064-challenge]").forEach(function (e) { e.remove(); });
        probe.visible = false;
      }
      (call.listeners[event] || []).slice().forEach(function (cb) { cb(call.token); });
      if (event === "success" && typeof call.callback === "function") call.callback(call.token);
    }
  };
  provider.render = function (container, params) {
    var id = render(container, params);
    entries[id] = { listeners: {}, callback: params.callback, invisible: params.invisible === true };
    return id;
  };
  provider.subscribe = function (id, event, cb) {
    (entries[id].listeners[event] = entries[id].listeners[event] || []).push(cb);
    return subscribe(id, event, cb);
  };
  provider.execute = function (id) {
    var entry = entries[id];
    calls.push({ id: id, invisible: entry.invisible, listeners: entry.listeners,
      callback: entry.callback, token: ${distinctTokens ? `${JSON.stringify(token)} + "-s064-" + calls.length` : JSON.stringify(token)} });
  };
  var onload = ${JSON.stringify(onload)};
  if (typeof window[onload] === "function") window[onload]();
})();`;
}

export async function installOnDemandProvider(page: Page): Promise<void> {
  const token = captchaTestTokenFromEnv();
  const distinctTokens = process.env.BOT_PROTECTION_ENABLED === "false";
  await page.route(isSmartCaptchaScriptUrl, async (route) => {
    const onload =
      new URL(route.request().url()).searchParams.get("onload") ??
      "__onSmartCaptchaReady";
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: onDemandProviderScript(
        distinctTokens ? `${token}-${randomUUID()}` : token,
        onload,
        distinctTokens,
      ),
    });
  });
}

interface Probe {
  calls: { id: number; invisible: boolean; token: string }[];
  emit(index: number, event: string): void;
}

export async function providerCalls(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __captchaOnDemand?: Probe })
      .__captchaOnDemand;
    return probe?.calls.map(({ id, invisible }) => ({ id, invisible })) ?? [];
  });
}

export async function emitProvider(
  page: Page,
  index: number,
  event: string,
  twice = false,
) {
  await page.evaluate(
    ({ index, event, twice }) => {
      const probe = (window as unknown as { __captchaOnDemand: Probe })
        .__captchaOnDemand;
      probe.emit(index, event);
      if (twice) probe.emit(index, event);
    },
    { index, event, twice },
  );
}

export async function tokenMatchesCall(
  page: Page,
  index: number,
  token: string,
) {
  return page.evaluate(
    ({ index, token }) =>
      (window as unknown as { __captchaOnDemand: Probe }).__captchaOnDemand
        .calls[index]?.token === token,
    { index, token },
  );
}
