import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { RoomChatCredential, RoomChatMessage } from "@ds/schemas";
import type { ApiEnv } from "../config/env.schema.js";
import { ROOM_CHAT_CONFIG } from "./room.tokens.js";

/**
 * The resolved Centrifugo chat configuration (design §4). Present only when the
 * three required pieces are configured; `null` otherwise (the shared-CI /
 * Centrifugo-less default — chat degrades to the truthful unavailable state,
 * mirroring the IdP / Redis / S3 fakes). Endpoint + keys are ALWAYS read from
 * config, never hardcoded (requirements Constraints; AGENTS.md §9).
 */
export interface RoomChatConfig {
  /** Browser-facing websocket endpoint, derived from `CENTRIFUGO_URL`. */
  readonly wsUrl: string;
  /** Centrifugo HTTP-API base (the `CENTRIFUGO_URL` origin, no trailing slash). */
  readonly apiBase: string;
  /** The `http_api.key` the server presents to publish (a browser never holds it). */
  readonly apiKey: string;
  /** The HS256 secret the connection token is signed with (matches config.json). */
  readonly hmacSecret: string;
  /** Connection-token TTL (seconds). */
  readonly tokenTtlSeconds: number;
}

/**
 * Build the {@link RoomChatConfig} from the loaded env, or `null` when Centrifugo
 * is not configured. The three hard requirements are the origin, the HTTP-API key
 * (server-side publish credential), and the token-signing secret — absent any of
 * them the chat is fail-closed unavailable. The browser websocket endpoint is
 * DERIVED from the origin (`http`→`ws`, `https`→`wss`, `/connection/websocket`
 * path) so a recipe configures ONE `CENTRIFUGO_URL`, never a second hardcoded ws
 * host.
 */
