import { describe, expect, it, vi } from "vitest";
import {
  chooseSpecialty,
  resolveRememberedSpecialty,
} from "./specialty-choice";

const choice = {
  specialty: {
    id: "11111111-1111-4111-8111-111111111111",
    code: "obshchaya-vrachebnaya-praktika",
    name: "Общая врачебная практика",
    isOther: false,
  },
  storedIn: "profile" as const,
};

describe("017 EARS-6 specialty choice transport", () => {
  it("EARS-6.14: an authenticated SSR resolve with an anonymous choice shall request browser-side session consumption", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(choice), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const headers = new Headers({
      cookie:
        "__Host-ds_session=session; __Host-ds_specialty=22222222-2222-4222-8222-222222222222",
    });

    await expect(
      resolveRememberedSpecialty(headers, fetchImpl),
    ).resolves.toMatchObject({
      actor: "doctor",
      choice,
      consumeSession: true,
    });
  });

  it("EARS-6.15: each guest and doctor choice mutation shall carry a fresh canonical Idempotency-Key", async () => {
    const seen: string[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        const key = new Headers(init?.headers).get("idempotency-key");
        seen.push(key ?? "");
        return Promise.resolve(
          new Response(JSON.stringify(choice), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      });

    await chooseSpecialty(choice.specialty.id, "guest", fetchImpl);
    await chooseSpecialty(choice.specialty.id, "doctor", fetchImpl);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(seen[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(seen[0]).not.toBe(seen[1]);
  });
});
