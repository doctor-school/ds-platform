import { describe, expect, it, vi } from "vitest";
import { TaxonomyError } from "../../src/taxonomy/taxonomy.errors.js";
import { SpecialtyChoiceMeController } from "../../src/storefront/specialty-choice.me.controller.js";
import { SpecialtyChoicePublicController } from "../../src/storefront/specialty-choice.public.controller.js";

const profileChoice = {
  specialty: {
    id: "11111111-1111-4111-8111-111111111111",
    code: "obshchaya-vrachebnaya-praktika",
    name: "Общая врачебная практика",
    isOther: false,
  },
  storedIn: "profile" as const,
};

function reply() {
  return {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
}

describe("017 EARS-6 specialty choice controller transport", () => {
  it("EARS-6.18: adoption and profile-wins discard shall both emit a durable guest-cookie deletion", async () => {
    for (const consumedSession of [true, false]) {
      const choices = {
        resolveForDoctor: vi.fn().mockResolvedValue({
          choice: profileChoice,
          consumedSession,
        }),
      };
      const controller = new SpecialtyChoiceMeController(
        choices as never,
        {} as never,
      );
      const response = reply();
      const cookie = consumedSession
        ? "__Host-ds_specialty=11111111-1111-4111-8111-111111111111"
        : "__Host-ds_specialty=%ZZ";

      await controller.read(
        { headers: { cookie }, user: { sub: "doctor-a" } } as never,
        response as never,
      );

      expect(response.header).toHaveBeenCalledWith(
        "set-cookie",
        expect.stringContaining("Max-Age=0"),
      );
    }
  });

  it("EARS-6.19: both specialty mutations shall reject a missing Idempotency-Key before domain work", async () => {
    const choices = {
      chooseAsGuest: vi.fn(),
      chooseAsDoctor: vi.fn(),
    };
    const idempotency = {
      requireKey: vi.fn(() => {
        throw new TaxonomyError("IDEMPOTENCY_KEY_REQUIRED");
      }),
    };
    const publicController = new SpecialtyChoicePublicController(
      choices as never,
      idempotency as never,
      {} as never,
    );
    const meController = new SpecialtyChoiceMeController(
      choices as never,
      idempotency as never,
    );
    const request = { headers: {}, user: { sub: "doctor-a" } };

    await expect(
      publicController.choose(
        { specialty: profileChoice.specialty.id },
        request as never,
        reply() as never,
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(
      meController.choose(
        { specialty: profileChoice.specialty.id },
        request as never,
        reply() as never,
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(choices.chooseAsGuest).not.toHaveBeenCalled();
    expect(choices.chooseAsDoctor).not.toHaveBeenCalled();
  });
});
