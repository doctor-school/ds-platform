#!/usr/bin/env node
// DS Platform — low-N live webinar-room behavioral verifier (Issue #1139).
//
// This is the owner-checkable Stage-B sibling of the #873 capacity harness. It
// reuses the same provision manifest, BFF login, real registration command, room
// grant, HTTP commands, and zero-dependency Centrifugo JSON client. It is NOT a
// load generator and never defaults to any host.

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  apiOrigin,
  intEnv,
  invokedDirectly,
  isProdTarget,
  reqEnv,
  timedFetch,
} from "./lib.mjs";
import {
  CentrifugoRoomConnection,
  ensureRoomRegistration,
  fetchRoomGrant,
  loadManifestCredentials,
  loginCookie,
  postRoomChat,
  postRoomHeartbeat,
} from "./room-seams.mjs";

export { parseCentrifugoReplyData } from "./room-seams.mjs";

const PRESENCE_TYPE = "presence-count";

export class BehaviorSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "BehaviorSetupError";
  }
}

/**
 * #1139 is a dev-stand proof, not a production load tool. Allow only explicit
 * loopback API origins so a trailing-dot domain or IP-literal remote endpoint
 * cannot bypass a denylist.
 */
export function assertDevStandOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new BehaviorSetupError(
      `room behavioral verification requires a loopback dev-stand origin; got ${origin}`,
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (
    !loopback.has(hostname) ||
    !["http:", "https:"].includes(parsed.protocol)
  ) {
    throw new BehaviorSetupError(
      `room behavioral verification requires a loopback dev-stand origin; got ${parsed.origin}`,
    );
  }
}

function normalizedUrlHost(parsed) {
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  return parsed.port ? `${hostname}:${parsed.port}` : hostname;
}

/**
 * Derive the verifier's single allowed websocket endpoint from the operator's
 * authoritative dev-stand Centrifugo HTTP(S) origin. The expected value itself
 * must be an origin, never a credential-bearing URL or an endpoint-shaped path.
 */
