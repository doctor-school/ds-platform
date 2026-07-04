import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as Sentry from "@sentry/node";
import { SentryExceptionFilter } from "./sentry-exception.filter.js";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

describe("SentryExceptionFilter", () => {
  const host = {} as ArgumentsHost;
  let superCatch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub the base filter's response handling — this unit asserts the REPORTING
    // decision, not the HTTP response (BaseExceptionFilter owns that, unchanged).
    superCatch = vi
      .spyOn(BaseExceptionFilter.prototype, "catch")
      .mockImplementation(() => undefined);
  });

  it("reports an unexpected (non-HttpException) error and still defers to the base filter", () => {
    const filter = new SentryExceptionFilter();
    const error = new Error("boom");

    filter.catch(error, host);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(superCatch).toHaveBeenCalledWith(error, host);
  });

  it("reports a 5xx HttpException", () => {
    const filter = new SentryExceptionFilter();
    for (const error of [
      new InternalServerErrorException("db down"),
      new ServiceUnavailableException("dependency down"),
    ]) {
      filter.catch(error, host);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    }
  });

  it("does NOT report 4xx client errors (expected control flow)", () => {
    const filter = new SentryExceptionFilter();
    for (const error of [
      new BadRequestException("bad input"),
      new ForbiddenException("nope"),
      new NotFoundException("missing"),
    ]) {
      filter.catch(error, host);
    }

    expect(Sentry.captureException).not.toHaveBeenCalled();
    // Response handling is still delegated for every case.
    expect(superCatch).toHaveBeenCalledTimes(3);
  });
});
