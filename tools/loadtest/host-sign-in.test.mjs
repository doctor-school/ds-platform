import assert from "node:assert/strict";
import test from "node:test";
import { hostSignIn, signInTransport } from "./host-sign-in.mjs";
import { assertRoomFanoutAllowed } from "./room-fanout.mjs";

const API = "http://api.stand.test";
const STOREFRONT = "http://doctor.stand.test";
const SIGN_IN_HOST = "http://login.stand.test";
const AUTHORIZE = "http://idp.stand.test/oauth/v2/authorize?client_id=doctor";

function reply(status, { json, location, cookies = [] } = {}) {
  const headers = new globalThis.Headers();
  if (location) headers.set("location", location);
  for (const c of cookies) headers.append("set-cookie", c);
  return new globalThis.Response(json ? JSON.stringify(json) : null, {
    status,
    headers,
  });
}

/**
 * Run `fn` with a scripted `fetch` and exactly the given `LOADTEST_*` env (any
 * other `LOADTEST_*` value of the shell is cleared); restore both after.
 */
async function withStand(env, route, fn) {
  const calls = [];
  const savedFetch = globalThis.fetch;
  const savedEnv = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("LOADTEST_")) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  for (const k of Object.keys(env)) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
    };
    calls.push(call);
    return route(call);
  };
  try {
    return { result: await fn(), calls };
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

/** The sign-in host legs every transport shares (authorize, entry, password). */
function sharedLegs(call, callbackUrl) {
  if (call.url === AUTHORIZE) {
    return reply(302, { location: `${SIGN_IN_HOST}/login?authRequest=AR1` });
  }
  if (call.url === `${API}/v1/sign-in-host/entry?authRequest=AR1`) {
    return reply(200, {
      json: { action: "render", csrf: "csrf-1", authRequest: "AR1" },
      cookies: ["__Host-ds_signin_form=form-1; Path=/; Secure; HttpOnly"],
    });
  }
  if (call.url === `${API}/v1/sign-in-host/login`) {
    return reply(200, { json: { status: "redirect", url: callbackUrl } });
  }
  return null;
}

test("signInTransport: the storefront transport whenever a storefront origin is set", () => {
  assert.equal(
    signInTransport("https://api.doctor.school", {
      LOADTEST_STOREFRONT_ORIGIN: "https://new.doctor.school",
    }),
    "storefront",
  );
  assert.equal(
    signInTransport("http://localhost:3100", {
      LOADTEST_STOREFRONT_ORIGIN: "http://127.0.0.1:3004",
    }),
    "storefront",
  );
  assert.equal(signInTransport("http://localhost:3100", {}), "internal");
});

test("signInTransport: the internal transport is refused for a production target", () => {
  for (const origin of [
    "https://api.doctor.school",
    "https://new.doctor.school.",
    "http://77.233.220.222",
  ]) {
    assert.throws(
      () => signInTransport(origin, {}),
      /needs LOADTEST_STOREFRONT_ORIGIN.*404 on every public production host/s,
      origin,
    );
  }
});

test("hostSignIn (storefront transport): door → authorize → entry → password → callback, nothing internal", async () => {
  const callbackUrl = `${STOREFRONT}/auth/callback?code=C1&state=S1`;
  const { result, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
      LOADTEST_INTERNAL_API_TOKEN: undefined,
    },
    (call) => {
      if (call.url === `${STOREFRONT}/login`) {
        return reply(303, {
          location: AUTHORIZE,
          cookies: ["__Host-ds_oidc_tx=tx-1; Path=/; Secure; HttpOnly"],
        });
      }
      if (call.url === callbackUrl) {
        return reply(303, {
          location: `${STOREFRONT}/#`,
          cookies: [
            "__Host-ds_oidc_tx=; Path=/; Max-Age=0",
            "__Host-ds_session=sess-1; Path=/; Secure; HttpOnly",
          ],
        });
      }
      return sharedLegs(call, callbackUrl) ?? reply(404);
    },
    () =>
      hostSignIn(API, {
        email: "a@loadtest.invalid",
        password: "pw",
        headers: { "user-agent": "ua/1", "accept-language": "en-US" },
      }),
  );

  assert.equal(result.cookie, "__Host-ds_session=sess-1");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      `GET ${STOREFRONT}/login`,
      `GET ${AUTHORIZE}`,
      `GET ${API}/v1/sign-in-host/entry?authRequest=AR1`,
      `POST ${API}/v1/sign-in-host/login`,
      `GET ${callbackUrl}`,
    ],
  );
  assert.equal(result.steps.length, 5);
  assert.ok(calls.every((c) => !c.url.includes("/v1/internal/")));
  // The door opens only for a top-level document navigation (003 EARS-61).
  const door = calls[0].headers;
  assert.equal(door["sec-fetch-mode"], "navigate");
  assert.equal(door["sec-fetch-dest"], "document");
  assert.equal(door["user-agent"], "ua/1");
  // The password step carries the form cookie; the callback the tx cookie.
  assert.equal(calls[3].headers.cookie, "__Host-ds_signin_form=form-1");
  assert.equal(calls[4].headers.cookie, "__Host-ds_oidc_tx=tx-1");
  assert.equal(calls[4].headers["user-agent"], "ua/1");
});

