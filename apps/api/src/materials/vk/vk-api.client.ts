import { Logger } from "@nestjs/common";
import { z } from "zod";
import {
  GroupsGetByIdResponseSchema,
  VK_API_VERSION,
  VkApiError,
  VkGroupRefSchema,
  VkNotConfiguredError,
  WallGetParamsSchema,
  WallGetResponseSchema,
  type VkApi,
  type VkCallCounter,
  type VkCallOutcome,
  type VkGroup,
  type VkGroupRef,
  type WallGetParams,
  type WallPage,
} from "./vk-api.types.js";

// 048 slice 3 — ADR-0011 §2.2 channel #11 «VK API». THE ONLY code that calls
// `https://api.vk.com/method/*` (048-design «Egress, ingress and
// configuration (slice 3)»). Sanitizer: only `wall.get` and `groups.getById`,
// parameters Zod-checked before any request (built from server config and the
// source list), every response Zod-checked, VK `error` objects included. The
// service key rides in the POST body, never the URL, and no body or VK error
// text is ever logged or thrown: a failure surfaces as a `VkApiError` with the
// method, HTTP status, VK error code and outcome only. Audit: one structured
// line per call — method, HTTP status, VK error code, duration, outcome — and
// the month's counter, incremented before the request (EARS-44, EARS-51).
// Kill switch: no key → no call.

const API_ORIGIN = "https://api.vk.com/method";
const DEFAULT_TIMEOUT_MS = 10_000;

export type VkFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

/** The structured log line sink; the Nest logger in production. */
export interface VkCallLogger {
  log(line: Record<string, unknown>): void;
  warn(line: Record<string, unknown>): void;
}

export interface VkApiClientOptions {
  fetchImpl?: VkFetchLike;
  logger?: VkCallLogger;
  timeoutMs?: number;
}

const EnvelopeSchema = z.union([
  z.object({ response: z.unknown() }),
  z.object({
    error: z.object({ error_code: z.number().int().optional() }),
  }),
]);

function nestLogger(): VkCallLogger {
  const logger = new Logger("VkApi");
  return {
    log: (line) => logger.log(JSON.stringify(line)),
    warn: (line) => logger.warn(JSON.stringify(line)),
  };
}

export class VkApiClient implements VkApi {
  private readonly fetchImpl: VkFetchLike;
  private readonly logger: VkCallLogger;
  private readonly timeoutMs: number;

  constructor(
    private readonly serviceKey: string | null,
    private readonly counter: VkCallCounter,
    options: VkApiClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as VkFetchLike);
    this.logger = options.logger ?? nestLogger();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async wallGet(params: WallGetParams): Promise<WallPage> {
    const parsed = WallGetParamsSchema.parse(params);
    return this.call("wall.get", parsed, WallGetResponseSchema);
  }

  async groupsGetById(group: VkGroupRef): Promise<VkGroup[]> {
    const group_id = VkGroupRefSchema.parse(group);
    return this.call(
      "groups.getById",
      { group_id },
      GroupsGetByIdResponseSchema,
    );
  }

  private async call<T>(
    method: "wall.get" | "groups.getById",
    params: Record<string, string | number | undefined>,
    resultSchema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.serviceKey) throw new VkNotConfiguredError();
    const body = new URLSearchParams({
      access_token: this.serviceKey,
      v: VK_API_VERSION,
    });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) body.set(name, String(value));
    }
    await this.counter.count();
    const started = Date.now();
    let status: number | null = null;
    let payload: unknown;
    try {
      const res = await this.fetchImpl(`${API_ORIGIN}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      payload = await res.json().catch(() => undefined);
    } catch (error) {
      throw this.fail(method, transportOutcome(error), status, null, started);
    }
    const envelope = EnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw this.fail(
        method,
        status !== null && status >= 400 ? "http_error" : "invalid_response",
        status,
        null,
        started,
      );
    }
    if ("error" in envelope.data) {
      throw this.fail(
        method,
        "api_error",
        status,
        envelope.data.error.error_code ?? null,
        started,
      );
    }
    const result = resultSchema.safeParse(envelope.data.response);
    if (!result.success) {
      throw this.fail(method, "invalid_response", status, null, started);
    }
    this.record(method, status, null, started, "ok");
    return result.data;
  }

  private record(
    method: string,
    httpStatus: number | null,
    errorCode: number | null,
    started: number,
    outcome: VkCallOutcome,
  ): void {
    const line = {
      event: "vk_api_call",
      method,
      httpStatus,
      errorCode,
      durationMs: Date.now() - started,
      outcome,
    };
    if (outcome === "ok") this.logger.log(line);
    else this.logger.warn(line);
  }

  private fail(
    method: string,
    outcome: Exclude<VkCallOutcome, "ok">,
    httpStatus: number | null,
    errorCode: number | null,
    started: number,
  ): VkApiError {
    this.record(method, httpStatus, errorCode, started, outcome);
    return new VkApiError(method, outcome, httpStatus, errorCode);
  }
}

function transportOutcome(error: unknown): "timeout" | "network_error" {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "network_error";
}
