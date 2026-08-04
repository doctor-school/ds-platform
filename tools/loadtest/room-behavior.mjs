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
export function assertReconnectGrant(original, refreshed) {
  if (
    !refreshed?.chat?.url ||
    !refreshed?.chat?.token ||
    !refreshed?.chat?.channel
  ) {
    throw new BehaviorSetupError(
      "participant reconnect grant has no complete Centrifugo credential",
    );
  }
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
  const joinOnTime =
    Number.isFinite(trace.joinElapsedMs) &&
    trace.joinElapsedMs >= 0 &&
    trace.joinElapsedMs <= publicationGraceMs;

  const leaveCountIsExact = trace.leftCount === trace.baselineCount;
  const leaveOnTime =
    Number.isFinite(trace.leaveElapsedMs) &&
    trace.leaveElapsedMs <= freshnessWindowMs + publicationGraceMs &&
    Number.isFinite(trace.leavePublishAfterExpiryMs) &&
    trace.leavePublishAfterExpiryMs >= 0 &&
    trace.leavePublishAfterExpiryMs <= publicationGraceMs;

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
      passed: joinCountIsExact && joinOnTime,
      detail:
        `${trace.baselineCount}→${trace.joinedCount} in ${displayMs(trace.joinElapsedMs)} ` +
        `after the accepted joining beat (budget ~1s: ≤${publicationGraceMs}ms)`,
    },
    {
      id: "presence-age-out",
      label: "presence age-out",
      passed: leaveCountIsExact && leaveOnTime,
      detail:
        `${trace.joinedCount}→${trace.leftCount} in ${displayMs(trace.leaveElapsedMs)} ` +
        `after the last accepted beat; freshness=2×${trace.heartbeatIntervalSeconds}s, ` +
        `publication after expiry=${displayMs(trace.leavePublishAfterExpiryMs)} ` +
        `(≤${publicationGraceMs}ms)`,
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
    `event: ${result.eventId}`,
    `contract: fresh +1 publication ≤~1s; stopped beats age out at 2×N, then −1 publication ≤~1s (N=${result.heartbeatIntervalSeconds}s)`,
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

async function prepareActor(origin, eventId, credential, label) {
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

function connectionFor(actor, timeoutMs) {
  return new CentrifugoRoomConnection({
    url: actor.grant.chat.url,
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
  eventId,
  credentials,
  publicationGraceMs,
  commandTimeoutMs,
}) {
  const runStartedAt = new Date().toISOString();
  assertDevStandOrigin(origin);
  const [observerCredential, participantCredential] =
    selectBehaviorCredentials(credentials);
  const observer = await prepareActor(
    origin,
    eventId,
    observerCredential,
    "observer",
  );
  const participant = await prepareActor(
    origin,
    eventId,
    participantCredential,
    "participant",
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
  const observerConnection = connectionFor(observer, commandTimeoutMs);
  let participantConnection = connectionFor(participant, commandTimeoutMs);
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

    const joinAfterMs = performance.now();
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
          afterMs: joinAfterMs,
        },
      )
      .catch(() => null);
    const joinElapsedMs = joinPublication
      ? publicationServerMs(joinPublication) - Date.parse(joinAck.beatAt)
      : Number.POSITIVE_INFINITY;

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
    assertReconnectGrant(participant.grant, reconnectedGrant);
    participant.grant = reconnectedGrant;
    participantConnection = connectionFor(participant, commandTimeoutMs);
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
          afterMs: joinAfterMs,
        },
      )
      .catch(() => null);
    const leaveElapsedMs = leavePublication
      ? publicationServerMs(leavePublication) - Date.parse(joinAck.beatAt)
      : Number.POSITIVE_INFINITY;
    const leavePublishAfterExpiryMs = leaveElapsedMs - freshnessWindowMs;

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
      eventId,
      heartbeatIntervalSeconds: intervalSeconds,
      baselineCount: baselineAck.presenceCount,
      joinAckCount: joinAck.presenceCount,
      joinedCount: joinPublication?.data?.count ?? Number.NaN,
      joinElapsedMs,
      leftCount: leavePublication?.data?.count ?? Number.NaN,
      leaveElapsedMs,
      leavePublishAfterExpiryMs,
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
  const eventId = reqEnv("LOADTEST_EVENT_ID");
  const result = await runRoomBehaviorVerification({
    origin,
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
