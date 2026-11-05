import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
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

export function ownedFeedEntryDatabase(
  value: string,
  task: 3751 | 3772 = 3751,
): string {
  if (!new RegExp(`^/ds_(dev|probe)_${task}$`).test(new URL(value).pathname))
    throw new Error(
      `Feed-entry originals require the dedicated #${task} database`,
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

interface FeedEntryProcessIdentity {
  name: "api" | "doctor";
  platform: NodeJS.Platform;
  root: string;
  command: string;
  cwd?: string;
  executable?: string;
  nodeExecutable?: string;
}

export function assertFeedEntryProcessIdentity(
  identity: FeedEntryProcessIdentity,
) {
  const normalize = (value: string) => {
    const path = value.replaceAll("\\", "/");
    return identity.platform === "win32" ? path.toLowerCase() : path;
  };
  if (identity.platform === "linux") {
    if (
      normalize(identity.cwd ?? "") !==
      `${normalize(identity.root)}/apps/${identity.name}`
    )
      throw new Error("Feed-entry listener has the wrong worktree cwd");
    if (
      !identity.executable ||
      !identity.nodeExecutable ||
      normalize(identity.executable) !== normalize(identity.nodeExecutable)
    )
      throw new Error("Feed-entry listener is not the owning Node executable");
    // Next replaces /proc cmdline with this title after boot; cwd + exe remain OS-owned.
    if (
      identity.name === "doctor" &&
      /^next-server \(v[^()\s]+\)\s*$/.test(identity.command)
    )
      return;
  } else if (identity.platform !== "win32") {
    throw new Error("Unsupported feed-entry process identity platform");
  }
  const command = normalize(identity.command);
  if (
    !command.includes(normalize(identity.root)) ||
    !command.includes(
      identity.name === "api" ? "apps/api/dist/main.js" : "next/dist/bin/next",
    )
  )
    throw new Error("Feed-entry listener has the wrong process identity");
}

export function verifyOwnedFeedEntryListeners() {
  if (process.env.E2E_FEED_ENTRY_BOOT !== "1") return;
  for (const [name, url] of [
    ["api", process.env.E2E_API_URL],
    ["doctor", process.env.E2E_DOCTOR_URL],
  ] as const) {
    const port = Number(new URL(url!).port);
    let pid: number;
    let command: string;
    const identity: Omit<FeedEntryProcessIdentity, "command"> = {
      name,
      platform: process.platform,
      root: feedEntryRoot,
    };
    if (process.platform === "win32") {
      const connections = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const listener = connections
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find(
          (cells) => cells[1]?.endsWith(`:${port}`) && cells[3] === "LISTENING",
        );
      if (!listener) throw new Error(`No owned ${name} listener on ${port}`);
      pid = Number(listener[4]);
      command = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    } else {
      const inodes = new Set(
        ["/proc/net/tcp", "/proc/net/tcp6"].flatMap((path) =>
          readFileSync(path, "utf8")
            .split("\n")
            .map((line) => line.trim().split(/\s+/))
            .filter(
              (cells) =>
                cells[1]?.split(":")[1] ===
                  port.toString(16).toUpperCase().padStart(4, "0") &&
                cells[3] === "0A",
            )
            .map((cells) => `socket:[${cells[9]}]`),
        ),
      );
      const found = readdirSync("/proc")
        .filter((value) => /^\d+$/.test(value))
        .find((value) => {
          try {
            return readdirSync(`/proc/${value}/fd`).some((fd) =>
              inodes.has(readlinkSync(`/proc/${value}/fd/${fd}`)),
            );
          } catch {
            return false;
          }
        });
      if (!found) throw new Error(`No owned ${name} listener on ${port}`);
      pid = Number(found);
      command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll(
        "\0",
        " ",
      );
      identity.cwd = readlinkSync(`/proc/${pid}/cwd`);
      identity.executable = readlinkSync(`/proc/${pid}/exe`);
      identity.nodeExecutable = realpathSync(process.execPath);
    }
    assertFeedEntryProcessIdentity({ ...identity, command });
    feedEntryLog({
      command: "verify actual owned listener PID and worktree entry",
      name,
      port,
      pid,
      entry: command.trim(),
      cwd: identity.cwd,
      executable: identity.executable,
    });
  }
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
  const shell = read("apps/doctor/components/storefront-frame.tsx");
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
