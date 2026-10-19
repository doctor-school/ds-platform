import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  phoneConfirmationCode,
  resetSmsCode,
  smsSinkMessages,
  smsSinkUrl,
  waitForSmsCode,
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

  it("EARS-53: lists the messages to a phone beyond its pre-request checkpoint through the sink API", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: 2,
            receivedAt: "2026-10-13T00:00:02.000Z",
            body: RU_RESET,
            json: null,
          },
          {
            id: 1,
            receivedAt: "2026-10-13T00:00:01.000Z",
            body: RU_RESET,
            json: null,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const messages = await smsSinkMessages(
      "http://sink:8090",
      "+79991234567",
      { phone: "+79991234567", messageIds: [1] },
      "user.human.phone.code.added",
    );
    expect(messages.map((message) => message.id)).toEqual([2]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://sink:8090/api/messages?to=%2B79991234567&event=user.human.phone.code.added",
    );
  });

  it("#3057: a delivery the sink stamped before the runner's clock reading still counts — no cross-machine timestamp comparison", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // The runner clock runs ahead of the sink box: the sink's receivedAt of the
    // delivery caused by the request predates the runner's request instant.
    vi.setSystemTime(new Date("2026-10-19T17:46:24.646Z"));
    let delivered = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          messages: delivered
            ? [
                {
                  id: 160,
                  receivedAt: "2026-10-19T17:46:24.617Z",
                  body: RU_RESET,
                  json: JSON.parse(RU_RESET),
                },
              ]
            : [],
        }),
      ),
    );
    const checkpoint = await captureSmsCheckpoint(
      "http://sink:8090",
      "+79991234567",
    );
    expect(checkpoint).toEqual({ phone: "+79991234567", messageIds: [] });
    delivered = true;
    await expect(
      waitForSmsCode(
        "http://sink:8090",
        "+79991234567",
        checkpoint,
        resetSmsCode,
        "user.human.password.code.added",
      ),
    ).resolves.toBe("482913");
    vi.useRealTimers();
  });

  it("#3057: the checkpoint holds every delivery to the phone, of any event, and ignores none of them later", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: 7,
            receivedAt: "2099-01-01T00:00:00.000Z",
            body: RU_RESET,
            json: null,
          },
          {
            id: 3,
            receivedAt: "2000-01-01T00:00:00.000Z",
            body: RU_RESET,
            json: null,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      captureSmsCheckpoint("http://sink:8090", "+79991234567"),
    ).resolves.toEqual({ phone: "+79991234567", messageIds: [7, 3] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://sink:8090/api/messages?to=%2B79991234567",
    );
  });

  it("#3057: a checkpoint bound to another phone is refused before any read", async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      smsSinkMessages("http://sink:8090", "+79991234567", {
        phone: "+79990000000",
        messageIds: [],
      }),
    ).rejects.toThrow("SMS checkpoint belongs to another phone");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ id: "1" }, { id: 0 }, { id: 1.5 }, {}])(
    "#3057: a sink message without a positive integer delivery id fails closed (%o)",
    async (bad) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            messages: [{ receivedAt: "x", body: RU_RESET, json: null, ...bad }],
          }),
        ),
      );
      await expect(
        captureSmsCheckpoint("http://sink:8090", "+79991234567"),
      ).rejects.toThrow("Invalid SMS sink delivery id");
    },
  );

  it("EARS-53: sends the stage basic-auth pair to a gated sink, and none on a bare one (#2878)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ messages: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("E2E_HTTP_USER", "stage");
    vi.stubEnv("E2E_HTTP_PASS", "s3cret");
    await captureSmsCheckpoint("https://sms-sink.stage.test", "+79991234567");
    const gated = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(gated.get("authorization")).toBe(
      `Basic ${Buffer.from("stage:s3cret").toString("base64")}`,
    );
    // A redirect would carry the pair to wherever it points; refuse it.
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");

    vi.stubEnv("E2E_HTTP_USER", "");
    vi.stubEnv("E2E_HTTP_PASS", "");
    await captureSmsCheckpoint("http://localhost:8090", "+79991234567");
    const bare = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(bare.has("authorization")).toBe(false);
  });

  it("EARS-53: a sink that does not answer fails by status, never as an empty inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(
      captureSmsCheckpoint("http://sink:8090", "+79991234567"),
    ).rejects.toThrow("SMS sink answered HTTP 503");
  });
});
