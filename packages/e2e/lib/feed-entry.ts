import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "@playwright/test";

export const feedEntryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiRequire = createRequire(
  resolve(feedEntryRoot, "apps/api/package.json"),
);

export function ownedFeedEntryDatabase(value: string): string {
  if (!/^\/ds_(dev|probe)_3751$/.test(new URL(value).pathname))
    throw new Error(
      "Feed-entry originals require the dedicated #3751 database",
    );
  return value;
}

export function feedEntryLog(event: Record<string, unknown>) {
  const path = process.env.E2E_FEED_ENTRY_LOG;
  if (!path)
    throw new Error(
      "E2E_FEED_ENTRY_LOG is required for owned feed-entry proof",
    );
  appendFileSync(
    path,
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
  );
}

export function verifyFeedEntryProvenance() {
  const read = (path: string) =>
    readFileSync(resolve(feedEntryRoot, path), "utf8");
  const manifest = JSON.parse(read("design-source/manifest.json")) as {
    files: Record<string, { sha256: string; pulledAt: string }>;
  };
  for (const name of ["doctor-home.dc.html", "ds-shell.dc.html"]) {
    expect(
      createHash("sha256")
        .update(read(`design-source/${name}`))
        .digest("hex"),
    ).toBe(manifest.files[name]!.sha256);
    expect(manifest.files[name]!.pulledAt).toBeTruthy();
  }
  expect(read("design-source/doctor-home.dc.html")).toContain("ds-shell");
  expect(read("design-source/ds-shell.dc.html")).toContain("doctor");
  const shell = read("apps/doctor/app/(storefront)/layout.tsx");
  expect(shell).toContain('from "@ds/storefront-shell"');
  expect(shell).toContain("<StorefrontHeader");
  expect(shell).toContain("<StorefrontFooter");
  expect(read("packages/storefront-shell/package.json")).toContain(
    '"@ds/design-system"',
  );
  feedEntryLog({
    command:
      "verify accepted vendored home/shell hashes and shared design-system mount",
  });
}

/** 017 Background: exercise the owning managed read with real, transaction-local rows. */
export async function verifyManagedFeedEntryAdjacency(specialtyId: string) {
  const database = ownedFeedEntryDatabase(
    process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "",
  );
  const { Pool } = apiRequire("pg");
  const { drizzle } = apiRequire("drizzle-orm/node-postgres");
  const { TargetingRepository } = await import(
    pathToFileURL(
      resolve(
        feedEntryRoot,
        "apps/api/dist/storefront/targeting.repository.js",
      ),
    ).href
  );
  const pool = new Pool({
    connectionString: database,
    application_name: "feed-entry-3751-precondition",
  });
  const client = await pool.connect();
  const own = randomUUID(),
    adjacent = randomUUID(),
    link = randomUUID(),
    edge = randomUUID();
  async function query(sql: string, values: unknown[] = []) {
    feedEntryLog({ command: "SQL", database: new URL(database).pathname, sql });
    return client.query(sql, values);
  }
  try {
    const facts = (
      await query(
        "SELECT current_database() AS name, (SELECT count(*)::int FROM pg_stat_activity WHERE application_name='feed-entry-3751-api') AS api_connections",
      )
    ).rows[0];
    expect(`/${facts.name}`).toBe(new URL(database).pathname);
    expect(facts.api_connections).toBeGreaterThan(0);
    await query("BEGIN");
    await query(
      "INSERT INTO directions (id,slug,title,status,first_published_at) VALUES ($1,$2,'Entry own','published',now()),($3,$4,'Entry adjacent','published',now())",
      [own, `entry-${own}`, adjacent, `entry-${adjacent}`],
    );
    await query(
      "INSERT INTO direction_specialties (id,direction_id,specialty_minzdrav_id) VALUES ($1,$2,$3)",
      [link, own, specialtyId],
    );
    await query(
      "INSERT INTO direction_adjacency (id,direction_id,adjacent_direction_id,kind) VALUES ($1,$2,$3,'related')",
      [edge, own, adjacent],
    );
    const repository = new TargetingRepository(drizzle(client));
    const ownRows = await repository.findOwnDirections(specialtyId);
    expect(ownRows.map((row: { id: string }) => row.id)).toContain(own);
    const adjacentRows = await repository.findAdjacentDirections([own]);
    expect(adjacentRows).toEqual([
      expect.objectContaining({ id: adjacent, edgeId: edge, kind: "related" }),
    ]);
    feedEntryLog({
      command:
        "owning TargetingRepository read proves managed link and adjacency",
      own,
      adjacent,
      link,
      edge,
    });
  } finally {
    await query("ROLLBACK");
    client.release();
    await pool.end();
  }
}
