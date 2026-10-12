import { Logger } from "@nestjs/common";
import { register } from "prom-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SMS_UNCONFIRMED_PHONE_METRIC,
  SmsUnconfirmedCounter,
  maskPhoneForLog,
} from "./sms-unconfirmed-counter.js";

async function counted(): Promise<
  { labels: Record<string, string | number>; value: number }[]
> {
  const metric = register.getSingleMetric(SMS_UNCONFIRMED_PHONE_METRIC);
  if (!metric) return [];
  return (await metric.get()).values.map((v) => ({
    labels: v.labels as Record<string, string | number>,
    value: v.value,
  }));
}

describe("003 EARS-56 unconfirmed-phone counter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    register.removeSingleMetric(SMS_UNCONFIRMED_PHONE_METRIC);
  });

  it("EARS-56: each request increments the counter by flow and writes one masked log line, with no phone label", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    const counter = new SmsUnconfirmedCounter();

    counter.record("signin", "+79991234567");
    counter.record("reset", "+79991234567");
    counter.record("reset", "+15551230000");

    const values = await counted();
    expect(values).toEqual(
      expect.arrayContaining([
        { labels: { flow: "signin" }, value: 1 },
        { labels: { flow: "reset" }, value: 2 },
      ]),
    );
    for (const v of values) expect(Object.keys(v.labels)).toEqual(["flow"]);

    expect(log).toHaveBeenCalledTimes(3);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "auth.sms.unconfirmed_phone",
      flow: "signin",
      phone: "+7***4567",
    });
    for (const line of lines) {
      expect(line).not.toContain("9991234567");
      expect(line).not.toContain("5551230000");
    }
  });

  it("EARS-56: the log mask keeps the leading country digit and the last four digits only", () => {
    expect(maskPhoneForLog("+79991234567")).toBe("+7***4567");
    expect(maskPhoneForLog("+15551230000")).toBe("+1***0000");
    expect(maskPhoneForLog("+123")).toBe("+***");
  });
});
