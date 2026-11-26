import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCentrifugoGrantTarget,
  assertDevStandOrigin,
  assertFreshJoinPrecondition,
  assertReconnectGrant,
  BehaviorSetupError,
  deriveExpectedCentrifugoWebSocketUrl,
  evaluateBehaviorTrace,
  formatBehaviorReport,
  parseCentrifugoReplyData,
  runRoomBehaviorVerification,
  selectBehaviorCredentials,
} from "./room-behavior.mjs";
import {
  manifestCredentials,
  publicationPassesReceiveCursor,
  roomSessionHeaders,
} from "./room-seams.mjs";

const successfulTrace = {
  runStartedAt: "2026-08-04T12:34:56.000Z",
  eventId: "seed-live-room",
  centrifugoWebSocketUrl: "ws://truenas.local:8100/connection/websocket",
  heartbeatIntervalSeconds: 15,
  baselineCount: 1,
  joinAckCount: 2,
  joinedCount: 2,
  joinObserverElapsedMs: 470,
  joinPayloadAfterBeatMs: 420,
  leftCount: 1,
  leaveObserverElapsedMs: 30_700,
  leavePayloadAfterBeatMs: 30_640,
  leavePayloadAfterExpiryMs: 640,
  chatBeforeObservedLive: true,
  chatBeforeId: "11111111-1111-4111-8111-111111111111",
  chatDuringDisconnectId: "22222222-2222-4222-8222-222222222222",
  recoveredChatIds: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
  failedBeat: {
    status: 401,
    ms: 18,
    diagnostic: "HTTP 401 Unauthorized",
  },
};

