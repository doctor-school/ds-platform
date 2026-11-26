// The session upstream double of the storefronts' backend-free Playwright
// tiers (#2478): answers the two server-side reads the storefront shell makes
// for its auth cluster — `GET /v1/auth/session` (the principal) and
// `GET /v1/me/profile` (the Academy chip's initials, the applicant's email) —
// from the forwarded `__Host-ds_session` cookie: present ⇒ a signed-in doctor,
// absent ⇒ 401; and the public specialty book `GET /v1/public/specialties`.
//
// Every other path drops the connection, exactly what the tier's absent API
// did before this double existed (a refused connection), so a server read of
// any other endpoint keeps degrading the way it always has on this tier.
//
// Env: STOREFRONT_SESSION_DOUBLE_PORT (listen port).
import { createServer } from "node:http";

const PORT = Number(process.env.STOREFRONT_SESSION_DOUBLE_PORT ?? 3218);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  const signedIn = (req.headers.cookie ?? "").includes("__Host-ds_session=");
  if (url.pathname === "/v1/auth/session") {
    if (!signedIn) return json(res, 401, { status: 401 });
    return json(res, 200, {
      sub: "00000000-0000-4000-8000-000000000001",
      email: "doctor@example.test",
      roles: ["doctor"],
    });
  }
  if (url.pathname === "/v1/me/profile") {
    if (!signedIn) return json(res, 401, { status: 401 });
    return json(res, 200, {
      displayName: "Анна Петрова",
      email: "doctor@example.test",
      emailVerified: true,
    });
  }
  // 017 — the public Минздрав specialty book (`SpecialtyBook`), which the
  // Academy «Подать заявку» form reads server-side for its «Специальность»
  // (033 EARS-4); three entries plus the book's own «Другое» row.
  if (url.pathname === "/v1/public/specialties") {
    const entries = [
      ["00000000-0000-4000-8000-000000000101", "cardiology", "Кардиология", false],
      ["00000000-0000-4000-8000-000000000102", "neurology", "Неврология", false],
      ["00000000-0000-4000-8000-000000000103", "pediatrics", "Педиатрия", false],
      ["00000000-0000-4000-8000-000000000199", "other", "Другое", true],
    ].map(([id, code, name, isOther]) => ({ id, code, name, isOther }));
    return json(res, 200, { entries, total: entries.length });
  }
  req.socket.destroy();
}).listen(PORT, "127.0.0.1");