export function deriveExpectedCentrifugoWebSocketUrl(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new BehaviorSetupError(
      "LOADTEST_CENTRIFUGO_ORIGIN must be an explicit HTTP(S) origin with no credentials, path, query, or fragment",
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new BehaviorSetupError(
      "LOADTEST_CENTRIFUGO_ORIGIN must be an explicit HTTP(S) origin with no credentials, path, query, or fragment",
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (isProdTarget(hostname)) {
    throw new BehaviorSetupError(
      "LOADTEST_CENTRIFUGO_ORIGIN must not target known production doctor.school hosts",
    );
  }
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${normalizedUrlHost(parsed)}/connection/websocket`;
}

/**
 * Fail closed unless a server-returned grant points at the one endpoint derived
 * from LOADTEST_CENTRIFUGO_ORIGIN. Return the expected canonical URL so callers
 * never pass the server-returned string into the websocket constructor.
 */
export function assertCentrifugoGrantTarget(
  grantUrl,
  expectedWebSocketUrl,
  label,
) {
  let parsed;
  try {
    parsed = new URL(grantUrl);
  } catch {
    throw new BehaviorSetupError(
      `${label} Centrifugo URL does not match LOADTEST_CENTRIFUGO_ORIGIN`,
    );
  }
  const validShape =
    ["ws:", "wss:"].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    parsed.pathname === "/connection/websocket" &&
    !parsed.search &&
    !parsed.hash;
  const normalized = `${parsed.protocol}//${normalizedUrlHost(parsed)}${parsed.pathname}`;
  if (!validShape || normalized !== expectedWebSocketUrl) {
    throw new BehaviorSetupError(
      `${label} Centrifugo URL does not match LOADTEST_CENTRIFUGO_ORIGIN`,
    );
  }
  return expectedWebSocketUrl;
}

/** Select the first two distinct #873 provision-manifest doctors. */
export function selectBehaviorCredentials(credentials) {
  if (credentials.length < 2) {
    throw new BehaviorSetupError(
      "behavioral verification needs at least two synthetic doctors in LOADTEST_MANIFEST; run `pnpm loadtest:provision` with LOADTEST_USERS>=2",
    );
  }
  const [observer, participant] = credentials;
  if (observer.email === participant.email) {
    throw new BehaviorSetupError(
      "behavioral verification needs two distinct synthetic doctors in LOADTEST_MANIFEST",
    );
  }
  return [observer, participant];
}

/**
 * A participant whose prior beat is still fresh cannot produce a +1 join. There
 * is deliberately no per-doctor presence probe (EARS-8), so the accepted beat's
 * unchanged aggregate is the first safe signal; fail immediately with the exact
 * age-out wait instead of misreporting a transport regression.
 */
export function assertFreshJoinPrecondition(
  baselineCount,
  joinAckCount,
  heartbeatIntervalSeconds,
) {
  if (joinAckCount === baselineCount + 1) return;
  const freshnessSeconds = heartbeatIntervalSeconds * 2;
  throw new BehaviorSetupError(
    `participant did not add exactly one doctor (${baselineCount}→${joinAckCount}); ` +
      `it is likely already inside the 2×N freshness window (${freshnessSeconds}s) ` +
      "from a recent run. Wait that full window after this accepted beat or provision fresh synthetic accounts, then rerun against a quiescent room.",
  );
}

/** Fail pointedly if a refreshed connection credential drifted mid-story. */
export function assertReconnectGrant(
  original,
  refreshed,
  expectedWebSocketUrl,
) {
  if (
    !refreshed?.chat?.url ||
    !refreshed?.chat?.token ||
    !refreshed?.chat?.channel
  ) {
    throw new BehaviorSetupError(
      "participant reconnect grant has no complete Centrifugo credential",
    );
  }
  assertCentrifugoGrantTarget(
    refreshed.chat.url,
    expectedWebSocketUrl,
    "participant reconnect grant",
  );
  if (
    refreshed.eventId !== original.eventId ||
    refreshed.chat.channel !== original.chat.channel ||
    refreshed.heartbeatIntervalSeconds !== original.heartbeatIntervalSeconds
  ) {
    throw new BehaviorSetupError(
      "participant reconnect grant did not preserve the same room, channel, and cadence",
    );
  }
}

/** Evaluate the captured real-stand trace against the owner-approved contract. */
export function evaluateBehaviorTrace(trace, { publicationGraceMs }) {
  const freshnessWindowMs = trace.heartbeatIntervalSeconds * 2 * 1_000;
  const joinCountIsExact =
    trace.joinAckCount === trace.baselineCount + 1 &&
    trace.joinedCount === trace.joinAckCount;
  const joinPayloadIsCausal =
    Number.isFinite(trace.joinPayloadAfterBeatMs) &&
    trace.joinPayloadAfterBeatMs >= 0;
  const joinObservedOnTime =
    Number.isFinite(trace.joinObserverElapsedMs) &&
    trace.joinObserverElapsedMs >= 0 &&
    trace.joinObserverElapsedMs <= publicationGraceMs;

  const leaveCountIsExact = trace.leftCount === trace.baselineCount;
  const leavePayloadOnTime =
    Number.isFinite(trace.leavePayloadAfterBeatMs) &&
    trace.leavePayloadAfterBeatMs >= freshnessWindowMs &&
    trace.leavePayloadAfterBeatMs <= freshnessWindowMs + publicationGraceMs &&
    Number.isFinite(trace.leavePayloadAfterExpiryMs) &&
    trace.leavePayloadAfterExpiryMs >= 0 &&
    trace.leavePayloadAfterExpiryMs <= publicationGraceMs;
  const leaveObservedOnTime =
    Number.isFinite(trace.leaveObserverElapsedMs) &&
    trace.leaveObserverElapsedMs >= 0 &&
    trace.leaveObserverElapsedMs <= freshnessWindowMs + publicationGraceMs;

  const recoveredIds = new Set(trace.recoveredChatIds ?? []);
  const chatContinuous =
    trace.chatBeforeObservedLive === true &&
    recoveredIds.has(trace.chatBeforeId) &&
    recoveredIds.has(trace.chatDuringDisconnectId);

  const failedBeatDiagnosed =
    trace.failedBeat?.status === 401 && Boolean(trace.failedBeat?.diagnostic);

  const checks = [
    {
      id: "presence-join",
      label: "presence join",
      passed: joinCountIsExact && joinPayloadIsCausal && joinObservedOnTime,
      detail:
        `${trace.baselineCount}→${trace.joinedCount}; observer reflected in ` +
        `${displayMs(trace.joinObserverElapsedMs)} from heartbeat request start ` +
        `(≤${publicationGraceMs}ms); server payload stamped ` +
        `${displayMs(trace.joinPayloadAfterBeatMs)} after the accepted beat (must be ≥0ms)`,
    },
    {
      id: "presence-age-out",
      label: "presence age-out",
      passed: leaveCountIsExact && leavePayloadOnTime && leaveObservedOnTime,
      detail:
        `${trace.joinedCount}→${trace.leftCount}; observer reflected in ` +
        `${displayMs(trace.leaveObserverElapsedMs)} from joining heartbeat request start ` +
        `(≤${freshnessWindowMs + publicationGraceMs}ms); server payload stamped ` +
        `${displayMs(trace.leavePayloadAfterBeatMs)} after the last accepted beat, ` +
        `${displayMs(trace.leavePayloadAfterExpiryMs)} after 2×${trace.heartbeatIntervalSeconds}s expiry ` +
        `(0..${publicationGraceMs}ms)`,
    },
    {
      id: "chat-reconnect",
      label: "chat reconnect",
      passed: chatContinuous,
      detail: chatContinuous
        ? "live pre-drop message and disconnected-window message both recovered from bounded room history"
        : "missing live pre-drop delivery or one of the two message ids after reconnect/history",
    },
    {
      id: "failed-heartbeat",
      label: "failed heartbeat diagnostic",
      passed: failedBeatDiagnosed,
      detail: failedBeatDiagnosed
        ? `${trace.failedBeat.diagnostic} (${displayMs(trace.failedBeat.ms)})`
        : `expected unauthenticated heartbeat refusal HTTP 401; got ${trace.failedBeat?.diagnostic ?? "no diagnostic"}`,
    },
  ];

  return {
    runStartedAt: trace.runStartedAt,
    eventId: trace.eventId,
    origin: trace.origin,
    centrifugoWebSocketUrl: trace.centrifugoWebSocketUrl,
    heartbeatIntervalSeconds: trace.heartbeatIntervalSeconds,
    freshnessWindowMs,
    publicationGraceMs,
    checks,
    passed: checks.every((check) => check.passed),
  };
}

/** Owner-readable, copy/pasteable Stage-B artifact. */
export function formatBehaviorReport(result) {
  const lines = [
    "Webinar-room behavioral verification (#1139)",
    `run UTC: ${result.runStartedAt}`,
    `target: ${result.origin ?? "(injected test driver)"}`,
    `centrifugo target: ${result.centrifugoWebSocketUrl ?? "(injected test driver)"}`,
    `event: ${result.eventId}`,
    `contract: observer receives fresh +1 ≤~1s from request start; stopped beats age out at 2×N, then observer receives −1 by 2×N+~1s; server stamp is never before expiry (N=${result.heartbeatIntervalSeconds}s)`,
    "presence note: WS close is not attendance leave; a visible foreground tab that keeps beating remains present; concurrent tabs coalesce",
    "─".repeat(72),
  ];
  for (const check of result.checks) {
    lines.push(
      `${check.passed ? "PASS" : "FAIL"} ${check.label} — ${check.detail}`,
    );
  }
  const passed = result.checks.filter((check) => check.passed).length;
  lines.push("─".repeat(72));
  lines.push(
    `VERDICT: ${result.passed ? "PASS" : "FAIL"} (${passed}/${result.checks.length})`,
  );
  return lines.join("\n");
}

function displayMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : "not observed";
}

function parseJsonResponse(response, label) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new BehaviorSetupError(
      `${label} returned HTTP ${response.status} with a non-JSON body`,
    );
  }
}