test("#1139 verifier allows loopback dev-stand origins only", () => {
  for (const origin of [
    "http://localhost:3000",
    "http://localhost.:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ]) {
    assert.doesNotThrow(() => assertDevStandOrigin(origin));
  }
  for (const origin of [
    "https://api.doctor.school",
    "https://api.doctor.school.",
    "http://203.0.113.10:3000",
    "https://example.test",
  ]) {
    assert.throws(
      () => assertDevStandOrigin(origin),
      /loopback dev-stand origin/,
    );
  }
});

test("#1139 verifier derives one exact websocket target from the explicit Centrifugo HTTP(S) origin", () => {
  for (const [origin, expected] of [
    [
      "http://truenas.local:8100",
      "ws://truenas.local:8100/connection/websocket",
    ],
    [
      "https://truenas.local:8443/",
      "wss://truenas.local:8443/connection/websocket",
    ],
    ["http://localhost:8000", "ws://localhost:8000/connection/websocket"],
    ["http://127.0.0.1:8100", "ws://127.0.0.1:8100/connection/websocket"],
    ["http://localhost.:8000/", "ws://localhost:8000/connection/websocket"],
  ]) {
    assert.equal(deriveExpectedCentrifugoWebSocketUrl(origin, {}), expected);
  }

  // A LAN address is accepted only when the operator vouches for it, exactly
  // as every other production tripwire treats IP literals (lib.mjs isProdTarget).
  assert.equal(
    deriveExpectedCentrifugoWebSocketUrl("http://192.168.1.20:8100", {
      LOADTEST_NON_PROD_IPS: "192.168.1.20",
    }),
    "ws://192.168.1.20:8100/connection/websocket",
  );
  for (const origin of [
    "http://192.168.1.20:8100",
    "http://77.233.220.222:8100",
    "http://[2a03:6f00::1]:8100",
  ]) {
    assert.throws(
      () => deriveExpectedCentrifugoWebSocketUrl(origin, {}),
      /LOADTEST_CENTRIFUGO_ORIGIN.*production.*LOADTEST_NON_PROD_IPS/,
      origin,
    );
  }

  for (const origin of [
    "",
    "ws://truenas.local:8100",
    "http://operator:secret@truenas.local:8100",
    "http://truenas.local:8100/connection/websocket",
    "http://truenas.local:8100/?debug=1",
    "http://truenas.local:8100/#fragment",
  ]) {
    assert.throws(
      () => deriveExpectedCentrifugoWebSocketUrl(origin),
      /LOADTEST_CENTRIFUGO_ORIGIN.*HTTP\(S\) origin/,
    );
  }

  for (const origin of [
    "https://doctor.school",
    "https://api.doctor.school",
    "https://centrifugo.doctor.school.",
  ]) {
    assert.throws(
      () => deriveExpectedCentrifugoWebSocketUrl(origin, {}),
      /LOADTEST_CENTRIFUGO_ORIGIN.*possible production host.*doctor\.school/,
    );
  }
});

test("#1139 verifier rejects every grant target except the explicitly expected normalized endpoint", () => {
  const expected = deriveExpectedCentrifugoWebSocketUrl(
    "http://truenas.local:8100",
  );
  assert.equal(
    assertCentrifugoGrantTarget(
      "ws://truenas.local.:8100/connection/websocket",
      expected,
      "observer initial grant",
    ),
    expected,
  );

  assert.throws(
    () =>
      assertCentrifugoGrantTarget(
        "ws://truenas.local:8101/connection/websocket",
        expected,
        "participant initial grant",
      ),
    (error) =>
      error instanceof BehaviorSetupError &&
      /participant initial grant.*LOADTEST_CENTRIFUGO_ORIGIN/.test(
        error.message,
      ),
  );

  for (const url of [
    "wss://centrifugo.doctor.school/connection/websocket",
    "ws://203.0.113.10:8100/connection/websocket",
    "ws://truenas.local:8101/connection/websocket",
    "wss://truenas.local:8100/connection/websocket",
    "ws://truenas.local:8100/wrong-path",
    "ws://truenas.local:8100/connection/websocket/",
    "ws://truenas.local:8100/connection/websocket?token=leak",
    "ws://truenas.local:8100/connection/websocket#fragment",
    "ws://operator:secret@truenas.local:8100/connection/websocket",
  ]) {
    assert.throws(
      () =>
        assertCentrifugoGrantTarget(url, expected, "observer initial grant"),
      /observer initial grant.*LOADTEST_CENTRIFUGO_ORIGIN/,
    );
  }
});

test("reconnect grant must remain on the same complete room/channel/cadence", () => {
  const expectedWebSocketUrl = "ws://truenas.local:8100/connection/websocket";
  const original = {
    eventId: "event-1",
    heartbeatIntervalSeconds: 5,
    chat: {
      url: expectedWebSocketUrl,
      token: "old",
      channel: "room:event:1",
    },
  };
  assert.doesNotThrow(() =>
    assertReconnectGrant(
      original,
      {
        ...original,
        chat: { ...original.chat, token: "new" },
      },
      expectedWebSocketUrl,
    ),
  );
  assert.throws(
    () =>
      assertReconnectGrant(
        original,
        { ...original, chat: null },
        expectedWebSocketUrl,
      ),
    /reconnect grant/,
  );
  assert.throws(
    () =>
      assertReconnectGrant(
        original,
        {
          ...original,
          heartbeatIntervalSeconds: 10,
        },
        expectedWebSocketUrl,
      ),
    /same room, channel, and cadence/,
  );
  for (const url of [
    "wss://centrifugo.doctor.school/connection/websocket",
    "ws://203.0.113.10:8100/connection/websocket",
    "ws://truenas.local:8101/connection/websocket",
    "ws://truenas.local:8100/wrong-path",
  ]) {
    assert.throws(
      () =>
        assertReconnectGrant(
          original,
          {
            ...original,
            chat: { ...original.chat, url, token: "new" },
          },
          expectedWebSocketUrl,
        ),
      /reconnect grant.*LOADTEST_CENTRIFUGO_ORIGIN/,
    );
  }
  assert.throws(
    () =>
      assertReconnectGrant(
        original,
        {
          ...original,
          chat: {
            ...original.chat,
            url: "ws://truenas.local:8101/connection/websocket",
            token: "new",
          },
        },
        expectedWebSocketUrl,
      ),
    BehaviorSetupError,
  );
});

test("EARS-5: join is realtime and leave ages out by 2xN plus the publication budget", () => {
  const result = evaluateBehaviorTrace(successfulTrace, {
    publicationGraceMs: 1_000,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(
    result.checks.slice(0, 2).map(({ id, passed }) => ({ id, passed })),
    [
      { id: "presence-join", passed: true },
      { id: "presence-age-out", passed: true },
    ],
  );

  const late = evaluateBehaviorTrace(
    {
      ...successfulTrace,
      joinObserverElapsedMs: 1_001,
      leaveObserverElapsedMs: 31_001,
      leavePayloadAfterBeatMs: 31_001,
      leavePayloadAfterExpiryMs: 1_001,
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(late.passed, false);
  assert.deepEqual(
    late.checks.slice(0, 2).map(({ passed }) => passed),
    [false, false],
  );
});

test("EARS-5: prompt server payload stamps cannot hide a missed observer-reflection deadline", () => {
  const lateJoinReceipt = evaluateBehaviorTrace(
    {
      ...successfulTrace,
      joinObserverElapsedMs: 1_001,
      joinPayloadAfterBeatMs: 5,
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(
    lateJoinReceipt.checks.find((check) => check.id === "presence-join")
      ?.passed,
    false,
  );

  const lateLeaveReceipt = evaluateBehaviorTrace(
    {
      ...successfulTrace,
      leaveObserverElapsedMs: 31_001,
      leavePayloadAfterBeatMs: 30_005,
      leavePayloadAfterExpiryMs: 5,
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(
    lateLeaveReceipt.checks.find((check) => check.id === "presence-age-out")
      ?.passed,
    false,
  );
});

test("EARS-5: age-out ignores a delayed baseline publication before the confirmed join receive cursor", () => {
  const joinCommandStartedAt = 100;
  const delayedBaseline = {
    data: { type: "presence-count", count: 1 },
    receivedAtMs: 110,
    receiveOrder: 1,
  };
  const confirmedJoin = {
    data: { type: "presence-count", count: 2 },
    receivedAtMs: 120,
    receiveOrder: 2,
  };
  const genuineEarlyDrop = {
    data: { type: "presence-count", count: 1 },
    receivedAtMs: 121,
    receiveOrder: 3,
  };

  // The old command-start cursor admits the delayed baseline and caused the
  // live false negative. A receive-order cursor confirmed by count=2 excludes
  // it, but still admits any count=baseline published after that confirmation;
  // evaluateBehaviorTrace then correctly fails such a genuinely early drop.
  assert.equal(
    publicationPassesReceiveCursor(delayedBaseline, {
      afterMs: joinCommandStartedAt,
    }),
    true,
  );
  assert.equal(
    publicationPassesReceiveCursor(delayedBaseline, {
      afterReceiveOrder: confirmedJoin.receiveOrder,
    }),
    false,
  );
  assert.equal(
    publicationPassesReceiveCursor(genuineEarlyDrop, {
      afterReceiveOrder: confirmedJoin.receiveOrder,
    }),
    true,
  );

  const result = evaluateBehaviorTrace(
    {
      ...successfulTrace,
      leaveObserverElapsedMs: 121,
      leavePayloadAfterBeatMs: 121,
      leavePayloadAfterExpiryMs: -29_879,
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(
    result.checks.find((check) => check.id === "presence-age-out")?.passed,
    false,
  );
});

test("EARS-3: forced reconnect proves both the pre-drop and disconnected-window chat messages survive in history", () => {
  const pass = evaluateBehaviorTrace(successfulTrace, {
    publicationGraceMs: 1_000,
  });
  assert.equal(
    pass.checks.find((check) => check.id === "chat-reconnect")?.passed,
    true,
  );

  const missing = evaluateBehaviorTrace(
    {
      ...successfulTrace,
      recoveredChatIds: [successfulTrace.chatBeforeId],
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(
    missing.checks.find((check) => check.id === "chat-reconnect")?.passed,
    false,
  );
});

test("EARS-4: an intentionally refused heartbeat is printed as an owner-readable diagnostic", () => {
  const result = evaluateBehaviorTrace(successfulTrace, {
    publicationGraceMs: 1_000,
  });
  const beat = result.checks.find((check) => check.id === "failed-heartbeat");
  assert.equal(beat?.passed, true);
  assert.match(beat?.detail ?? "", /HTTP 401 Unauthorized/);

  const output = formatBehaviorReport(result);
  assert.match(output, /run UTC: 2026-08-04T12:34:56\.000Z/);
  assert.match(
    output,
    /centrifugo target: ws:\/\/truenas\.local:8100\/connection\/websocket/,
  );
  assert.match(output, /PASS presence join/);
  assert.match(output, /PASS presence age-out/);
  assert.match(output, /observer reflected/);
  assert.match(output, /server payload/);
  assert.match(output, /PASS chat reconnect/);
  assert.match(output, /PASS failed heartbeat diagnostic/);
  assert.match(output, /VERDICT: PASS \(4\/4\)/);
});

test("EARS-3/5: the zero-dependency Centrifugo decoder separates replies, publications, and pings", () => {
  const parsed = parseCentrifugoReplyData(
    [
      JSON.stringify({ id: 1, connect: { client: "c1", subs: {} } }),
      JSON.stringify({
        push: {
          channel: "room:event:1",
          pub: { data: { type: "presence-count", count: 2 } },
        },
      }),
      "{}",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);
  assert.equal(parsed[1].push.pub.data.count, 2);
  assert.deepEqual(parsed[2], {});
});

test("EARS-3/4/5: behavioral verification fails loudly unless two distinct provision-manifest doctors exist", () => {
  assert.throws(
    () =>
      selectBehaviorCredentials([
        { email: "one@example.test", password: "pw" },
      ]),
    /at least two synthetic doctors/,
  );
  assert.throws(
    () =>
      selectBehaviorCredentials([
        { email: "same@example.test", password: "pw" },
        { email: "same@example.test", password: "pw" },
      ]),
    /distinct synthetic doctors/,
  );
  assert.deepEqual(
    selectBehaviorCredentials([
      { email: "a@example.test", password: "a" },
      { email: "b@example.test", password: "b" },
      { email: "c@example.test", password: "c" },
    ]).map((credential) => credential.email),
    ["a@example.test", "b@example.test"],
  );
});

test("provision manifest excludes role-grant failures from scenarios but keeps old manifests compatible", () => {
  assert.deepEqual(
    manifestCredentials({
      users: [
        { email: "ready@example.test", password: "pw", usable: true },
        { email: "failed@example.test", password: "pw", usable: false },
        { email: "legacy@example.test", password: "pw" },
      ],
    }).map(({ email }) => email),
    ["ready@example.test", "legacy@example.test"],
  );
});

test("BFF room seams keep the session fingerprint headers stable after login", () => {
  const login = roomSessionHeaders(undefined, {
    "content-type": "application/json",
  });
  const authenticated = roomSessionHeaders("sid=abc", {
    accept: "application/json",
  });

  assert.equal(login["user-agent"], authenticated["user-agent"]);
  assert.equal(login["accept-language"], authenticated["accept-language"]);
  assert.equal(authenticated.cookie, "sid=abc");
  assert.equal(login.cookie, undefined);
});

test("EARS-5: a repeated run fails fast when the participant is still inside the 2xN freshness window", () => {
  assert.doesNotThrow(() => assertFreshJoinPrecondition(1, 2, 15));
  assert.throws(
    () => assertFreshJoinPrecondition(2, 2, 15),
    /already inside the 2×N freshness window.*30s.*fresh synthetic accounts/,
  );
});

// --- room:verify refuses production on every origin it requests -------------
// Stubbed fetch only: a broken guard reaches a scripted stand, never a network.

/**
 * Run `fn` with a scripted `fetch` and exactly the given `LOADTEST_*` env (any
 * other `LOADTEST_*` value of the shell is cleared); restore both after.
 */
async function withScriptedStand(env, route, fn) {
  const calls = [];
  const savedFetch = globalThis.fetch;
  const savedEnv = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("LOADTEST_")) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (!(k in savedEnv)) savedEnv[k] = undefined;
    process.env[k] = v;
  }
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return route(String(url));
  };
  try {
    await fn();
    return { error: undefined, calls };
  } catch (error) {
    return { error, calls };
  } finally {
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const VERIFY_RUN = {
  origin: "http://localhost:3000",
  centrifugoOrigin: "http://localhost:8100",
  eventId: "seed-005-live",
  credentials: [
    { email: "observer@loadtest.invalid", password: "pw" },
    { email: "participant@loadtest.invalid", password: "pw" },
  ],
  publicationGraceMs: 1_000,
  commandTimeoutMs: 1_000,
};

/** Every scenario confirmation set: none of them may unlock room:verify. */
const EVERY_CONFIRMATION = {
  LOADTEST_ROOM_PROD_CONFIRMED: "1",
  LOADTEST_SUPPRESSION_CONFIRMED: "1",
};

test("room:verify refuses a production storefront or sign-in host origin before any request, whatever is confirmed", async () => {
  for (const [name, value, rest] of [
    [
      "LOADTEST_STOREFRONT_ORIGIN",
      "https://new.doctor.school",
      { LOADTEST_SIGN_IN_HOST_ORIGIN: "http://localhost:3005" },
    ],
    [
      "LOADTEST_SIGN_IN_HOST_ORIGIN",
      "https://login.doctor.school",
      { LOADTEST_STOREFRONT_ORIGIN: "http://localhost:3004" },
    ],
  ]) {
    const { error, calls } = await withScriptedStand(
      { ...rest, [name]: value, ...EVERY_CONFIRMATION },
      () => new globalThis.Response(null, { status: 404 }),
      () => runRoomBehaviorVerification(VERIFY_RUN),
    );
    assert.match(
      String(error?.message),
      new RegExp(`REFUSING to run room:verify against production target ${name}`),
      name,
    );
    assert.deepEqual(calls, [], name);
  }
});

test("room:verify refuses a production IdP its stand storefront redirects to, before requesting it", async () => {
  const door = "http://localhost:3004/login";
  const { error, calls } = await withScriptedStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: "http://localhost:3004",
      LOADTEST_SIGN_IN_HOST_ORIGIN: "http://localhost:3005",
      ...EVERY_CONFIRMATION,
    },
    (url) =>
      url === door
        ? new globalThis.Response(null, {
            status: 303,
            headers: {
              location:
                "https://id.doctor.school/oauth/v2/authorize?client_id=doctor",
            },
          })
        : new globalThis.Response(null, { status: 404 }),
    () => runRoomBehaviorVerification(VERIFY_RUN),
  );
  assert.match(
    String(error?.message),
    /REFUSING to run room:verify against production target the IdP authorize hop/,
  );
  assert.deepEqual(calls, [door]);
});
