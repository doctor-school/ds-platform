// The upstream double of the storefronts' backend-free Playwright tiers
// (#3172): answers the API's storefront-only internal transaction endpoint
// (`POST /v1/internal/oidc/transaction`, 003 EARS-61, shaped by
// `StorefrontTransactionResponseSchema`) so the built storefront's real sign-in
// entries (`/login`, `/register`, `/reset`, `/verify`) answer their `303` with
// no api, IdP or DB.
//
// The double holds the storefront's bearer like the API does: a request
// without `Authorization: Bearer <STOREFRONT_DOUBLE_TOKEN>` is refused `401`.
// `GET /__transactions` returns every accepted transaction body in order, so a
// spec asserts what the entry asked for (door, return path, intent).
//
// Env: STOREFRONT_DOUBLE_PORT (listen port), STOREFRONT_DOUBLE_TOKEN (bearer),
// STOREFRONT_DOUBLE_AUTHORIZE (the authorize URL base the answer points at).
import { createServer } from "node:http";

const PORT = Number(process.env.STOREFRONT_DOUBLE_PORT ?? 3217);
const TOKEN = process.env.STOREFRONT_DOUBLE_TOKEN ?? "storefront-double-token";
const AUTHORIZE =
  process.env.STOREFRONT_DOUBLE_AUTHORIZE ??
  "https://idp.invalid/oauth/v2/authorize";

const transactions = [];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  if (url.pathname === "/__transactions") return json(res, 200, transactions);
  if (
    url.pathname === "/v1/internal/oidc/transaction" &&
    req.method === "POST"
  ) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return json(res, 401, { message: "internal bearer refused" });
    }
    const body = JSON.parse((await readBody(req)) || "{}");
    transactions.push(body);
    const txId = `tx-${transactions.length}`;
    const authorize = new URL(AUTHORIZE);
    authorize.searchParams.set("client_id", `${body.client}-client`);
    authorize.searchParams.set("state", txId);
    return json(res, 200, { txId, authorizeUrl: authorize.toString() });
  }
  json(res, 404, { message: "not in the storefront entry double" });
}).listen(PORT, "127.0.0.1");
