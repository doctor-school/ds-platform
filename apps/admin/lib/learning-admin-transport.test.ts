import { afterEach, describe, expect, it, vi } from "vitest";
import { learningAdminTransport } from "./learning-admin-transport";

// 024 EARS-28 / EARS-29 (#4011) — the admin host's learning transport speaks the
// 012 admin write contract: a fresh `Idempotency-Key` on every write, `If-Match`
// of the version the screen rendered from on every write after a create, the
// step file as multipart with its one `file` part, and a refusal thrown as the
// problem body the screens read.

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const ID = "00000000-0000-4000-8000-000000000001";

function stubFetch(status = 200, body: unknown = {}) {
  const stub = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

const headersOf = (init: RequestInit | undefined) =>
  init?.headers as Record<string, string>;

describe("learningAdminTransport", () => {
  it("EARS-4: publishes a lesson under its If-Match with a fresh idempotency key", async () => {
    const stub = stubFetch();
    await learningAdminTransport.publishLesson(ID, 4);
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe(`/v1/admin/learning/lessons/${ID}/publish`);
    expect(init?.method).toBe("POST");
    expect(headersOf(init)["if-match"]).toBe('W/"4"');
    expect(headersOf(init)["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("EARS-28: a create carries no If-Match; its body is the request JSON", async () => {
    const stub = stubFetch(201);
    await learningAdminTransport.createStep({
      lessonId: ID,
      type: "download",
      title: "Памятка",
      durationMin: 3,
      payload: { fileName: "a.pdf" },
    });
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe("/v1/admin/learning/steps");
    expect(headersOf(init)["if-match"]).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: "download" });
  });

  it("EARS-28: uploads a step file as multipart with the one `file` part under the step's If-Match", async () => {
    const stub = stubFetch();
    const file = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    await learningAdminTransport.setStepMedia(ID, file, 2);
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe(`/v1/admin/learning/steps/${ID}/media`);
    expect(init?.method).toBe("PUT");
    expect(headersOf(init)["if-match"]).toBe('W/"2"');
    expect(headersOf(init)["idempotency-key"]).toBeDefined();
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("EARS-29: applies a preset on a course layer still at version 0", async () => {
    const stub = stubFetch();
    await learningAdminTransport.applyPreset("course", ID, ID, 0);
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe(`/v1/admin/learning/rules/course/${ID}/apply-preset`);
    expect(headersOf(init)["if-match"]).toBe('W/"0"');
    expect(JSON.parse(String(init?.body))).toEqual({ presetId: ID });
  });

  it("EARS-4: a refused publish is thrown as the problem body with its field errors", async () => {
    stubFetch(409, {
      errorCode: "PUBLISH_REQUIREMENTS_NOT_MET",
      errors: [{ path: "exitTest", message: "the rules require an exit test" }],
    });
    await expect(learningAdminTransport.publishLesson(ID, 1)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "PUBLISH_REQUIREMENTS_NOT_MET",
      fieldErrors: [{ path: "exitTest", message: "the rules require an exit test" }],
    });
  });
});
