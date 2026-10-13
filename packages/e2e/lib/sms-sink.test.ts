import { afterEach, describe, expect, it, vi } from "vitest";

import {
  freshConfirmablePhone,
  phoneConfirmationCode,
  resetSmsCode,
  smsSinkMessages,
  smsSinkUrl,
} from "./sms-sink.js";

const RU_RESET =
  '{"contextInfo":{"eventType":"user.human.password.code.added","recipientPhoneNumber":"+79991234567"},"templateData":{"text":"Doctor.School: код для сброса пароля - 482913, никому его не сообщайте"},"args":{"code":"482913"}}';

describe("SMS sink reads for the 003 SMS reset journey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("EARS-53: the sink root comes only from E2E_SMS_SINK_URL", () => {
    vi.stubEnv("E2E_SMS_SINK_URL", "");
    expect(smsSinkUrl()).toBeNull();
    vi.stubEnv("E2E_SMS_SINK_URL", "http://localhost:8090/");
    expect(smsSinkUrl()).toBe("http://localhost:8090");
  });

  it("EARS-53: a fresh number is a Russian mobile E.164 the identifier mask accepts", () => {
    const a = freshConfirmablePhone();
    const b = freshConfirmablePhone();
    expect(a).toMatch(/^\+7999\d{7}$/);
    expect(a).not.toBe(b);
  });

  it("EARS-53: reads the reset code from the reset event's structured code", () => {
    expect(resetSmsCode({ body: RU_RESET, json: JSON.parse(RU_RESET) })).toBe(
      "482913",
    );
  });

  it("EARS-53: a sign-in or phone-confirmation SMS is never read as a reset code", () => {
    const confirmation =
      '{"contextInfo":{"eventType":"user.human.phone.code.added"},"args":{"code":"123456"}}';
    expect(
      resetSmsCode({ body: confirmation, json: JSON.parse(confirmation) }),
    ).toBeNull();
    expect(
      resetSmsCode({
        body: "Doctor.School: код для входа - 550271, никому",
        json: null,
      }),
    ).toBeNull();
  });

  it("EARS-48: reads the phone confirmation code from the structured args, then the text", () => {
    expect(
      phoneConfirmationCode({ body: "", json: { args: { code: "654321" } } }),
    ).toBe("654321");
    expect(
      phoneConfirmationCode({
        body: "Doctor.School: код подтверждения номера - 777001",
        json: null,
      }),
    ).toBe("777001");
    expect(phoneConfirmationCode({ body: "no code here", json: null })).toBe(
      null,
    );
  });

  it("EARS-53: lists the messages to a phone after a cutoff through the sink API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        messages: [{ id: 1, receivedAt: "x", body: RU_RESET, json: null }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const messages = await smsSinkMessages(
      "http://sink:8090",
      "+79991234567",
      "2026-10-13T00:00:00.000Z",
      "user.human.phone.code.added",
    );
    expect(messages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sink:8090/api/messages?to=%2B79991234567&after=2026-10-13T00%3A00%3A00.000Z&event=user.human.phone.code.added",
    );
  });

  it("EARS-53: a sink that does not answer fails by status, never as an empty inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(
      smsSinkMessages(
        "http://sink:8090",
        "+79991234567",
        "2026-10-13T00:00:00Z",
      ),
    ).rejects.toThrow("SMS sink answered HTTP 503");
  });
});
