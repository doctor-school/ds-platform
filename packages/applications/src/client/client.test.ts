import {
  ApplicationsError,
  fetchOwnAuthorApplications,
  readOwnAuthorApplications,
  submitAuthorApplication,
} from "./index";

const KEY = "00000000-0000-4000-8000-000000000001";
const BODY = {
  topic: "Тема",
  format: "podcast" as const,
  consentVersion: "2026-11-01.sha256-" + "a".repeat(64),
};
const RESULT = {
  id: "11111111-1111-4111-8111-111111111111",
  submittedAt: "2026-11-25T10:00:00.000Z",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("033 applications client", () => {
  it("EARS-7, EARS-8: POST /v1/me/applications/author carries the idempotency key, the bot-protection proof and the body, same-origin with the session", async () => {
    fetchMock.mockResolvedValue(json(201, RESULT));
    await expect(
      submitAuthorApplication(BODY, {
        idempotencyKey: KEY,
        captchaToken: "tok",
      }),
    ).resolves.toEqual(RESULT);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/me/applications/author");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": KEY,
        "x-smartcaptcha-token": "tok",
      },
    });
    expect(JSON.parse(init.body as string)).toEqual(BODY);
  });

  it("EARS-7: without a proof the header is left out (a disabled provider passes)", async () => {
    fetchMock.mockResolvedValue(json(201, RESULT));
    await submitAuthorApplication(BODY, { idempotencyKey: KEY });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<
      string,
      string
    >;
    expect(headers).not.toHaveProperty("x-smartcaptcha-token");
  });

  it("EARS-5, EARS-8: a refusal throws with the status, the named problems and the code; a network failure throws status 0", async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        problems: [{ code: "CONSENT_VERSION_NOT_CURRENT", field: "consent" }],
      }),
    );
    const refused = await submitAuthorApplication(BODY, {
      idempotencyKey: KEY,
    }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApplicationsError);
    expect(refused).toMatchObject({
      status: 400,
      problems: [{ code: "CONSENT_VERSION_NOT_CURRENT", field: "consent" }],
    });

    fetchMock.mockResolvedValueOnce(
      json(403, { code: "BOT_PROTECTION_REJECTED", message: "x" }),
    );
    await expect(
      submitAuthorApplication(BODY, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({
      status: 403,
      problems: [],
      code: "BOT_PROTECTION_REJECTED",
    });

    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(
      submitAuthorApplication(BODY, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ status: 502, problems: [] });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      submitAuthorApplication(BODY, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ status: 0, problems: [] });
  });

  it("EARS-10: GET /v1/me/applications?kind=author returns the parsed list", async () => {
    const list = {
      items: [{ ...RESULT, topic: "Тема", state: "received" }],
    };
    fetchMock.mockResolvedValue(json(200, list));
    await expect(fetchOwnAuthorApplications()).resolves.toEqual(list);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/me/applications?kind=author");
    expect(init).toMatchObject({ credentials: "include" });
    expect(init.method ?? "GET").toBe("GET");
  });

  it("EARS-10: a failed or malformed read resolves { ok: false }, never throws, so the page keeps the form", async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}));
    await expect(readOwnAuthorApplications()).resolves.toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json(200, { items: [{ id: "x" }] }));
    await expect(readOwnAuthorApplications()).resolves.toEqual({ ok: false });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(readOwnAuthorApplications()).resolves.toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json(200, { items: [] }));
    await expect(readOwnAuthorApplications()).resolves.toEqual({
      ok: true,
      list: { items: [] },
    });
  });
});
