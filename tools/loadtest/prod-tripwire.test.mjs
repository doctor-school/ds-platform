import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthBurstAllowed } from "./auth-burst.mjs";
import { isProdTarget } from "./lib.mjs";
import { assertRoomFanoutAllowed } from "./room-fanout.mjs";

// The address the production box answers on (the api-prod Caddyfile's A-record
// notes): every production vhost — api, sign-in host, both storefronts — sits on
// it, so the bare address reaches production without any doctor.school name.
const PROD_BOX_IP = "77.233.220.222";

test("isProdTarget: every doctor.school name is production, stage included", () => {
  for (const origin of [
    "https://api.doctor.school",
    "https://login.doctor.school",
    "https://new.doctor.school",
    "https://academy.doctor.school",
    "https://doctor.school",
    "https://pr-12.stage.doctor.school",
    "HTTPS://API.DOCTOR.SCHOOL:443",
    "api.doctor.school",
  ]) {
    assert.equal(isProdTarget(origin, {}), true, origin);
  }
});

test("isProdTarget: a trailing-dot (fully qualified) doctor.school host is production", () => {
  for (const origin of [
    "https://api.doctor.school./v1",
    "https://doctor.school.",
    "https://new.doctor.school..:8443",
    "doctor.school.",
    "api.doctor.school.",
  ]) {
    assert.equal(isProdTarget(origin, {}), true, origin);
  }
});

test("isProdTarget: an IP literal is production unless explicitly allowlisted", () => {
  for (const origin of [
    `http://${PROD_BOX_IP}`,
    `https://${PROD_BOX_IP}:443`,
    PROD_BOX_IP,
    // The URL parser canonicalises alternative IPv4 spellings to the same box.
    "http://0x4de9dcde",
    "http://1306386654",
    `http://[::ffff:${PROD_BOX_IP}]`,
    "http://[2a03:6f00::1]:3000",
    "http://192.168.1.115:3000",
    "http://10.0.0.5",
  ]) {
    assert.equal(isProdTarget(origin, {}), true, origin);
  }
});

test("isProdTarget: loopback addresses are non-production, like localhost", () => {
  for (const origin of [
    "http://127.0.0.1:3000",
    "http://127.1.2.3",
    "http://[::1]:3000",
    "http://[::ffff:127.0.0.1]:3000",
    "http://localhost:3000",
    "http://truenas.local:3000",
  ]) {
    assert.equal(isProdTarget(origin, {}), false, origin);
  }
});

test("isProdTarget: LOADTEST_NON_PROD_IPS allowlists exact non-production IP literals only", () => {
  const env = { LOADTEST_NON_PROD_IPS: " 192.168.1.115 , [fd00::7] " };
  assert.equal(isProdTarget("http://192.168.1.115:3000", env), false);
  assert.equal(isProdTarget("http://[fd00::7]:3000", env), false);
  // An allowlist never widens past exact addresses, and never covers a name.
  assert.equal(isProdTarget("http://192.168.1.116:3000", env), true);
  assert.equal(isProdTarget(`http://${PROD_BOX_IP}`, env), true);
  assert.equal(
    isProdTarget("https://api.doctor.school", {
      LOADTEST_NON_PROD_IPS: "api.doctor.school",
    }),
    true,
  );
});

test("isProdTarget: a malformed allowlist entry fails closed with a pointed error", () => {
  assert.throws(
    () =>
      isProdTarget("http://192.168.1.115", {
        LOADTEST_NON_PROD_IPS: "192.168.1.0/24",
      }),
    /LOADTEST_NON_PROD_IPS.*192\.168\.1\.0\/24.*IP literal/,
  );
});

test("room-fanout refuses a production target without the explicit run confirmation", () => {
  for (const origin of [
    "https://api.doctor.school",
    "https://api.doctor.school.",
    `http://${PROD_BOX_IP}`,
  ]) {
    assert.throws(
      () => assertRoomFanoutAllowed(origin, {}),
      /REFUSING to run room-fanout against production.*LOADTEST_ROOM_PROD_CONFIRMED=1/s,
      origin,
    );
    // Any value other than the exact "1" is not a confirmation.
    assert.throws(
      () =>
        assertRoomFanoutAllowed(origin, {
          LOADTEST_ROOM_PROD_CONFIRMED: "true",
        }),
      /REFUSING/,
      origin,
    );
    assert.doesNotThrow(() =>
      assertRoomFanoutAllowed(origin, { LOADTEST_ROOM_PROD_CONFIRMED: "1" }),
    );
  }
});

test("room-fanout runs against a non-production target with no confirmation", () => {
  assert.doesNotThrow(() =>
    assertRoomFanoutAllowed("http://localhost:3000", {}),
  );
  assert.doesNotThrow(() =>
    assertRoomFanoutAllowed("http://192.168.1.115:3000", {
      LOADTEST_NON_PROD_IPS: "192.168.1.115",
    }),
  );
});

