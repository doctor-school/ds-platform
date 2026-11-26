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
        assertRoomFanoutAllowed(origin, { LOADTEST_ROOM_PROD_CONFIRMED: "true" }),
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
  for (const origin of ["https://api.doctor.school.", `http://${PROD_BOX_IP}`]) {
    assert.throws(
      () => assertAuthBurstAllowed(origin, {}),
      /REFUSING to run auth-burst against production.*LOADTEST_SUPPRESSION_CONFIRMED=1/s,
      origin,
    );
    assert.doesNotThrow(() =>
      assertAuthBurstAllowed(origin, { LOADTEST_SUPPRESSION_CONFIRMED: "1" }),
    );
  }
  assert.doesNotThrow(() => assertAuthBurstAllowed("http://localhost:3000", {}));
});