function responseMessage(response) {
  let message = "";
  try {
    const body = JSON.parse(response.body);
    const raw = Array.isArray(body?.message)
      ? body.message.join("; ")
      : body?.message;
    if (typeof raw === "string") message = raw.replace(/\s+/g, " ").trim();
  } catch {
    // Status alone is still a useful diagnostic; never dump an arbitrary body.
  }
  return `HTTP ${response.status}${message ? ` ${message}` : ""}`;
}

async function prepareActor(
  origin,
  eventId,
  credential,
  label,
  expectedWebSocketUrl,
) {
  const cookie = await loginCookie(
    origin,
    credential.email,
    credential.password,
  );
  if (!cookie) {
    throw new BehaviorSetupError(
      `${label} could not log in through /v1/auth/login; refresh LOADTEST_MANIFEST with \`pnpm loadtest:provision\``,
    );
  }

  const registration = await ensureRoomRegistration(origin, eventId, cookie);
  if (!registration.ok) {
    throw new BehaviorSetupError(
      `${label} registration failed (${responseMessage(registration)}). ` +
        "The designated event must exist and be published or live; the verifier never writes the roster directly.",
    );
  }

  const grantResponse = await fetchRoomGrant(origin, eventId, cookie);
  if (!grantResponse.ok) {
    throw new BehaviorSetupError(
      `${label} room grant failed (${responseMessage(grantResponse)}). ` +
        "The designated event must be live and Centrifugo must be configured on the dev stand.",
    );
  }
  const grant = parseJsonResponse(grantResponse, `${label} room grant`);
  if (!grant?.chat?.url || !grant?.chat?.token || !grant?.chat?.channel) {
    throw new BehaviorSetupError(
      `${label} room grant has no complete chat credential; configure Centrifugo on the dev stand`,
    );
  }
  assertCentrifugoGrantTarget(
    grant.chat.url,
    expectedWebSocketUrl,
    `${label} initial grant`,
  );
  if (
    !Number.isFinite(grant.heartbeatIntervalSeconds) ||
    grant.heartbeatIntervalSeconds <= 0
  ) {
    throw new BehaviorSetupError(
      `${label} room grant has invalid heartbeatIntervalSeconds=${JSON.stringify(grant.heartbeatIntervalSeconds)}`,
    );
  }
  return { cookie, grant };
}

