#!/usr/bin/env node
// DS Platform — dev-stand SMS sink (the SMS analogue of Mailpit).
//
// Zitadel has no "send to a real phone" on the dev-stand, exactly as it has no
// real SMTP — the dev-stand SMTP points at Mailpit, a local catch-all. This is
// the same idea for SMS: Zitadel's generic HTTP SMS provider (admin API
// `POST /admin/v1/sms/http`) is configured to POST every outbound SMS to THIS
// service instead of a real gateway (SMS-Aero is the PRODUCTION sender — recorded
// in the specs — never reached from the dev-stand). The catcher stores each
// webhook body verbatim and exposes a tiny REST API so the live OTP e2e can read
// the delivered code back by recipient phone, mirroring how the email e2e reads
// codes from Mailpit's `/api/v1/...` API. Production code is untouched: no
// `returnCode` leak, no test backdoor (AGENTS.md §6).
//
// Dependency-free on purpose: runs on the stock `node:*-alpine` image with the
// script bind-mounted, so there is no bespoke Dockerfile/build to maintain
// (mirrors how `mailpit` is a plain upstream image in compose.core.yml).
//
// Routes:
//   POST  /            — Zitadel's HTTP SMS webhook target; stores the raw JSON.
//   GET   /api/messages?to=<phone>&after=<iso>&event=<substr>
//                      — newest-first messages whose stored body contains <phone>
//                        (raw substring, provider-field-name-agnostic) delivered
//                        at/after <after> (ISO), optionally restricted to bodies
//                        whose contextInfo.eventType contains <event> (e.g.
//                        `session.otp.sms.challenged` for a login OTP vs
//                        `user.human.phone.code.added` for a phone-verify code —
//                        the SMS analogue of Mailpit's subject disambiguation).
//                        All query params optional.
//   DELETE /api/messages — clear the store (test isolation; optional).
//   GET   /healthz      — liveness for the compose healthcheck.
//
// The store is in-memory and capped (dev catch-all; restart = empty inbox, same
// operational contract as Mailpit's ephemeral store on the dev-stand).

import { createServer } from "node:http";

const PORT = Number(process.env.SMS_SINK_PORT ?? 8090);
const MAX_MESSAGES = Number(process.env.SMS_SINK_MAX ?? 500);

/** @type {Array<{ id: number, receivedAt: string, body: string, json: unknown }>} */
const messages = [];
let nextId = 1;

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });

const json = (res, code, payload) => {
  const data = JSON.stringify(payload);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json(res, 200, { ok: true, count: messages.length });
  }

  // Zitadel posts the outbound SMS here. Accept ANY non-API POST path so a
  // provider endpoint configured as `http://sms-sink:8090/` or with a sub-path
  // both land — the store is keyed by body content, not route.
  if (req.method === "POST" && !url.pathname.startsWith("/api/")) {
    const body = await readBody(req);
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON body: keep `parsed` null and store the raw text only.
    }
    messages.push({
      id: nextId++,
      receivedAt: new Date().toISOString(),
      body,
      json: parsed,
    });
    // Cap the store so a long-lived dev-stand never grows unbounded.
    if (messages.length > MAX_MESSAGES)
      messages.splice(0, messages.length - MAX_MESSAGES);
    // Zitadel only needs a 2xx to consider the SMS "sent"; echo nothing secret.
    return json(res, 200, { ok: true, id: nextId - 1 });
  }

  if (req.method === "GET" && url.pathname === "/api/messages") {
    const to = url.searchParams.get("to");
    const after = url.searchParams.get("after");
    const event = url.searchParams.get("event");
    const afterMs = after ? Date.parse(after) : NaN;
    const eventTypeOf = (m) => m.json?.contextInfo?.eventType ?? "";
    const hits = messages
      .filter((m) => (to ? m.body.includes(to) : true))
      .filter((m) =>
        Number.isNaN(afterMs) ? true : Date.parse(m.receivedAt) >= afterMs,
      )
      .filter((m) => (event ? eventTypeOf(m).includes(event) : true))
      .sort((a, b) => b.id - a.id); // newest first
    return json(res, 200, { messages: hits });
  }

  if (req.method === "DELETE" && url.pathname === "/api/messages") {
    messages.length = 0;
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
   
  console.log(`sms-sink listening on :${PORT}`);
});
