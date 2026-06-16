#!/usr/bin/env node
// DS Platform — dev-stand SMS-Aero adapter (the REAL outbound SMS route).
//
// This is the production-delivery counterpart to `sms-sink`. The sink is the
// free dev catch-all (the SMS analogue of Mailpit) that Zitadel's generic HTTP
// SMS provider POSTs to by default; THIS service is the opt-in REAL route that
// forwards each outbound SMS to SMS-Aero (smsaero.ru Gate API v2, the production
// sender recorded in the specs). Which one Zitadel points at is decided by
// `idp/provision.sh` from `SMS_DELIVERY_MODE` (sink|real, default sink): the
// adapter is harmless when unused — Zitadel only ever POSTs here when the
// operator selects `real` and re-runs the provisioner. Real SMS COSTS MONEY, so
// the flag is OFF by default and the real route is exercised by one supervised
// paid test only (#176; see idp/bootstrap.md §3.bis).
//
// Contract mirror: this faithfully replicates the production PHP reference impl
// `../bbm/dev-stand/server/lib/smsaero-client.php` —
//   POST https://gate.smsaero.ru/v2/sms/send
//   HTTP Basic auth: SMSAERO_EMAIL:SMSAERO_API_KEY
//   form-urlencoded body: number (leading `+` stripped), text, sign
//   success = HTTP 200 AND JSON { success: true }; anything else = failure.
//
// Fail-closed: if the recipient phone can't be extracted from Zitadel's webhook,
// the creds are missing, or SMS-Aero errors, we log a structured line (mirroring
// the PHP `error_log(json_encode(...))` events `smsaero.http_fail` /
// `smsaero.api_error`) and return a non-2xx to Zitadel WITHOUT crashing — never
// silently sending to a wrong number. The OTP code and the creds are NEVER
// logged (no code oracle, no secret leak — AGENTS.md §6).
//
// Dependency-free on purpose: runs on the stock `node:*-alpine` image with the
// script bind-mounted, so there is no bespoke Dockerfile/build to maintain
// (same "plain upstream image" shape as `sms-sink` / `mailpit` in
// compose.core.yml). Uses the built-in global `fetch` (Node 18+).
//
// Routes:
//   POST  /            — Zitadel's HTTP SMS webhook target; forwards to SMS-Aero.
//   GET   /healthz      — liveness for the compose healthcheck.
//
// Env:
//   SMS_AERO_ADAPTER_PORT  listen port (default 8091; sms-sink owns 8090).
//   SMSAERO_EMAIL          SMS-Aero account email   (Basic-auth user). REQUIRED.
//   SMSAERO_API_KEY        SMS-Aero API key          (Basic-auth pass). REQUIRED.
//   SMSAERO_SIGN           sender signature (default "SMS Aero" — the unmoderated
//                          default available to new RU accounts).
// The creds come ONLY from env (they live in Beget `~/.env` in production and,
// on the dev-stand, in the gitignored `.env.local`) — NEVER hardcoded, NEVER
// committed.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.SMS_AERO_ADAPTER_PORT ?? 8091);
const SMSAERO_ENDPOINT = "https://gate.smsaero.ru/v2/sms/send";

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

// Structured log line — mirrors the PHP `error_log(json_encode([...]))` events.
// NEVER include the OTP code, the message text, or the creds: a structured log
// must not become a code oracle or leak a secret (AGENTS.md §6).
const logEvent = (event, fields = {}) => {
  console.error(JSON.stringify({ event, ...fields }));
};