test("auth-burst refuses a trailing-dot or IP-literal production target without its confirmation", () => {
  for (const origin of [
    "https://api.doctor.school.",
    `http://${PROD_BOX_IP}`,
  ]) {
    assert.throws(
      () => assertAuthBurstAllowed(origin, {}),
      /REFUSING to run auth-burst against production.*LOADTEST_SUPPRESSION_CONFIRMED=1/s,
      origin,
    );
    assert.doesNotThrow(() =>
      assertAuthBurstAllowed(origin, { LOADTEST_SUPPRESSION_CONFIRMED: "1" }),
    );
  }
  assert.doesNotThrow(() =>
    assertAuthBurstAllowed("http://localhost:3000", {}),
  );
});

// A stand api with a production value left in the shell for another origin the
// run requests (README «Targets»): the storefront door and callback, the sign-in
// host the password step posts as, the Centrifugo origin. Each one alone is a
// production run, so each must trip every guard.
const STAND_API = "http://localhost:3100";
const PROD_RUN_ORIGINS = [
  ["LOADTEST_STOREFRONT_ORIGIN", "https://new.doctor.school"],
  ["LOADTEST_STOREFRONT_ORIGIN", "https://new.doctor.school."],
  ["LOADTEST_STOREFRONT_ORIGIN", `http://${PROD_BOX_IP}:3004`],
  ["LOADTEST_SIGN_IN_HOST_ORIGIN", "https://login.doctor.school"],
  ["LOADTEST_CENTRIFUGO_ORIGIN", "https://api.doctor.school"],
];

test("room-fanout refuses a stand api when any other origin the run requests is production", () => {
  for (const [name, value] of PROD_RUN_ORIGINS) {
    assert.throws(
      () => assertRoomFanoutAllowed(STAND_API, { [name]: value }),
      new RegExp(
        `REFUSING to run room-fanout against production target ${name}.*LOADTEST_ROOM_PROD_CONFIRMED=1`,
        "s",
      ),
      `${name}=${value}`,
    );
    assert.doesNotThrow(
      () =>
        assertRoomFanoutAllowed(STAND_API, {
          [name]: value,
          LOADTEST_ROOM_PROD_CONFIRMED: "1",
        }),
      `${name}=${value}`,
    );
  }
});

test("auth-burst refuses a stand api when any other origin the run requests is production", () => {
  for (const [name, value] of PROD_RUN_ORIGINS) {
    assert.throws(
      () => assertAuthBurstAllowed(STAND_API, { [name]: value }),
      new RegExp(
        `REFUSING to run auth-burst against production target ${name}.*LOADTEST_SUPPRESSION_CONFIRMED=1`,
        "s",
      ),
      `${name}=${value}`,
    );
    assert.doesNotThrow(
      () =>
        assertAuthBurstAllowed(STAND_API, {
          [name]: value,
          LOADTEST_SUPPRESSION_CONFIRMED: "1",
        }),
      `${name}=${value}`,
    );
  }
});

test("a scenario's confirmation unlocks that scenario only", () => {
  const env = { LOADTEST_STOREFRONT_ORIGIN: "https://new.doctor.school" };
  assert.throws(
    () =>
      assertRoomFanoutAllowed(STAND_API, {
        ...env,
        LOADTEST_SUPPRESSION_CONFIRMED: "1",
      }),
    /REFUSING to run room-fanout/,
  );
  assert.throws(
    () =>
      assertAuthBurstAllowed(STAND_API, {
        ...env,
        LOADTEST_ROOM_PROD_CONFIRMED: "1",
      }),
    /REFUSING to run auth-burst/,
  );
});

test("a guard's per-URL check refuses a production URL the run follows from a server answer", () => {
  // The URLs no env var names: the IdP authorize hop and the storefront callback
  // a sign-in follows, the WebSocket a room grant names.
  const followed = [
    "https://id.doctor.school/oauth/v2/authorize?client_id=doctor&state=s",
    "https://new.doctor.school./auth/callback?code=one-time-code&state=s",
    "wss://api.doctor.school/connection/websocket",
    `ws://${PROD_BOX_IP}/connection/websocket`,
  ];
  for (const [scenario, allowTarget] of [
    ["room-fanout", assertRoomFanoutAllowed(STAND_API, {})],
    ["auth-burst", assertAuthBurstAllowed(STAND_API, {})],
  ]) {
    assert.doesNotThrow(() =>
      allowTarget("ws://localhost:8100/connection/websocket", "a followed URL"),
    );
    for (const url of followed) {
      assert.throws(
        () => allowTarget(url, "a followed URL"),
        (err) => {
          assert.match(
            err.message,
            new RegExp(
              `REFUSING to run ${scenario} against production target a followed URL`,
            ),
          );
          // The refusal names the origin only: a callback URL carries the
          // one-time authorization code.
          assert.doesNotMatch(err.message, /one-time-code|state=/);
          return true;
        },
        `${scenario}: ${url}`,
      );
    }
  }
  const confirmed = assertRoomFanoutAllowed(STAND_API, {
    LOADTEST_ROOM_PROD_CONFIRMED: "1",
  });
  for (const url of followed) {
    assert.doesNotThrow(() => confirmed(url, "a followed URL"), url);
  }
});
