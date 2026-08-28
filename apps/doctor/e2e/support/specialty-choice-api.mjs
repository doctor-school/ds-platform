import { createServer } from "node:http";

const port = Number(process.env.DOCTOR_FAKE_API_PORT ?? 3212);
const entries = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    code: "kardiologiya",
    name: "Кардиология",
    isOther: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    code: "nevrologiya",
    name: "Неврология",
    isOther: false,
  },
];
const profiles = new Map([["profile-existing", entries[0]]]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const cookies = parseCookies(request.headers.cookie ?? "");
  const session = cookies.get("__Host-ds_session") ?? null;
  const guest = cookies.get("__Host-ds_specialty") ?? null;

  if (url.pathname === "/health") return json(response, 200, { ok: true });
  if (url.pathname === "/v1/auth/session") {
    return session
      ? json(response, 200, {
          sub: session,
          roles: ["doctor_guest"],
          mfa: false,
        })
      : json(response, 401, { status: 401 });
  }
  if (url.pathname === "/v1/me/specialty") {
    if (!session) return json(response, 401, { status: 401 });
    let specialty = profiles.get(session) ?? null;
    const guestEntry = entries.find((entry) => entry.id === guest) ?? null;
    if (!specialty && guestEntry) {
      specialty = guestEntry;
      profiles.set(session, guestEntry);
    }
    return json(
      response,
      200,
      specialty
        ? { specialty, storedIn: "profile" }
        : { specialty: null, storedIn: "none" },
      guest !== null
        ? {
            "set-cookie":
              "__Host-ds_specialty=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
          }
        : undefined,
    );
  }
  if (url.pathname === "/v1/public/specialty-choice") {
    const specialty = entries.find((entry) => entry.id === guest) ?? null;
    return json(
      response,
      200,
      specialty
        ? { specialty, storedIn: "session" }
        : { specialty: null, storedIn: "none" },
    );
  }
  if (url.pathname === "/v1/public/specialties/frequent") {
    return json(response, 200, { entries });
  }
  if (url.pathname === "/v1/public/specialties/search") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const found = entries.filter((entry) =>
      entry.name.toLowerCase().includes(query),
    );
    return json(response, 200, { query, entries: found, total: found.length });
  }
  if (url.pathname === "/v1/public/specialties") {
    return json(response, 200, { entries, total: entries.length });
  }
  if (url.pathname === "/v1/public/statistics") {
    return json(response, 200, {
      doctors: 1,
      computedAt: "2026-08-28T00:00:00.000Z",
    });
  }
  if (url.pathname === "/v1/__test/profile") {
    return json(response, 200, {
      specialty: profiles.get(url.searchParams.get("session") ?? "") ?? null,
    });
  }
  return json(response, 404, { status: 404 });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function parseCookies(header) {
  return new Map(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      return [
        [part.slice(0, separator).trim(), part.slice(separator + 1).trim()],
      ];
    }),
  );
}

function json(response, status, body, headers = undefined) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...(headers ?? {}),
  });
  response.end(JSON.stringify(body));
}
