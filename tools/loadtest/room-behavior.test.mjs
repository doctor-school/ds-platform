import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDevStandOrigin,
  assertFreshJoinPrecondition,
  assertReconnectGrant,
  evaluateBehaviorTrace,
  formatBehaviorReport,
  parseCentrifugoReplyData,
  selectBehaviorCredentials,
} from "./room-behavior.mjs";
import { manifestCredentials, roomSessionHeaders } from "./room-seams.mjs";

const successfulTrace = {
  runStartedAt: "2026-08-04T12:34:56.000Z",
  eventId: "seed-live-room",
  heartbeatIntervalSeconds: 15,
  baselineCount: 1,
  joinAckCount: 2,
  joinedCount: 2,
  joinElapsedMs: 420,
  leftCount: 1,
  leaveElapsedMs: 30_640,
  leavePublishAfterExpiryMs: 640,
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

test("reconnect grant must remain on the same complete room/channel/cadence", () => {
  const original = {
    eventId: "event-1",
    heartbeatIntervalSeconds: 5,
    chat: { url: "ws://localhost:8000", token: "old", channel: "room:event:1" },
  };
  assert.doesNotThrow(() =>
    assertReconnectGrant(original, {
      ...original,
      chat: { ...original.chat, token: "new" },
    }),
  );
  assert.throws(
    () => assertReconnectGrant(original, { ...original, chat: null }),
    /reconnect grant/,
  );
  assert.throws(
    () =>
      assertReconnectGrant(original, {
        ...original,
        heartbeatIntervalSeconds: 10,
      }),
    /same room, channel, and cadence/,
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
      joinElapsedMs: 1_001,
      leaveElapsedMs: 31_001,
      leavePublishAfterExpiryMs: 1_001,
    },
    { publicationGraceMs: 1_000 },
  );
  assert.equal(late.passed, false);
  assert.deepEqual(
    late.checks.slice(0, 2).map(({ passed }) => passed),
    [false, false],
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
  assert.match(output, /PASS presence join/);
  assert.match(output, /PASS presence age-out/);
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
