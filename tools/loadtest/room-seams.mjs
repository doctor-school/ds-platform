#!/usr/bin/env node
// Shared synthetic-doctor + room transport seams for the #873 capacity scenarios
// and the #1139 low-N behavioral verifier. Keeping login, manifest selection, HTTP
// commands, and the Centrifugo JSON protocol here means the verifier exercises the
// real load-test path instead of inventing a parallel account or realtime client.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { optEnv, sleep, timedFetch } from "./lib.mjs";

const ROOM_HARNESS_USER_AGENT = "ds-room-harness/1";
const ROOM_HARNESS_ACCEPT_LANGUAGE = "en-US";

/** Stable fingerprint headers for login and every authenticated BFF request. */
export function roomSessionHeaders(cookie, extra = {}) {
  return {
    ...extra,
    "user-agent": ROOM_HARNESS_USER_AGENT,
    "accept-language": ROOM_HARNESS_ACCEPT_LANGUAGE,
    ...(cookie ? { cookie } : {}),
  };
}

/** Select scenario-ready credentials while retaining old manifest compatibility. */
export function manifestCredentials(manifest) {
  return (manifest.users ?? [])
    .filter((user) => user.usable !== false)
    .map((user) => ({ email: user.email, password: user.password }))
    .filter(({ email, password }) => Boolean(email && password));
}