test("hostSignIn (storefront transport): a callback that mints no session yields no cookie", async () => {
  const callbackUrl = `${STOREFRONT}/auth/callback?code=C1&state=S1`;
  const { result } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
    },
    (call) => {
      if (call.url === `${STOREFRONT}/login`) {
        return reply(303, { location: AUTHORIZE });
      }
      if (call.url === callbackUrl) {
        return reply(303, {
          location: `${STOREFRONT}/#`,
          cookies: ["__Host-ds_oidc_tx=; Path=/; Max-Age=0"],
        });
      }
      return sharedLegs(call, callbackUrl) ?? reply(404);
    },
    () =>
      hostSignIn(API, {
        email: "a@loadtest.invalid",
        password: "pw",
        headers: {},
      }),
  );
  assert.equal(result.cookie, null);
  assert.equal(result.steps.length, 5);
});

const SIGN_IN = {
  email: "a@loadtest.invalid",
  password: "pw",
  headers: { "user-agent": "ua/1", "accept-language": "en-US" },
};

/** A stand journey whose door and password step answer the given URLs. */
function standJourney({ authorize = AUTHORIZE, callbackUrl }) {
  return (call) => {
    if (call.url === `${STOREFRONT}/login`) {
      return reply(303, {
        location: authorize,
        cookies: ["__Host-ds_oidc_tx=tx-1; Path=/; Secure; HttpOnly"],
      });
    }
    if (call.url === callbackUrl) {
      return reply(303, {
        location: `${STOREFRONT}/#`,
        cookies: ["__Host-ds_session=sess-1; Path=/; Secure; HttpOnly"],
      });
    }
    return sharedLegs(call, callbackUrl) ?? reply(404);
  };
}

test("hostSignIn refuses a production storefront origin with a stand api before any request", async () => {
  const { error, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: "https://new.doctor.school",
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
    },
    () => reply(404),
    () => hostSignIn(API, SIGN_IN),
  );
  assert.match(
    String(error?.message),
    /REFUSING to run sign-in against production target LOADTEST_STOREFRONT_ORIGIN/,
  );
  assert.deepEqual(calls, []);
});

test("hostSignIn refuses a production sign-in host origin before any request", async () => {
  const { error, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: "https://login.doctor.school",
    },
    () => reply(404),
    () => hostSignIn(API, SIGN_IN),
  );
  assert.match(
    String(error?.message),
    /REFUSING to run sign-in against production target LOADTEST_SIGN_IN_HOST_ORIGIN/,
  );
  assert.deepEqual(calls, []);
});

test("hostSignIn refuses a production IdP authorize URL a stand storefront redirects to", async () => {
  const callbackUrl = `${STOREFRONT}/auth/callback?code=C1&state=S1`;
  const { error, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
    },
    standJourney({
      authorize: "https://id.doctor.school/oauth/v2/authorize?client_id=doctor",
      callbackUrl,
    }),
    () => hostSignIn(API, SIGN_IN),
  );
  assert.match(
    String(error?.message),
    /REFUSING to run sign-in against production target the IdP authorize hop "https:\/\/id\.doctor\.school"/,
  );
  assert.deepEqual(
    calls.map((c) => c.url),
    [`${STOREFRONT}/login`],
  );
});