// Pull the recipient phone out of Zitadel's HTTP SMS webhook JSON. Zitadel v4.15
// posts a NESTED shape: the recipient lives under `contextInfo.recipientPhoneNumber`
// (#225). We check, in order: the nested contextInfo field; the legacy flat
// aliases seen across versions/configs (back-compat); then the `args` block
// (`verifiedPhone`, then `lastPhone`). We do NOT scan the whole body for a number
// — a fuzzy match could send to the wrong number. If no known field carries a
// non-empty string, we fail closed (return null) rather than guess.
export const extractPhone = (msg) => {
  if (!msg || typeof msg !== "object") return null;
  const candidates = [
    msg.contextInfo?.recipientPhoneNumber,
    msg.recipientPhoneNumber,
    msg.recipient,
    msg.phoneNumber,
    msg.phone,
    msg.to,
    msg.args?.verifiedPhone,
    msg.args?.lastPhone,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
};

// Pull the rendered message text. Zitadel v4.15 posts it under
// `templateData.text` (#225); we also accept the legacy flat aliases. An empty
// text is allowed to fall through to SMS-Aero (it will reject), but a missing
// recipient is fatal above.
export const extractText = (msg) => {
  if (!msg || typeof msg !== "object") return "";
  const candidates = [msg.templateData?.text, msg.text, msg.message, msg.body];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return "";
};

// Forward one SMS to SMS-Aero. Returns true only on HTTP 200 AND { success:true }
// — identical success criteria to the PHP reference. All failure modes log a
// structured event and return false; none throw.
const sendViaSmsAero = async (phone, text) => {
  const email = process.env.SMSAERO_EMAIL;
  const apiKey = process.env.SMSAERO_API_KEY;
  const sign = process.env.SMSAERO_SIGN || "SMS Aero";

  if (!email || !apiKey) {
    // Fail closed: never attempt an unauthenticated send, never log the values.
    logEvent("smsaero.config_missing", {
      hasEmail: Boolean(email),
      hasApiKey: Boolean(apiKey),
    });
    return false;
  }

  const form = new URLSearchParams({
    number: phone.replace(/^\+/, ""), // SMS-Aero wants the bare number, no `+`.
    text,
    sign,
  });
  const auth = Buffer.from(`${email}:${apiKey}`).toString("base64");

  // Bound the upstream call so a hung gateway can't wedge a Zitadel worker.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  let resp;
  let raw;
  try {
    resp = await fetch(SMSAERO_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${auth}`,
      },
      body: form.toString(),
      signal: ac.signal,
    });
    raw = await resp.text();
  } catch (err) {
    // Network error / timeout — mirrors the PHP `$raw === false` branch. Log the
    // error name only, never the request body (it carries the OTP).
    logEvent("smsaero.http_fail", {
      httpCode: 0,
      err: String(err?.name ?? err),
    });
    return false;
  } finally {
    clearTimeout(timer);
  }

  if (resp.status !== 200) {
    logEvent("smsaero.http_fail", { httpCode: resp.status });
    return false;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // Non-JSON 200 — treat as an API error, keep a short non-secret snippet.
    logEvent("smsaero.api_error", { message: null, raw: raw.slice(0, 200) });
    return false;
  }
  if (!data || typeof data !== "object" || !data.success) {
    // SMS-Aero signals a logical failure via { success:false, message:"..." };
    // the message is provider diagnostics (e.g. "balance is too low"), not the
    // OTP, so it is safe — and useful — to surface.
    logEvent("smsaero.api_error", {
      message: typeof data?.message === "string" ? data.message : null,
    });
    return false;
  }
  return true;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    // Liveness only — does NOT prove SMS-Aero creds are valid (that would cost a
    // real SMS). Mirrors sms-sink's cheap healthz.
    return json(res, 200, { ok: true });
  }

  // Zitadel posts the outbound SMS here. Accept any POST path so a provider
  // endpoint configured as `http://sms-aero-adapter:8091/` or with a sub-path
  // both land (same tolerance as sms-sink).
  if (req.method === "POST") {
    const body = await readBody(req);
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON body: parsed stays null -> phone extraction fails closed below.
    }

    const phone = extractPhone(parsed);
    if (!phone) {
      // Fail closed: we will NOT scan/guess a number. 422 so Zitadel records the
      // delivery as failed rather than believing it sent.
      logEvent("smsaero.no_recipient");
      return json(res, 422, {
        ok: false,
        error: "no recipient phone in webhook",
      });
    }

    const text = extractText(parsed);
    const ok = await sendViaSmsAero(phone, text);
    if (!ok) {
      // sendViaSmsAero already logged the specific structured failure event.
      return json(res, 502, { ok: false, error: "sms-aero send failed" });
    }
    // Echo nothing secret; Zitadel only needs a 2xx to consider the SMS sent.
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found" });
});

// Only start the HTTP listener when run directly (`node server.mjs`), NOT when
// imported by the test. The runtime image bind-mounts this file and runs it as
// the entry point, so this guard preserves production behavior while keeping the
// parse functions importable (vitest is a devDep, never present at runtime).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  server.listen(PORT, () => {
    console.log(`sms-aero-adapter listening on :${PORT}`);
  });
}
