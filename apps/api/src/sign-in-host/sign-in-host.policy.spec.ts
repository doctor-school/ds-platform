import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../auth/session/session.cookie.js";
import { loadEnv } from "../config/env.schema.js";
import { resolveSignInHostSettings } from "./sign-in-host.config.js";
import {
  freshCredentialAsked,
  recordCookieMaxAgeSeconds,
  recordExpiresAt,
  recordVerdict,
  SIGN_IN_HOST_IDLE_SECONDS,
  SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
} from "./sign-in-host.policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-10-22T10:00:00.000Z");
const at = (ms: number): Date => new Date(t0.getTime() + ms);

describe("sign-in-host record policy (003 EARS-64 / EARS-68)", () => {
  const fingerprint = computeFingerprint({
    userAgent: "UA/1",
    ip: "203.0.113.17",
    acceptLanguage: "ru",
  });
  const record = {
    lastCredentialAt: t0,
    lastFinalisedAt: t0,
    expiresAt: recordExpiresAt(t0),
    fingerprint,
  };

  it("EARS-64: the session lifetime is exactly 30 days and the idle timeout 7 days", () => {
    expect(SIGN_IN_HOST_SESSION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(SIGN_IN_HOST_IDLE_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(recordExpiresAt(t0).getTime() - t0.getTime()).toBe(30 * DAY_MS);
  });

  it("EARS-64: the fingerprint is UA + IP /24 + accept-language — another host in the /24 matches", () => {
    const sameNet = computeFingerprint({
      userAgent: "UA/1",
      ip: "203.0.113.200",
      acceptLanguage: "ru",
    });
    expect(recordVerdict(record, at(DAY_MS), sameNet)).toBe("usable");
  });

  it("EARS-64: another UA, network or language is a foreign browser", () => {
    for (const other of [
      { userAgent: "UA/2", ip: "203.0.113.17", acceptLanguage: "ru" },
      { userAgent: "UA/1", ip: "198.51.100.17", acceptLanguage: "ru" },
      { userAgent: "UA/1", ip: "203.0.113.17", acceptLanguage: "en" },
    ]) {
      expect(recordVerdict(record, at(DAY_MS), computeFingerprint(other))).toBe(
        "foreign",
      );
    }
  });

  it("EARS-64: a record idle for 7 days is expired, one used inside the window is not", () => {
    const touched = { ...record, lastFinalisedAt: at(6 * DAY_MS) };
    expect(recordVerdict(record, at(7 * DAY_MS - 1), fingerprint)).toBe(
      "usable",
    );
    expect(recordVerdict(record, at(7 * DAY_MS), fingerprint)).toBe("expired");
    expect(recordVerdict(touched, at(12 * DAY_MS), fingerprint)).toBe("usable");
  });

  it("EARS-64: use never extends the 30-day absolute lifetime", () => {
    const touched = { ...record, lastFinalisedAt: at(29 * DAY_MS) };
    expect(recordVerdict(touched, at(30 * DAY_MS - 1), fingerprint)).toBe(
      "usable",
    );
    expect(recordVerdict(touched, at(30 * DAY_MS), fingerprint)).toBe(
      "expired",
    );
  });

  it("EARS-64: the cookie Max-Age is what is left of the record, never more", () => {
    expect(recordCookieMaxAgeSeconds(record.expiresAt, t0)).toBe(
      30 * 24 * 60 * 60,
    );
    expect(recordCookieMaxAgeSeconds(record.expiresAt, at(29 * DAY_MS))).toBe(
      24 * 60 * 60,
    );
    expect(recordCookieMaxAgeSeconds(record.expiresAt, at(31 * DAY_MS))).toBe(
      0,
    );
  });

  it("EARS-68: prompt=login always asks for a fresh credential", () => {
    expect(
      freshCredentialAsked({
        prompt: ["login"],
        maxAgeSeconds: undefined,
        lastCredentialAt: t0,
        now: at(1000),
      }),
    ).toBe(true);
  });

  it("EARS-68: a max_age shorter than the time since the credential check asks for a fresh one", () => {
    const ask = (maxAgeSeconds: number | undefined, sinceMs: number) =>
      freshCredentialAsked({
        prompt: [],
        maxAgeSeconds,
        lastCredentialAt: t0,
        now: at(sinceMs),
      });
    expect(ask(60, 61_000)).toBe(true);
    expect(ask(60, 60_000)).toBe(false);
    expect(ask(0, 1)).toBe(true);
    expect(ask(undefined, 29 * DAY_MS)).toBe(false);
  });
});

describe("sign-in-host settings (003 EARS-60 / 66 / 67)", () => {
  const key = randomBytes(32).toString("base64");
  const complete = {
    IDP_ACADEMY_CLIENT_ID: "academy-client",
    IDP_DOCTOR_CLIENT_ID: "doctor-client",
    IDP_SIGN_IN_BASE_URI: "https://login.example/",
    SIGN_IN_ACADEMY_LOGIN_URL: "https://academy.example/login",
    SIGN_IN_DOCTOR_LOGIN_URL: "https://doctor.example/login",
    SIGN_IN_RECORD_KEY: key,
  };

  it("EARS-60: the fixed client map selects a storefront by client_id only", () => {
    const settings = resolveSignInHostSettings(complete);
    expect(settings?.clients.get("academy-client")).toBe("academy");
    expect(settings?.clients.get("doctor-client")).toBe("doctor");
    expect(settings?.clients.get("admin-client")).toBeUndefined();
    expect(settings?.hostOrigin).toBe("https://login.example");
    expect(settings?.loginUrls.doctor).toBe("https://doctor.example/login");
  });

  it("EARS-60: any unset key disables the module (no half sign-in host)", () => {
    for (const name of Object.keys(complete)) {
      expect(
        resolveSignInHostSettings({ ...complete, [name]: undefined }),
      ).toBeNull();
    }
    expect(
      resolveSignInHostSettings({
        ...complete,
        IDP_DOCTOR_CLIENT_ID: "academy-client",
      }),
    ).toBeNull();
  });

  it("EARS-64: a record key that is not base64 of 32 bytes refuses to boot, a blank one is unset", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
    expect(() =>
      loadEnv({
        ...base,
        SIGN_IN_RECORD_KEY: randomBytes(16).toString("base64"),
      }),
    ).toThrow(/SIGN_IN_RECORD_KEY/);
    expect(loadEnv({ ...base, SIGN_IN_RECORD_KEY: "  " }).SIGN_IN_RECORD_KEY)
      .toBeUndefined();
    expect(loadEnv({ ...base, SIGN_IN_RECORD_KEY: key }).SIGN_IN_RECORD_KEY).toBe(
      key,
    );
  });
});