export function resolveRoomChatConfig(env: ApiEnv): RoomChatConfig | null {
  const { CENTRIFUGO_URL, CENTRIFUGO_API_KEY, CENTRIFUGO_TOKEN_HMAC_SECRET } =
    env;
  if (!CENTRIFUGO_URL || !CENTRIFUGO_API_KEY || !CENTRIFUGO_TOKEN_HMAC_SECRET) {
    return null;
  }
  const origin = new URL(CENTRIFUGO_URL);
  const wsProtocol = origin.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${origin.host}/connection/websocket`;
  return {
    wsUrl,
    apiBase: CENTRIFUGO_URL.replace(/\/$/, ""),
    apiKey: CENTRIFUGO_API_KEY,
    hmacSecret: CENTRIFUGO_TOKEN_HMAC_SECRET,
    tokenTtlSeconds: env.CHAT_TOKEN_TTL_SECONDS,
  };
}

/** base64url of a UTF-8 string / buffer, no padding (JWT segment encoding). */
function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Chat is momentarily unreachable (Centrifugo not configured, or a publish call
 * failed). HTTP-agnostic so the gate stays a pure domain layer; the controller
 * maps it to a `503`. A post is NEVER silently dropped — the doctor learns the
 * message did not land, and no partial state is left (the durable presence record
 * is a separate table; chat is transient — design §4).
 */
export class ChatUnavailableError extends Error {
  constructor(detail = "chat transport is unavailable") {
    super(detail);
    this.name = "ChatUnavailableError";
  }
}

/**
 * 006 EARS-3 — the Centrifugo chat gateway (design §4). It owns the two
 * server-side halves of the live chat, both behind the room admission gate
 * ({@link RoomService} evaluates the gate BEFORE either is reached):
 *
 * 1. **Mint the gate-scoped, subscribe-only connection credential.** A Centrifugo
 *    connection JWT (HS256, HMAC) whose `channels` claim lists EXACTLY the caller's
 *    room channel — Centrifugo subscribes the connection to it server-side on
 *    connect, so the token grants READ of this one room and nothing else. It
 *    carries no publish capability (the `room` namespace keeps
 *    `allow_publish_for_client` off), so a client can never publish directly to
 *    the channel — every post rides the gated command (EARS-3, EARS-8).
 * 2. **Publish a gated doctor's message** to the room channel over the Centrifugo
 *    HTTP API, authenticated with the `http_api` key a browser never holds. This
 *    is the ONLY publish path; the fan-out to every subscriber is real-time and
 *    reload-free.
 *
 * The gateway holds no gate logic of its own — it is reached ONLY after
 * {@link RoomService.admit} has admitted the caller, so an ungated caller never
 * mints a token or publishes a message. When Centrifugo is not configured the
 * gateway is disabled: {@link credential} returns `null` (the grant carries
 * `chat: null`) and {@link publish} throws {@link ChatUnavailableError}.
 */
@Injectable()
export class CentrifugoChatGateway {
  constructor(
    @Inject(ROOM_CHAT_CONFIG) private readonly config: RoomChatConfig | null,
  ) {}

  /** Whether Centrifugo is configured (chat is live) on this runtime. */
  get enabled(): boolean {
    return this.config !== null;
  }

  /** The per-event room channel, keyed by event id (design §4). */
  channelForEvent(eventId: string): string {
    return `room:event:${eventId}`;
  }

  /**
   * A stable, **non-reversible, PII-free** author tag for a doctor, derived from
   * their opaque domain user id (never their email / phone / roster identity —
   * EARS-8). Stable across a doctor's messages (a SHA-256 prefix of the id), so
   * their posts read consistently, and the same doctor's `selfTag` in
   * {@link credential} matches, letting the client mark its own messages without
   * the server exposing more than the tag chat legitimately shows.
   */
  authorTag(userId: string): string {
    return createHash("sha256").update(userId).digest("hex").slice(0, 4).toUpperCase();
  }

  /**
   * Mint the gate-scoped subscribe-only credential for `(userId, eventId)`, or
   * `null` when Centrifugo is not configured. Called ONLY after the gate admitted
   * the caller (design §4).
   */
  credential(userId: string, eventId: string): RoomChatCredential | null {
    if (!this.config) return null;
    const channel = this.channelForEvent(eventId);
    return {
      url: this.config.wsUrl,
      token: this.mintConnectionToken(userId, channel),
      channel,
      selfTag: this.authorTag(userId),
    };
  }

  /**
   * A Centrifugo connection JWT (HS256) subscribing the connection SERVER-SIDE to
   * exactly `channel` via the `channels` claim, expiring after the configured TTL.
   * No publish claim is present — the token is read-only for this one room.
   */
  private mintConnectionToken(userId: string, channel: string): string {
    const config = this.config;
    if (!config) throw new ChatUnavailableError();
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        sub: userId,
        channels: [channel],
        iat: now,
        exp: now + config.tokenTtlSeconds,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", config.hmacSecret)
      .update(signingInput)
      .digest("base64url");
    return `${signingInput}.${signature}`;
  }

  /**
   * Publish one gated doctor's message to the room channel over the Centrifugo
   * HTTP API (the ONLY publish path — server-mediated, behind the gate). Throws
   * {@link ChatUnavailableError} when Centrifugo is unconfigured or the publish is
   * rejected, so the command surfaces a 503 rather than reporting a phantom
   * success.
   */
  async publish(eventId: string, message: RoomChatMessage): Promise<void> {
    const config = this.config;
    if (!config) throw new ChatUnavailableError();
    let res: Response;
    try {
      res = await fetch(`${config.apiBase}/api/publish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-API-Key": config.apiKey,
        },
        body: JSON.stringify({
          channel: this.channelForEvent(eventId),
          data: message,
        }),
      });
    } catch (cause) {
      throw new ChatUnavailableError(
        `centrifugo publish request failed: ${String(cause)}`,
      );
    }
    if (!res.ok) {
      throw new ChatUnavailableError(
        `centrifugo publish failed with status ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      error?: { code: number; message: string };
    };
    if (body.error) {
      throw new ChatUnavailableError(
        `centrifugo publish error ${body.error.code}: ${body.error.message}`,
      );
    }
  }
}
