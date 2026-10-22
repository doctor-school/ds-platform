// The upstream double of the sign-in host's CI axe tier (#3170): answers the
// API's `GET /v1/sign-in-host/entry` with the contract's render answer
// (`SignInHostEntryResponseSchema`) for four fixed auth requests, so the host
// renders each storefront's real `@ds/auth-flow` door with no api, IdP or DB.
// Every other auth request is the API's redirect answer for an unknown one.
import { createServer } from "node:http";

const PORT = Number(process.env.LOGIN_FAKE_API_PORT ?? 3216);

const RENDERS = {
  "doctor-login": { storefront: "doctor", door: "login" },
  "doctor-register": { storefront: "doctor", door: "register" },
  "academy-login": { storefront: "academy", door: "login" },
  "academy-register": { storefront: "academy", door: "register" },
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  if (url.pathname === "/v1/sign-in-host/entry") {
    const authRequest = url.searchParams.get("authRequest") ?? "";
    const render = RENDERS[authRequest];
    if (!render) {
      return json(res, 200, {
        action: "redirect",
        url: "http://127.0.0.1:3004/login",
      });
    }
    return json(
      res,
      200,
      { action: "render", ...render, authRequest, csrf: "csrf-axe" },
      {
        "set-cookie":
          "__Host-ds_login_form=axe; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400",
      },
    );
  }
  json(res, 404, { message: "not in the axe double" });
}).listen(PORT, "127.0.0.1");
