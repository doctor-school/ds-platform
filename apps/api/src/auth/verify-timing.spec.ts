import "reflect-metadata";
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { FastifyReply } from "fastify";
import { from, lastValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInHostController } from "../sign-in-host/sign-in-host.controller.js";
import type { SignInHostService } from "../sign-in-host/sign-in-host.service.js";
import type { DoctorRegisterService } from "../storefront/doctor-register.service.js";
import type { AuthService } from "./auth.service.js";
import type { LoginChallengePolicy } from "./login-challenge/index.js";
import type { RateLimitService } from "./rate-limit/index.js";
import { TimingEqualizationInterceptor } from "./timing/timing-equalization.interceptor.js";
import { TimingEqualizationModule } from "./timing/timing-equalization.module.js";
import {
  TIMING_CLOCK,
  TIMING_FLOOR_MS,
  type Clock,
} from "./timing/timing-equalization.types.js";
import {
  readAuthVerifyTimingFloorMs,
  resolveAuthVerifyTimingFloorMs,
} from "./verify-timing.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("003 EARS-41/16 verification response timing", () => {
  it("EARS-41: malformed, unsafe, tiny and overflowing configuration uses the safe default", () => {
    for (const raw of [
      undefined,
      "",
      " ",
      "-1",
      "0",
      "1",
      "39",
      "1.5",
      "1000.0",
      "2e3",
      "NaN",
      "Infinity",
      "abc",
      "9007199254740992",
      "2147483648",
    ]) {
      expect(resolveAuthVerifyTimingFloorMs(raw)).toBe(1000);
    }
  });

  it("EARS-41: valid calibration is whole milliseconds within the global minimum and Node timer bound", () => {
    expect(resolveAuthVerifyTimingFloorMs("40")).toBe(40);
    expect(resolveAuthVerifyTimingFloorMs("2500")).toBe(2500);
    expect(resolveAuthVerifyTimingFloorMs("2147483647")).toBe(2147483647);
  });

  it("EARS-41: the reader resolves current configuration for every request", () => {
    vi.stubEnv("AUTH_VERIFY_TIMING_FLOOR_MS", "2500");
    expect(readAuthVerifyTimingFloorMs()).toBe(2500);
    vi.stubEnv("AUTH_VERIFY_TIMING_FLOOR_MS", "3500");
    expect(readAuthVerifyTimingFloorMs()).toBe(3500);
    vi.stubEnv("AUTH_VERIFY_TIMING_FLOOR_MS", undefined);
    expect(readAuthVerifyTimingFloorMs()).toBe(1000);
  });

  it("EARS-41: the host's Academy code step and production default equalize unequal IdP refusal branches within 50 ms", async () => {
    vi.stubEnv("AUTH_VERIFY_TIMING_FLOOR_MS", undefined);
    const module = await Test.createTestingModule({
      imports: [TimingEqualizationModule],
    }).compile();
    const interceptor = new TimingEqualizationInterceptor(
      module.get<number>(TIMING_FLOOR_MS),
      module.get<Clock>(TIMING_CLOCK),
      new Reflector(),
    );
    const context = {
      getHandler: () => SignInHostController.prototype.verify,
      getClass: () => SignInHostController,
    } as unknown as ExecutionContext;
    vi.useFakeTimers();
    const timings: number[][] = [[], [], []];
    try {
      for (let round = 0; round < 5; round += 1) {
        for (const [index, delay] of [0, 60, 155].entries()) {
          // The host's Academy code step over a checked form; only the IdP
          // refusal branch's latency differs between the three runs.
          const controller = new SignInHostController(
            {
              checkFormPost: () => Promise.resolve({}),
              assertStorefront: () => undefined,
              warmRegistration: () => undefined,
              acceptInto: () => () => Promise.reject(new Error("unreached")),
            } as unknown as SignInHostService,
            {
              verifyStep: async () => {
                await new Promise<void>((resolve) =>
                  setTimeout(resolve, delay),
                );
                throw new BadRequestException(
                  "the request could not be completed",
                );
              },
            } as unknown as AuthService,
            {} as LoginChallengePolicy,
            {} as RateLimitService,
            {} as DoctorRegisterService,
          );
          const header = vi.fn();
          const next: CallHandler = {
            handle: () =>
              from(
                controller.verify(
                  {
                    email: "owned@unit.test",
                    code: "654321",
                    authRequest: "auth-request-1",
                    csrf: "csrf-1",
                  },
                  {},
                  "127.0.0.1",
                  undefined,
                  { header } as unknown as FastifyReply,
                ),
              ),
          };
          const started = Date.now();
          const result = lastValueFrom(
            interceptor.intercept(context, next),
          ).then(
            () => {
              throw new Error("Expected the generic code refusal");
            },
            (error: BadRequestException) => ({
              ms: Date.now() - started,
              status: error.getStatus(),
              body: error.getResponse(),
            }),
          );
          await vi.runAllTimersAsync();
          const observed = await result;
          expect(observed.status).toBe(400);
          expect(observed.body).toEqual({
            statusCode: 400,
            message: "the request could not be completed",
            error: "Bad Request",
          });
          expect(header).not.toHaveBeenCalled();
          timings[index]!.push(observed.ms);
        }
      }
      const medians = timings.map(
        (values) => [...values].sort((a, b) => a - b)[2]!,
      );
      expect(Math.max(...medians) - Math.min(...medians)).toBeLessThanOrEqual(
        50,
      );
    } finally {
      await module.close();
    }
  });
});
