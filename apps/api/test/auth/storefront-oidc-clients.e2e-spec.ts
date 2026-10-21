import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// 003 EARS-60 / ADR-0015 §4 req. 1 + 7 (AS side) — the two storefront OIDC clients
// `infra/dev-stand/idp/provision.sh` step 3.bis converges, proven against the live
// IdP's authorize endpoint: the registered callback starts a login on the client's
// own sign-in host; a foreign or look-alike redirect_uri and an unknown client_id
// get no code and start no login; the headless app (which the admin sign-in rides)
// never names the sign-in host.
//
// Env-gated like the other live IdP suites: endpoints and the service PAT come from
// the process env (`~/.ds-platform/.env.local` locally, the api-e2e job on CI).
const ISSUER = process.env.IDP_ISSUER?.replace(/\/$/, "");
const TOKEN = process.env.IDP_SERVICE_TOKEN;
const PROJECT_ID = process.env.IDP_PROJECT_ID;
const HEADLESS_APP_NAME = process.env.IDP_APP_NAME ?? "ds-platform-dev";
const STOREFRONT_APPS = {
  academy: process.env.IDP_ACADEMY_APP_NAME ?? "ds-storefront-academy",
  doctor: process.env.IDP_DOCTOR_APP_NAME ?? "ds-storefront-doctor",
} as const;

type OidcConfig = {
  clientId: string;
  redirectUris?: string[];
  postLogoutRedirectUris?: string[];
  authMethodType?: string;
  backChannelLogoutUri?: string;
  loginVersion?: { loginV2?: { baseUri?: string } };
};
type App = { id: string; name: string; oidcConfig?: OidcConfig };

async function management<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(
    `${ISSUER}/management/v1/projects/${PROJECT_ID}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!res.ok) throw new Error(`IdP ${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function appByName(name: string): Promise<App> {
  const found = await management<{ result?: App[] }>("POST", "/apps/_search", {
    queries: [{ nameQuery: { name, method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  const app = (found.result ?? []).find((item) => item.name === name);
  if (!app)
    throw new Error(`app ${name} is not provisioned — run provision.sh`);
  return (await management<{ app: App }>("GET", `/apps/${app.id}`)).app;
}

/** One authorize hop, never followed: the answer's status and Location. */
async function authorize(clientId: string, redirectUri: string) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const res = await fetch(`${ISSUER}/oauth/v2/authorize?${params}`, {
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

const lookAlikes = (callback: string) => {
  const url = new URL(callback);
  return [
    "https://evil.example/auth/callback",
    `${url.origin}.evil.example${url.pathname}`,
    `${url.origin}${url.pathname}/../evil`,
    `${callback}?next=https://evil.example`,
    `${callback}/`,
    callback.replace(/^https?:/, (scheme) =>
      scheme === "http:" ? "https:" : "http:",
    ),
  ];
};

describe.skipIf(!ISSUER || !TOKEN || !PROJECT_ID)(
  "003 EARS-60: storefront OIDC clients on the live IdP (e2e)",
  () => {
    const clients: Record<keyof typeof STOREFRONT_APPS, OidcConfig> =
      {} as never;

    beforeAll(async () => {
      for (const [key, name] of Object.entries(STOREFRONT_APPS)) {
        const app = await appByName(name);
        clients[key as keyof typeof STOREFRONT_APPS] =
          app.oidcConfig ?? ({} as OidcConfig);
      }
    });

    it.each(Object.keys(STOREFRONT_APPS))(
      "003 EARS-60: the %s client holds exactly one callback and one post-logout URI with private_key_jwt and its own sign-in host",
      (key) => {
        const client = clients[key as keyof typeof STOREFRONT_APPS];
        expect(client.redirectUris).toHaveLength(1);
        expect(client.redirectUris?.[0]).toMatch(/\/auth\/callback$/);
        expect(client.postLogoutRedirectUris).toHaveLength(1);
        expect(client.authMethodType).toBe(
          "OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT",
        );
        expect(client.backChannelLogoutUri).toMatch(
          /\/v1\/auth\/back-channel-logout$/,
        );
        expect(client.loginVersion?.loginV2?.baseUri).toMatch(/^https?:\/\//);
      },
    );

    it.each(Object.keys(STOREFRONT_APPS))(
      "003 EARS-60: the %s client's exact callback starts a login on its sign-in host",
      async (key) => {
        const client = clients[key as keyof typeof STOREFRONT_APPS];
        const base = client.loginVersion!.loginV2!.baseUri!.replace(/\/$/, "");
        const { status, location } = await authorize(
          client.clientId,
          client.redirectUris![0]!,
        );
        expect(status).toBe(302);
        expect(location.startsWith(`${base}/login?authRequest=`)).toBe(true);
      },
    );

    it.each(Object.keys(STOREFRONT_APPS))(
      "003 EARS-60: a foreign or look-alike redirect_uri on the %s client gets no code and starts no login (req. 1)",
      async (key) => {
        const client = clients[key as keyof typeof STOREFRONT_APPS];
        for (const uri of lookAlikes(client.redirectUris![0]!)) {
          const { status, location } = await authorize(client.clientId, uri);
          expect(status, uri).not.toBe(302);
          expect(location, uri).not.toContain("authRequest=");
          expect(location, uri).not.toContain("code=");
        }
      },
    );

    it("003 EARS-60: an unknown client_id is refused — no login, no code (req. 7)", async () => {
      const { status, location } = await authorize(
        `unknown-${randomBytes(6).toString("hex")}`,
        clients.academy.redirectUris![0]!,
      );
      // Zitadel answers it itself (Errors.App.NotFound), never by redirecting.
      expect(status).toBe(400);
      expect(location).not.toContain("authRequest=");
      expect(location).not.toContain("code=");
    });

    it("003 EARS-60: the headless app (the admin sign-in's client) still starts its login on the id host's Login V2 UI", async () => {
      // Login V2 is selected per app (ADR-0015 §4): with the instance flag off, the
      // headless app's own loginVersion keeps its authorize hop on a V2 auth request
      // that POST /v2/oidc/auth_requests/{id} resolves (EARS-8).
      const headless = (await appByName(HEADLESS_APP_NAME)).oidcConfig!;
      const base = headless.loginVersion?.loginV2?.baseUri?.replace(/\/$/, "");
      expect(base).toMatch(/\/ui\/v2\/login$/);
      const { status, location } = await authorize(
        headless.clientId,
        headless.redirectUris![0]!,
      );
      expect(status).toBe(302);
      expect(location.startsWith(`${base}/login?authRequest=`)).toBe(true);
    });

    it("003 EARS-60: the headless app (the admin sign-in's client) does not name the sign-in host (req. 7)", async () => {
      const headless = await appByName(HEADLESS_APP_NAME);
      const signInHosts = new Set(
        Object.values(clients).map(
          (client) => client.loginVersion!.loginV2!.baseUri!,
        ),
      );
      const config = JSON.stringify(headless.oidcConfig ?? {});
      for (const host of signInHosts) expect(config).not.toContain(host);
      expect(
        headless.oidcConfig?.authMethodType ?? "OIDC_AUTH_METHOD_TYPE_BASIC",
      ).toBe("OIDC_AUTH_METHOD_TYPE_BASIC");
    });
  },
);
