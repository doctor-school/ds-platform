import { createHash, timingSafeEqual } from "node:crypto";
import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Authz, Public } from "../../authz/index.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import { VK_CALLBACK_UNPARSABLE } from "./vk-callback-body.js";
import { VK_CONFIG, type VkConfig } from "./vk-config.js";
import { objectIdOf, VkFeedSource } from "./vk.feed-source.js";

// 048 EARS-39, EARS-40 (#4004) — `POST /v1/integrations/vk/callback`, the VK
// Callback API ingress on the public API host (048-design «Callback (EARS-39,
// EARS-40)»; ADR-0011 ingress). Public by design: the credential is the
// `secret` VK puts in the body, compared in constant time before any database
// read; there is no session or CSRF. Answers: `404` while the connector is
// not configured; `401` to an unparsable body, a wrong `secret` or — for any
// event but `confirmation` — none; the configured confirmation string for a
// `confirmation` of a bound community; `ok` (200) to every other accepted or
// dropped event, so VK neither retries nor pauses; `500` only when our own
// write fails, so VK delivers again. The secret, the confirmation string and
// the raw body are never logged (EARS-51).

const OK = "ok";

/** The envelope fields the route reads; the object is the feed source's to validate. */
const EnvelopeSchema = z.object({
  type: z.string().min(1).max(64),
  group_id: z
    .number()
    .int()
    .positive()
    .max(2 ** 53 - 1),
  event_id: z.string().max(128).optional(),
  object: z.unknown().optional(),
});

/** Constant-time equality of two strings of any length (EARS-39). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.slice(0, 32) : null;
}

@Controller({ path: "integrations/vk", version: "1" })
export class VkCallbackController {
  private readonly logger = new Logger("VkIngress");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(VK_CONFIG) private readonly config: VkConfig | null,
    @Inject(VkFeedSource) private readonly feed: VkFeedSource,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
  ) {}

  @Post("callback")
  @HttpCode(200)
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-39", "EARS-40"],
  })
  async callback(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const config = this.config;
    if (config === null) {
      await reply.status(404).send();
      return;
    }
    const body: unknown = req.body;
    if (
      body === VK_CALLBACK_UNPARSABLE ||
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      await this.refuse(reply);
      return;
    }
    const raw = body as Record<string, unknown>;
    const secret = raw.secret;
    const type = raw.type;
    if (typeof secret === "string") {
      if (!secretMatches(secret, config.callbackSecret)) {
        await this.refuse(reply);
        return;
      }
    } else if (secret !== undefined || type !== "confirmation") {
      await this.refuse(reply);
      return;
    }
    const envelope = EnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      this.logDrop(raw, req, "malformed");
      await this.answer(reply, OK);
      return;
    }
    const event = envelope.data;
    if (event.type === "confirmation") {
      const source = await this.sources.findVkByGroup(event.group_id);
      if (source) {
        this.logger.log(
          JSON.stringify({
            event: "vk_confirmation_answered",
            groupId: event.group_id,
            sourceId: source.id,
          }),
        );
        await this.answer(reply, config.confirmation);
        return;
      }
      this.logDrop(raw, req, "unlisted");
      await this.answer(reply, OK);
      return;
    }
    // A database failure throws here: Nest answers 500 and VK retries.
    await this.feed.receive({
      type: event.type,
      groupId: event.group_id,
      eventId: event.event_id ?? null,
      object: event.object,
      retryCounter: header(req, "x-retry-counter"),
    });
    await this.answer(reply, OK);
  }

  private async refuse(reply: FastifyReply): Promise<void> {
    await reply.status(401).type("text/plain; charset=utf-8").send();
  }

  private async answer(reply: FastifyReply, text: string): Promise<void> {
    await reply.status(200).type("text/plain; charset=utf-8").send(text);
  }

  /** EARS-40 — a drop before the feed source: ids, type, retry counter, reason. */
  private logDrop(
    raw: Record<string, unknown>,
    req: FastifyRequest,
    reason: "malformed" | "unlisted",
  ): void {
    const str = (v: unknown) =>
      typeof v === "string" ? v.slice(0, 128) : null;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isSafeInteger(v) ? v : null;
    this.logger.log(
      JSON.stringify({
        event: "vk_event_dropped",
        eventId: str(raw.event_id),
        type: str(raw.type),
        groupId: num(raw.group_id),
        objectId: objectIdOf(raw.object),
        retryCounter: header(req, "x-retry-counter"),
        reason,
      }),
    );
  }
}