async function acceptedHeartbeat(origin, eventId, cookie, label) {
  const response = await postRoomHeartbeat(origin, eventId, cookie);
  if (!response.ok) {
    throw new BehaviorSetupError(
      `${label} heartbeat was not accepted (${responseMessage(response)})`,
    );
  }
  const ack = parseJsonResponse(response, `${label} heartbeat`);
  if (
    !Number.isInteger(ack?.presenceCount) ||
    typeof ack?.beatAt !== "string" ||
    !Number.isFinite(Date.parse(ack.beatAt))
  ) {
    throw new BehaviorSetupError(
      `${label} heartbeat ack violates its schema contract`,
    );
  }
  return ack;
}

async function acceptedChat(origin, eventId, cookie, text, label) {
  const response = await postRoomChat(origin, eventId, cookie, text);
  if (!response.ok) {
    throw new BehaviorSetupError(
      `${label} chat post failed (${responseMessage(response)})`,
    );
  }
  const ack = parseJsonResponse(response, `${label} chat post`);
  if (!ack?.message?.id) {
    throw new BehaviorSetupError(
      `${label} chat ack has no server-minted message id`,
    );
  }
  return ack.message;
}

function startObserverHeartbeat(origin, eventId, cookie, intervalSeconds) {
  let busy = false;
  let failure = null;
  const timer = setInterval(() => {
    if (busy || failure) return;
    busy = true;
    void acceptedHeartbeat(origin, eventId, cookie, "observer keepalive")
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        busy = false;
      });
  }, intervalSeconds * 1_000);
  return {
    stop: () => clearInterval(timer),
    failure: () => failure,
  };
}

function connectionFor(actor, expectedWebSocketUrl, timeoutMs) {
  return new CentrifugoRoomConnection({
    url: expectedWebSocketUrl,
    token: actor.grant.chat.token,
    channel: actor.grant.chat.channel,
    timeoutMs,
  });
}

function publicationServerMs(publication) {
  const at = publication?.data?.at;
  return typeof at === "string" ? Date.parse(at) : Number.NaN;
}

