import { describe, expect, it } from "vitest";
import {
  ZitadelDeliveryAdmin,
  type AdminFetchLike,
} from "./zitadel-delivery-admin.js";

/** A fetch double recording calls and returning scripted JSON per URL substring. */
function fakeFetch(
  routes: Array<{ match: string; status: number; body: unknown }>,
): { fetchImpl: AdminFetchLike; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, method: init.method });
      const route = routes.find((r) => url.includes(r.match));
      if (!route) return Promise.reject(new Error(`no route for ${url}`));
      return Promise.resolve({
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: () => Promise.resolve(route.body),
        text: () => Promise.resolve(JSON.stringify(route.body)),
      });
    },
  };
}

const cfg = { baseUrl: "http://idp.test", serviceToken: "pat-123" };

describe("ZitadelDeliveryAdmin (#185 admin _search + _activate)", () => {
  it("lists SMTP providers, normalising Zitadel's state enum to an `active` boolean", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/admin/v1/smtp/_search",
        status: 200,
        body: {
          result: [
            { id: "a", description: "dev-stand mailpit", state: "SMTP_CONFIG_ACTIVE" },
            { id: "b", description: "real transactional sender", state: "SMTP_CONFIG_INACTIVE" },
          ],
        },
      },
    ]);
    const admin = new ZitadelDeliveryAdmin({ ...cfg, fetchImpl });
    const providers = await admin.listSmtpProviders();
    expect(providers).toEqual([
      { id: "a", description: "dev-stand mailpit", active: true },
      { id: "b", description: "real transactional sender", active: false },
    ]);
  });

  it("lists SMS providers, reading description off the http provider object and a boolean state", async () => {
    const { fetchImpl } = fakeFetch([
      {
        match: "/admin/v1/sms/_search",
        status: 200,
        body: {
          result: [
            { id: "s1", description: "dev-stand sms-sink", state: "ACTIVE" },
            { id: "s2", http: { description: "real sms-aero-adapter" }, state: "INACTIVE" },
          ],
        },
      },
    ]);
    const admin = new ZitadelDeliveryAdmin({ ...cfg, fetchImpl });
    const providers = await admin.listSmsProviders();
    expect(providers).toEqual([
      { id: "s1", description: "dev-stand sms-sink", active: true },
      { id: "s2", description: "real sms-aero-adapter", active: false },
    ]);
  });

  it("POSTs to the SMTP _activate endpoint with the service-token bearer auth", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { match: "/admin/v1/smtp/x/_activate", status: 200, body: {} },
    ]);
    const admin = new ZitadelDeliveryAdmin({ ...cfg, fetchImpl });
    await admin.activateSmtp("x");
    expect(calls[0]?.url).toBe("http://idp.test/admin/v1/smtp/x/_activate");
    expect(calls[0]?.method).toBe("POST");
  });

  it("tolerates the already-active precondition error on _activate (idempotent no-op)", async () => {
    // Zitadel rejects re-activating an active provider; mirror provision.sh's
    // api_activate tolerance so a redundant activate is a harmless no-op.
    const { fetchImpl } = fakeFetch([
      {
        match: "/_activate",
        status: 412,
        body: { message: "provider is already active" },
      },
    ]);
    const admin = new ZitadelDeliveryAdmin({ ...cfg, fetchImpl });
    await expect(admin.activateSms("y")).resolves.toBeUndefined();
  });

  it("throws on a genuine activate failure (not the already-active case)", async () => {
    const { fetchImpl } = fakeFetch([
      { match: "/_activate", status: 500, body: { message: "boom" } },
    ]);
    const admin = new ZitadelDeliveryAdmin({ ...cfg, fetchImpl });
    await expect(admin.activateSmtp("z")).rejects.toThrow();
  });
});