test("hostSignIn refuses a production callback URL the password step answers", async () => {
  const callbackUrl =
    "https://new.doctor.school/auth/callback?code=one-time-code&state=S1";
  const { error, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
    },
    standJourney({ callbackUrl }),
    () => hostSignIn(API, SIGN_IN),
  );
  assert.match(
    String(error?.message),
    /REFUSING to run sign-in against production target the storefront callback/,
  );
  assert.doesNotMatch(String(error?.message), /one-time-code/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.url !== callbackUrl));
});

test("hostSignIn passes every request through the run's gate before issuing it", async () => {
  const callbackUrl = `${STOREFRONT}/auth/callback?code=C1&state=S1`;
  const log = [];
  const { result } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: STOREFRONT,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
    },
    (call) => {
      log.push(`fetch ${call.url}`);
      return standJourney({ callbackUrl })(call);
    },
    () =>
      hostSignIn(API, {
        ...SIGN_IN,
        allowTarget: (url) => log.push(`allow ${url}`),
      }),
  );
  assert.equal(result.cookie, "__Host-ds_session=sess-1");
  const urls = [
    `${STOREFRONT}/login`,
    AUTHORIZE,
    `${API}/v1/sign-in-host/entry?authRequest=AR1`,
    `${API}/v1/sign-in-host/login`,
    callbackUrl,
  ];
  assert.deepEqual(
    log,
    urls.flatMap((url) => [`allow ${url}`, `fetch ${url}`]),
  );
});

test("hostSignIn runs a production storefront under a confirmed scenario's gate (stubbed fetch)", async () => {
  const env = {
    LOADTEST_API_ORIGIN: "https://api.doctor.school",
    LOADTEST_STOREFRONT_ORIGIN: "https://new.doctor.school",
    LOADTEST_SIGN_IN_HOST_ORIGIN: "https://login.doctor.school",
    LOADTEST_ROOM_PROD_CONFIRMED: "1",
  };
  const { error, calls } = await withStand(
    env,
    () => reply(404),
    () =>
      hostSignIn("https://api.doctor.school", {
        ...SIGN_IN,
        allowTarget: assertRoomFanoutAllowed("https://api.doctor.school", env),
      }),
  );
  assert.equal(error, undefined);
  assert.deepEqual(
    calls.map((c) => c.url),
    ["https://new.doctor.school/login"],
  );
});

test("hostSignIn (internal transport): transaction and redeem on the internal credential", async () => {
  const callbackUrl = `${STOREFRONT}/auth/callback?code=C2&state=S2`;
  const { result, calls } = await withStand(
    {
      LOADTEST_STOREFRONT_ORIGIN: undefined,
      LOADTEST_SIGN_IN_HOST_ORIGIN: SIGN_IN_HOST,
      LOADTEST_INTERNAL_API_TOKEN: "internal-1",
    },
    (call) => {
      if (call.url === `${API}/v1/internal/oidc/transaction`) {
        return reply(200, { json: { txId: "tx-2", authorizeUrl: AUTHORIZE } });
      }
      if (call.url === `${API}/v1/internal/oidc/redeem`) {
        return reply(200, {
          json: { success: true },
          cookies: ["__Host-ds_session=sess-2; Path=/; Secure; HttpOnly"],
        });
      }
      return sharedLegs(call, callbackUrl) ?? reply(404);
    },
    () =>
      hostSignIn(API, {
        email: "b@loadtest.invalid",
        password: "pw",
        headers: {},
      }),
  );
  assert.equal(result.cookie, "__Host-ds_session=sess-2");
  assert.equal(calls[0].headers.authorization, "Bearer internal-1");
  assert.equal(calls.at(-1).url, `${API}/v1/internal/oidc/redeem`);
  assert.ok(calls.every((c) => !c.url.startsWith(STOREFRONT)));
});