/** Drive the complete behavioral story against a real designated dev-stand room. */
export async function runRoomBehaviorVerification({
  origin,
  centrifugoOrigin,
  eventId,
  credentials,
  publicationGraceMs,
  commandTimeoutMs,
}) {
  const runStartedAt = new Date().toISOString();
  assertDevStandOrigin(origin);
  const expectedWebSocketUrl =
    deriveExpectedCentrifugoWebSocketUrl(centrifugoOrigin);
  const [observerCredential, participantCredential] =
    selectBehaviorCredentials(credentials);
  const observer = await prepareActor(
    origin,
    eventId,
    observerCredential,
    "observer",
    expectedWebSocketUrl,
  );
  const participant = await prepareActor(
    origin,
    eventId,
    participantCredential,
    "participant",
    expectedWebSocketUrl,
  );

  if (
    observer.grant.eventId !== participant.grant.eventId ||
    observer.grant.chat.channel !== participant.grant.chat.channel ||
    observer.grant.heartbeatIntervalSeconds !==
      participant.grant.heartbeatIntervalSeconds
  ) {
    throw new BehaviorSetupError(
      "the two synthetic doctors did not receive the same room/channel/cadence grant",
    );
  }

  const intervalSeconds = observer.grant.heartbeatIntervalSeconds;
  const observerConnection = connectionFor(
    observer,
    expectedWebSocketUrl,
    commandTimeoutMs,
  );
  let participantConnection = connectionFor(
    participant,
    expectedWebSocketUrl,
    commandTimeoutMs,
  );
  let keepalive;
  try {
    await observerConnection.connect();
    await participantConnection.connect();

    const baselineAck = await acceptedHeartbeat(
      origin,
      eventId,
      observer.cookie,
      "observer baseline",
    );
    keepalive = startObserverHeartbeat(
      origin,
      eventId,
      observer.cookie,
      intervalSeconds,
    );

    const joinRequestStartedAtMs = performance.now();
    const joinAck = await acceptedHeartbeat(
      origin,
      eventId,
      participant.cookie,
      "participant join",
    );
    assertFreshJoinPrecondition(
      baselineAck.presenceCount,
      joinAck.presenceCount,
      intervalSeconds,
    );
    const joinPublication = await observerConnection
      .waitForPublication(
        ({ data }) =>
          data?.type === PRESENCE_TYPE && data.count === joinAck.presenceCount,
        {
          timeoutMs: publicationGraceMs + commandTimeoutMs,
          afterMs: joinRequestStartedAtMs,
        },
      )
      .catch(() => null);
    const joinObserverElapsedMs = joinPublication
      ? joinPublication.receivedAtMs - joinRequestStartedAtMs
      : Number.POSITIVE_INFINITY;
    const joinPayloadAfterBeatMs = joinPublication
      ? publicationServerMs(joinPublication) - Date.parse(joinAck.beatAt)
      : Number.POSITIVE_INFINITY;
    const confirmedJoinReceiveOrder = joinPublication?.receiveOrder ?? 0;

    const marker = `behavioral-${Date.now()}-${randomUUID()}`;
    const beforeChat = await acceptedChat(
      origin,
      eventId,
      observer.cookie,
      `${marker}-before-drop`,
      "pre-disconnect",
    );
    const beforeObserved = await participantConnection
      .waitForPublication(({ data }) => data?.id === beforeChat.id, {
        timeoutMs: commandTimeoutMs,
      })
      .then(() => true)
      .catch(() => false);

    await participantConnection.close(4000, "forced behavioral reconnect");
    const disconnectedChat = await acceptedChat(
      origin,
      eventId,
      observer.cookie,
      `${marker}-during-drop`,
      "during-disconnect",
    );

    const refreshedGrant = await fetchRoomGrant(
      origin,
      eventId,
      participant.cookie,
    );
    if (!refreshedGrant.ok) {
      throw new BehaviorSetupError(
        `participant reconnect grant failed (${responseMessage(refreshedGrant)})`,
      );
    }
    const reconnectedGrant = parseJsonResponse(
      refreshedGrant,
      "participant reconnect grant",
    );
    assertReconnectGrant(
      participant.grant,
      reconnectedGrant,
      expectedWebSocketUrl,
    );
    participant.grant = reconnectedGrant;
    participantConnection = connectionFor(
      participant,
      expectedWebSocketUrl,
      commandTimeoutMs,
    );
    await participantConnection.connect();
    const history = await participantConnection.history(100);
    const recoveredChatIds = history
      .map((publication) => publication.data?.id)
      .filter(Boolean);

    const freshnessWindowMs = intervalSeconds * 2 * 1_000;
    const leavePublication = await observerConnection
      .waitForPublication(
        ({ data }) =>
          data?.type === PRESENCE_TYPE &&
          data.count === baselineAck.presenceCount,
        {
          timeoutMs: freshnessWindowMs + publicationGraceMs + commandTimeoutMs,
          afterMs: joinRequestStartedAtMs,
          afterReceiveOrder: confirmedJoinReceiveOrder,
        },
      )
      .catch(() => null);
    const leaveObserverElapsedMs = leavePublication
      ? leavePublication.receivedAtMs - joinRequestStartedAtMs
      : Number.POSITIVE_INFINITY;
    const leavePayloadAfterBeatMs = leavePublication
      ? publicationServerMs(leavePublication) - Date.parse(joinAck.beatAt)
      : Number.POSITIVE_INFINITY;
    const leavePayloadAfterExpiryMs =
      leavePayloadAfterBeatMs - freshnessWindowMs;

    const failedStartedAt = performance.now();
    const failedResponse = await timedFetch(
      `${origin}/v1/events/${encodeURIComponent(eventId)}/heartbeat`,
      {
        method: "POST",
        headers: { accept: "application/json" },
      },
    );
    const failedBeat = {
      status: failedResponse.status,
      ms: performance.now() - failedStartedAt,
      diagnostic: responseMessage(failedResponse),
    };

    const observerFailure = keepalive.failure();
    if (observerFailure) throw observerFailure;

    const trace = {
      runStartedAt,
      origin,
      centrifugoWebSocketUrl: expectedWebSocketUrl,
      eventId,
      heartbeatIntervalSeconds: intervalSeconds,
      baselineCount: baselineAck.presenceCount,
      joinAckCount: joinAck.presenceCount,
      joinedCount: joinPublication?.data?.count ?? Number.NaN,
      joinObserverElapsedMs,
      joinPayloadAfterBeatMs,
      leftCount: leavePublication?.data?.count ?? Number.NaN,
      leaveObserverElapsedMs,
      leavePayloadAfterBeatMs,
      leavePayloadAfterExpiryMs,
      chatBeforeObservedLive: beforeObserved,
      chatBeforeId: beforeChat.id,
      chatDuringDisconnectId: disconnectedChat.id,
      recoveredChatIds,
      failedBeat,
    };
    return evaluateBehaviorTrace(trace, { publicationGraceMs });
  } finally {
    keepalive?.stop();
    await observerConnection.close().catch(() => {});
    await participantConnection.close().catch(() => {});
  }
}

async function main() {
  const origin = apiOrigin();
  const centrifugoOrigin = reqEnv("LOADTEST_CENTRIFUGO_ORIGIN");
  const eventId = reqEnv("LOADTEST_EVENT_ID");
  const result = await runRoomBehaviorVerification({
    origin,
    centrifugoOrigin,
    eventId,
    credentials: loadManifestCredentials(),
    publicationGraceMs: intEnv("LOADTEST_BEHAVIOR_PUBLISH_GRACE_MS", 1_000),
    commandTimeoutMs: intEnv("LOADTEST_BEHAVIOR_COMMAND_TIMEOUT_MS", 10_000),
  });
  console.log(formatBehaviorReport(result));
  process.exitCode = result.passed ? 0 : 1;
}

if (invokedDirectly(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof BehaviorSetupError) {
      console.error("Webinar-room behavioral verification (#1139)");
      console.error(`SETUP ERROR: ${error.message}`);
      console.error("VERDICT: SETUP ERROR (no behavioral claim made)");
      process.exitCode = 3;
      return;
    }
    console.error(`room-behavior: ${error.stack || error.message}`);
    process.exitCode = 3;
  });
}