/** Load the credentials written by `pnpm loadtest:provision`. */
export function loadManifestCredentials() {
  const path = optEnv(
    "LOADTEST_MANIFEST",
    resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
  );
  if (!existsSync(path)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read synthetic-doctor manifest ${path}: ${error.message}`,
      { cause: error },
    );
  }
  return manifestCredentials(manifest);
}

/** Extract the cookie pairs a BFF session needs from a Node fetch response. */
function responseCookie(headers) {
  const setCookies = headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    return setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  }
  const fallback = headers.get("set-cookie");
  return fallback ? fallback.split(";", 1)[0] : null;
}

/** BFF login; returns the replayable Cookie header or null on refusal/failure. */
export async function loginCookie(origin, email, password) {
  const response = await timedFetch(`${origin}/v1/auth/login`, {
    method: "POST",
    headers: roomSessionHeaders(undefined, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!response.ok) return null;
  return responseCookie(response.headers);
}

/** Read the gate-scoped room grant through the authenticated BFF session. */
export async function fetchRoomGrant(origin, eventId, cookie) {
  return timedFetch(`${origin}/v1/events/${encodeURIComponent(eventId)}/room`, {
    headers: roomSessionHeaders(cookie, { accept: "application/json" }),
  });
}

/**
 * Idempotently roster a synthetic doctor through the real 005 product command.
 * A `published` or `live` event accepts this; any other state is a pointed fixture
 * error rather than a direct database write or a parallel roster seam.
 */
export async function ensureRoomRegistration(origin, eventId, cookie) {
  return timedFetch(
    `${origin}/v1/events/${encodeURIComponent(eventId)}/registration`,
    {
      method: "POST",
      headers: roomSessionHeaders(cookie, { accept: "application/json" }),
    },
  );
}

/** Append one real, gated heartbeat. */
export async function postRoomHeartbeat(origin, eventId, cookie) {
  return timedFetch(
    `${origin}/v1/events/${encodeURIComponent(eventId)}/heartbeat`,
    {
      method: "POST",
      headers: roomSessionHeaders(cookie, { accept: "application/json" }),
    },
  );
}

/** Publish one real chat message through the server-mediated command. */
export async function postRoomChat(origin, eventId, cookie, text) {
  return timedFetch(`${origin}/v1/events/${encodeURIComponent(eventId)}/chat`, {
    method: "POST",
    headers: roomSessionHeaders(cookie, {
      accept: "application/json",
      "content-type": "application/json",
    }),
    body: JSON.stringify({ text }),
  });
}

/** Decode a newline-delimited Centrifugo JSON-protocol frame. */
export function parseCentrifugoReplyData(raw) {
  return String(raw)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Minimal Centrifugo JSON-protocol connection used by both room tools. The room
 * token server-subscribes the connection, so this client needs only connect,
 * publications, history, and ping/pong; it never carries client publish rights.
 */
export class CentrifugoRoomConnection {
  constructor({ url, token, channel, timeoutMs = 10_000 }) {
    this.url = url;
    this.token = token;
    this.channel = channel;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.publications = [];
    this.publicationWaiters = new Set();
    this.closed = false;
  }

  async connect() {
    const startedAt = performance.now();
    this.ws = new globalThis.WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.#onMessage(event));
    this.ws.addEventListener("close", () => this.#onClose());
    this.ws.addEventListener("error", () => this.#onTransportError());

    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(
        () =>
          rejectOpen(
            new Error(`Centrifugo websocket open timeout>${this.timeoutMs}ms`),
          ),
        this.timeoutMs,
      );
      this.ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolveOpen();
        },
        { once: true },
      );
      this.ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          rejectOpen(new Error("Centrifugo websocket failed before open"));
        },
        { once: true },
      );
    });

    const reply = await this.#command({ connect: { token: this.token } });
    const connect = reply.connect;
    if (!connect)
      throw new Error("Centrifugo connect reply has no connect result");
    if (this.channel && !connect.subs?.[this.channel]) {
      throw new Error(
        `Centrifugo token did not server-subscribe expected channel ${this.channel}`,
      );
    }
    for (const [channel, sub] of Object.entries(connect.subs ?? {})) {
      for (const publication of sub.publications ?? []) {
        this.#recordPublication(channel, publication);
      }
    }
    return {
      connectMs: performance.now() - startedAt,
      client: connect.client ?? "",
    };
  }

  async history(limit = 100) {
    if (!this.channel)
      throw new Error("history requires the expected room channel");
    const reply = await this.#command({
      history: { channel: this.channel, limit },
    });
    if (!reply.history)
      throw new Error("Centrifugo history reply has no history result");
    return (reply.history.publications ?? []).map((publication) => ({
      channel: this.channel,
      data: publication.data,
      offset: publication.offset,
    }));
  }

  waitForPublication(predicate, { timeoutMs, afterMs = 0 } = {}) {
    const buffered = this.publications.find(
      (publication) =>
        publication.receivedAtMs >= afterMs && predicate(publication),
    );
    if (buffered) return Promise.resolve(buffered);

    const waitMs = timeoutMs ?? this.timeoutMs;
    return new Promise((resolvePublication, rejectPublication) => {
      const waiter = {
        predicate,
        afterMs,
        resolve: resolvePublication,
        reject: rejectPublication,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        this.publicationWaiters.delete(waiter);
        rejectPublication(
          new Error(
            `Centrifugo publication timeout>${waitMs}ms on ${this.channel}`,
          ),
        );
      }, waitMs);
      this.publicationWaiters.add(waiter);
    });
  }

  async close(code = 1000, reason = "room verifier complete") {
    if (!this.ws || this.ws.readyState === globalThis.WebSocket.CLOSED) return;
    if (this.ws.readyState === globalThis.WebSocket.CLOSING) {
      await sleep(25);
      return;
    }
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 1_000);
      this.ws.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          resolveClose();
        },
        { once: true },
      );
      this.ws.close(code, reason);
    });
  }

  #command(command) {
    if (!this.ws || this.ws.readyState !== globalThis.WebSocket.OPEN) {
      return Promise.reject(new Error("Centrifugo websocket is not open"));
    }
    const id = ++this.nextId;
    const frame = { ...command, id };
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReply(
          new Error(`Centrifugo command ${id} timeout>${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: resolveReply,
        reject: rejectReply,
        timer,
      });
      this.ws.send(JSON.stringify(frame));
    });
  }

  #onMessage(event) {
    const raw = typeof event.data === "string" ? event.data : "";
    let replies;
    try {
      replies = parseCentrifugoReplyData(raw);
    } catch (error) {
      this.#rejectAll(
        new Error(`invalid Centrifugo JSON frame: ${error.message}`),
      );
      return;
    }
    for (const reply of replies) {
      if (Object.keys(reply).length === 0) {
        if (this.ws?.readyState === globalThis.WebSocket.OPEN)
          this.ws.send("{}");
        continue;
      }
      if (reply.id) {
        const pending = this.pending.get(reply.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(reply.id);
        if (reply.error) {
          pending.reject(
            new Error(
              `Centrifugo error ${reply.error.code ?? "?"}: ${reply.error.message ?? "unknown"}`,
            ),
          );
        } else {
          pending.resolve(reply);
        }
        continue;
      }
      const push = reply.push;
      if (push?.pub) this.#recordPublication(push.channel, push.pub);
    }
  }

  #recordPublication(channel, publication) {
    const record = {
      channel,
      data: publication.data,
      offset: publication.offset,
      receivedAtMs: performance.now(),
    };
    this.publications.push(record);
    for (const waiter of this.publicationWaiters) {
      if (record.receivedAtMs < waiter.afterMs || !waiter.predicate(record))
        continue;
      clearTimeout(waiter.timer);
      this.publicationWaiters.delete(waiter);
      waiter.resolve(record);
    }
  }

  #onTransportError() {
    if (this.closed) return;
    this.#rejectAll(new Error("Centrifugo websocket transport error"));
  }

  #onClose() {
    this.closed = true;
    this.#rejectAll(new Error("Centrifugo websocket closed"));
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.publicationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.publicationWaiters.clear();
  }
}

/** Backward-compatible one-window hold used by `loadtest:room`. */
export async function centrifugoHold(wsUrl, token, channel, holdMs) {
  const connection = new CentrifugoRoomConnection({
    url: wsUrl,
    token,
    channel,
    timeoutMs: Math.min(Math.max(holdMs, 1_000), 15_000),
  });
  try {
    const { connectMs } = await connection.connect();
    await sleep(holdMs);
    return { ok: true, connectMs };
  } catch (error) {
    return { ok: false, connectMs: 0, error: error.message };
  } finally {
    await connection.close().catch(() => {});
  }
}
