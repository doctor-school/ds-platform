import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import {
  feedEntryLog,
  feedEntryRoot,
  ownedFeedEntryDatabase,
} from "./feed-entry.js";
import { E2E_PASSWORD } from "../admin/admin-session.js";

const require = createRequire(resolve(feedEntryRoot, "apps/api/package.json"));

export async function connection(task: 3785 | 3789 | 3797 | 3826 = 3785) {
  if (task === 3826) {
    // The 030 Background starts in Admin; a real public read establishes its
    // lazy API pool before requiring that pool's database identity.
    const readiness = await fetch(
      new URL("/v1/public/specialties", process.env.E2E_API_URL!),
    );
    expect(readiness.status).toBe(200);
    feedEntryLog({
      command: "owning API database read before 030 fixture connection",
      status: readiness.status,
    });
  }
  const database = ownedFeedEntryDatabase(
    process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "",
    task,
  );
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: database,
    application_name: `readonly-${task}-fixture`,
  });
  const client = await pool.connect();
  const query = async (sql: string, values: unknown[] = []) => {
    feedEntryLog({ command: "SQL", database: new URL(database).pathname, sql });
    return client.query(sql, values);
  };
  try {
    const facts = (
      await query(
        "SELECT current_database() AS name, (SELECT count(*)::int FROM pg_stat_activity WHERE application_name=$1) AS api_connections",
        [`feed-entry-${task}-api`],
      )
    ).rows[0];
    expect(`/${facts.name}`).toBe(new URL(database).pathname);
    expect(facts.api_connections).toBeGreaterThan(0);
  } catch (error) {
    client.release();
    await pool.end();
    throw error;
  }
  return {
    query,
    close: async () => {
      client.release();
      await pool.end();
    },
  };
}

export async function createCalendarGroupingFixture(today: string) {
  const db = await connection();
  let year = Number(today.slice(0, 4));
  if (`${year}-10-15` <= today) year++;
  const kind = randomUUID();
  const events = (["online", "offline"] as const).map((format) => ({
    id: randomUUID(),
    slug: `calendar-3785-${format}-${randomUUID()}`,
    format,
  }));
  const ids = events.map(({ id }) => id);
  const cleanup = async () => {
    try {
      await db.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM event_kinds WHERE id=$1", [kind]);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM events WHERE id=ANY($1::uuid[])",
            [ids],
          )
        ).rows[0].count,
      ).toBe(0);
      feedEntryLog({
        command: "removed exact calendar grouping fixture",
        ids,
        kind,
      });
    } finally {
      await db.close();
    }
  };
  feedEntryLog({
    command: "reserved exact owned calendar grouping fixture before mutation",
    events,
    kind,
  });
  try {
    await db.query(
      "INSERT INTO event_kinds (id,slug,title,allowed_formats,status,first_published_at) VALUES ($1,$2,'004 grouping fixture',ARRAY['online','offline']::event_participation_format[],'published',now())",
      [kind, `calendar-kind-${kind}`],
    );
    for (const event of events)
      await db.query(
        "INSERT INTO events (id,slug,title,school,starts_at,duration_min,state,kind_id,audience,participation_format) VALUES ($1,$2,$3,'004 grouping fixture',$4,60,'published',$5,'experts',$6)",
        [
          event.id,
          event.slug,
          `004 ${event.format} ${event.id}`,
          `${year}-10-14T22:00:00.000Z`,
          kind,
          event.format,
        ],
      );
    feedEntryLog({
      command: "committed owned same-instant online/offline events",
      today,
      year,
      events,
      kind,
    });
    return { events, year, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function createReadonlyOperator(
  task: 3785 | 3789 | 3797 | 3826 = 3785,
) {
  const issuer = process.env.IDP_ISSUER!;
  if (!issuer || new URL(issuer).hostname === "id.doctor.school")
    throw new Error("Read-only operator fixture requires the development IdP");
  const headers = {
    authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}`,
    "content-type": "application/json",
  };
  const email = `readonly-${task}-${randomUUID()}@ds.test`;
  const search = await fetch(`${issuer}/management/v1/users/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      queries: [{ emailQuery: { emailAddress: email } }],
    }),
  });
  expect(search.ok).toBe(true);
  expect(
    ((await search.json()) as { result?: unknown[] }).result ?? [],
  ).toEqual([]);
  feedEntryLog({
    command: "proved unique operator absent before create",
    email,
  });
  const { ZitadelIdpClient } = await import(
    pathToFileURL(
      resolve(feedEntryRoot, "apps/api/dist/auth/idp/zitadel.idp.js"),
    ).href
  );
  const idp = new ZitadelIdpClient({
    baseUrl: issuer,
    serviceToken: process.env.IDP_SERVICE_TOKEN!,
    projectId: process.env.IDP_PROJECT_ID!,
  });
  const created = await idp.createUser({ email, password: E2E_PASSWORD });
  if (created.alreadyExisted || !created.sub)
    throw new Error(
      "Operator creation did not return a new owned subject; no deletion is authorized",
    );
  const sub = created.sub as string;
  feedEntryLog({ command: "created exact owned operator", email, sub });
  const cleanup = async () => {
    const removed = await fetch(
      `${issuer}/v2/users/${encodeURIComponent(sub)}`,
      { method: "DELETE", headers },
    );
    expect(removed.ok).toBe(true);
    const absent = await fetch(
      `${issuer}/v2/users/${encodeURIComponent(sub)}`,
      { headers },
    );
    expect([404, 410]).toContain(absent.status);
    feedEntryLog({
      command: "removed exact created operator and verified absence",
      email,
      sub,
      status: absent.status,
    });
  };
  try {
    feedEntryLog({
      command: "grant exact owned operator role",
      sub,
      role: "platform_admin",
    });
    await idp.grantProjectRole(sub, "platform_admin");
    feedEntryLog({
      command: "granted exact owned operator role",
      sub,
      role: "platform_admin",
    });
    const db = await connection(task);
    try {
      const user = randomUUID();
      feedEntryLog({
        command: "reserved branch-only operator mirror before mutation",
        user,
        sub,
      });
      await db.query(
        "INSERT INTO users (id,zitadel_sub,email,role) VALUES ($1,$2,$3,'platform_admin')",
        [user, sub, email],
      );
      feedEntryLog({
        command:
          "created branch-only operator mirror; removed with owned branch DB",
        user,
        sub,
      });
    } finally {
      await db.close();
    }
    return { credentials: { email, password: E2E_PASSWORD }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
