import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { DRIZZLE_DB } from "../../src/database/database.tokens.js";
import { SpecialtyProblemFilter } from "../../src/storefront/specialties.problem-filter.js";
import { SpecialtyError } from "../../src/storefront/specialties.errors.js";
import { TaxonomyError } from "../../src/taxonomy/taxonomy.errors.js";
import { IdempotencyService } from "../../src/taxonomy/idempotency.service.js";
import { SpecialtyChoiceMeController } from "../../src/storefront/specialty-choice.me.controller.js";
import { SpecialtyChoicePublicController } from "../../src/storefront/specialty-choice.public.controller.js";
import { SpecialtyChoiceService } from "../../src/storefront/specialty-choice.service.js";

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
  it("EARS-6.26: first and replayed 422 refusals shall remain HTTP Problem Details on both mutation routes", async () => {
    const outcomes = new Map<
      string,
      { status: number; body: unknown; etag: null; location: null }
    >();
    const idempotency = {
      requireKey: vi.fn((raw: unknown) => String(raw)),
      fingerprint: vi.fn(() => "fingerprint"),
      begin: vi.fn(async (params: { route: string }) => {
        const replay = outcomes.get(params.route);
        if (replay) return { kind: "replay", replay } as const;
        return {
          kind: "owned",
          lease: {
            key: "11111111-1111-4111-8111-111111111111",
            actorId: null,
            method: params.route.includes("public") ? "POST" : "PUT",
            route: params.route,
            fingerprint: "fingerprint",
            leaseEpoch: 1,
            leaseOwner: "owner",
          },
        } as const;
      }),
      storeTerminalOutcome: vi.fn(
        async (
          lease: { route: string },
          response: { status: number; body: unknown },
        ) => {
          outcomes.set(lease.route, {
            status: response.status,
            body: response.body,
            etag: null,
            location: null,
          });
        },
      ),
    };
    const refuse = async (_reference: string, lease: { route: string }) => {
      const error = new SpecialtyError("SPECIALTY_NOT_IN_BOOK");
      error.replayLease = lease as never;
      throw error;
    };
    const choices = {
      chooseAsGuest: vi.fn(refuse),
      chooseAsDoctor: vi.fn(
        async (_sub: string, reference: string, lease: { route: string }) =>
          refuse(reference, lease),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        SpecialtyChoicePublicController,
        SpecialtyChoiceMeController,
      ],
      providers: [
        SpecialtyProblemFilter,
        { provide: SpecialtyChoiceService, useValue: choices },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: DRIZZLE_DB, useValue: {} },
      ],
    }).compile();
    const adapter = new FastifyAdapter();
    adapter.getInstance().addHook("onRequest", async (request) => {
      Object.assign(request, { user: { sub: "doctor-a" } });
    });
    const app =
      moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    try {
      for (const request of [
        { method: "POST" as const, url: "/v1/public/specialty-choice" },
        { method: "PUT" as const, url: "/v1/me/specialty" },
      ]) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await app.inject({
            ...request,
            headers: {
              "content-type": "application/json",
              "idempotency-key": "11111111-1111-4111-8111-111111111111",
            },
            payload: { specialty: "absent" },
          });
          expect(response.statusCode).toBe(422);
          expect(response.headers["content-type"]).toMatch(
            /^application\/problem\+json(?:;|$)/,
          );
          expect(response.json()).toMatchObject({
            status: 422,
            errorCode: "SPECIALTY_NOT_IN_BOOK",
          });
        }
      }
    } finally {
      await app.close();
    }
  });

  it("EARS-6.20: a deterministic 422 refusal replay shall restore status and body on both mutation routes", async () => {
    const problem = {
      type: "https://docs.doctor.school/errors/specialty-not-in-book",
      title: "Specialty is not in the reference book",
      status: 422,
      errorCode: "SPECIALTY_NOT_IN_BOOK",
      traceId: "trace-a",
    };
    const choices = { chooseAsGuest: vi.fn(), chooseAsDoctor: vi.fn() };
    const idempotency = {
      requireKey: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
      fingerprint: vi.fn(() => "fingerprint"),
      begin: vi.fn().mockResolvedValue({
        kind: "replay",
        replay: { status: 422, body: problem, etag: null, location: null },
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
    const request = {
      headers: { "idempotency-key": "11111111-1111-4111-8111-111111111111" },
      user: { sub: "doctor-a" },
    };

    for (const run of [
      (response: ReturnType<typeof reply>) =>
        publicController.choose(
          { specialty: "absent" },
          request as never,
          response as never,
        ),
      (response: ReturnType<typeof reply>) =>
        meController.choose(
          { specialty: "absent" },
          request as never,
          response as never,
        ),
    ]) {
      const response = reply();
      await expect(run(response)).resolves.toEqual(problem);
      expect(response.status).toHaveBeenCalledWith(422);
      expect(response.header).not.toHaveBeenCalledWith(
        "set-cookie",
        expect.anything(),
      );
    }
    expect(choices.chooseAsGuest).not.toHaveBeenCalled();
    expect(choices.chooseAsDoctor).not.toHaveBeenCalled();
  });

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
