import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ACADEMY_PARTNERSHIP_WRITE_ERROR } from "./academy-partnership-schema";
import {
  ACADEMY_PARTNERSHIP_INTAKE_PATH,
  postAcademyPartnership,
} from "./academy-partnership-client";

const submission = {
  idempotencyKey: "185808fb-4392-4452-b012-7d31647970e4",
  name: "Анна Соколова",
  companyOrClinic: "Клиника",
  contact: "partner@example.ru",
  role: "Партнёр" as const,
  consent: true,
};

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("033 EARS-18 — the interim partnership form posts into the queue", () => {
  it("EARS-18: posts the submission to the public intake with its idempotency key, the bot-protection proof and the consent version", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answer(201, { id: "a1" }));

    const result = await postAcademyPartnership(submission, "captcha-token", {
      fetchImpl,
    });

    expect(result).toEqual({ status: "success" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(path).toBe("/v1/public/applications/partnership");
    expect(ACADEMY_PARTNERSHIP_INTAKE_PATH).toBe(path);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("idempotency-key")).toBe(submission.idempotencyKey);
    expect(headers.get("x-smartcaptcha-token")).toBe("captcha-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Анна Соколова",
      companyOrClinic: "Клиника",
      contact: "partner@example.ru",
      role: "Партнёр",
      consentVersion: "academy-partnership-v1",
    });
  });

  it("EARS-18: an empty company is left out and no proof header is sent when protection is off", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answer(201, { id: "a1" }));

    await postAcademyPartnership(
      { ...submission, companyOrClinic: "" },
      undefined,
      { fetchImpl },
    );

    const init = fetchImpl.mock.calls[0]![1];
    expect(new Headers(init?.headers).has("x-smartcaptcha-token")).toBe(false);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty(
      "companyOrClinic",
    );
  });

  it.each(["BOT_PROTECTION_REQUIRED", "BOT_PROTECTION_REJECTED"])(
    "EARS-18: a %s refusal is raised as the 003 challenge code, not a save failure",
    async (code) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(answer(403, { code, message: "refused" }));

      await expect(
        postAcademyPartnership(submission, "captcha-token", { fetchImpl }),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each([
    ["a field-invalid 400", () => answer(400, { message: "invalid" })],
    ["a reused key 422", () => answer(422, { code: "IDEMPOTENCY_KEY_REUSED" })],
    ["a 503", () => new Response("down", { status: 503 })],
  ])(
    "EARS-18: %s shows the form's existing error state",
    async (_label, response) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());

      await expect(
        postAcademyPartnership(submission, "captcha-token", { fetchImpl }),
      ).resolves.toEqual({
        status: "error",
        message: ACADEMY_PARTNERSHIP_WRITE_ERROR,
      });
    },
  );

  it("EARS-18: an unreachable intake shows the form's existing error state", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      postAcademyPartnership(submission, undefined, { fetchImpl }),
    ).resolves.toEqual({
      status: "error",
      message: ACADEMY_PARTNERSHIP_WRITE_ERROR,
    });
  });

  it("EARS-18: the portal writes no file (V-6) — no source imports the retired file store", () => {
    const root = resolve(__dirname, "..");
    expect(existsSync(join(root, "lib", "academy-partnership-store.ts"))).toBe(
      false,
    );
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        if (["node_modules", ".next", "dist"].includes(entry)) continue;
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (
          /\.(ts|tsx)$/.test(entry) &&
          !path.endsWith("academy-partnership-client.test.ts") &&
          /academy-partnership-store|ACADEMY_SUBMISSIONS_DIR/.test(
            readFileSync(path, "utf8"),
          )
        ) {
          offenders.push(path);
        }
      }
    };
    for (const directory of ["app", "lib", "components", "e2e"]) {
      if (existsSync(join(root, directory))) walk(join(root, directory));
    }
    expect(offenders).toEqual([]);
  });
});
