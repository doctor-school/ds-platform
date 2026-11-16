import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:net";
import { openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import {
  bootEventCountApi,
  countDirectory,
  countOperation,
  countRoot,
} from "./event-count-fixture.js";

export const authoringSha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export function authoringTree(directory: string): string {
  return authoringSha(
    readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (entry) =>
          `${entry.name}:${entry.isDirectory() ? authoringTree(resolve(directory, entry.name)) : authoringSha(readFileSync(resolve(directory, entry.name)))}`,
      )
      .join("\n"),
  );
}
export function authoringCapture(name: string, value: unknown) {
  writeFileSync(
    resolve(countDirectory(), name),
    JSON.stringify(value, null, 2),
  );
}
async function freePort() {
  countOperation("probe OS-owned free loopback port");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
export async function bootEventAuthoringRuntime() {
  countOperation("run shared owning room-player adversarial unit suite");
  const vitest = createRequire(
    resolve(countRoot, "packages/e2e/package.json"),
  ).resolve("vitest/vitest.mjs");
  const unit = execFileSync(
    process.execPath,
    [vitest, "run", "src/model/room-player.test.ts"],
    { cwd: resolve(countRoot, "packages/room"), encoding: "utf8" },
  );
  authoringCapture("room-player-unit.json", {
    passed: true,
    sha256: authoringSha(unit),
  });
  const api = await bootEventCountApi(4061);
  const children: ChildProcess[] = [];
  const origins: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const ssr: {
    path: string;
    status: number;
    at: string;
    database: string;
    apiOrigin: string;
  }[] = [];
  const server = (
    api.app as unknown as { getHttpServer(): Server }
  ).getHttpServer();
  server.on(
    "request",
    (
      request: { url: string; method: string },
      response: { statusCode: number; on(event: string, fn: () => void): void },
    ) => {
      const path = new URL(request.url, api.url).pathname;
      if (path.endsWith("/room"))
        response.on("finish", () => {
          const row = {
            path,
            status: response.statusCode,
            at: new Date().toISOString(),
            database: api.database,
            apiOrigin: api.url,
          };
          ssr.push(row);
          countOperation("actual owned API room HTTP response", row);
        });
    },
  );
  async function close() {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      countOperation("stop exact owned production Next child", {
        pid: child.pid,
        root: countRoot,
      });
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill();
      await exited;
    }
    await api.close();
  }
  try {
    for (const [host, app] of [
      ["admin", "admin"],
      ["academy", "portal"],
      ["doctor", "doctor"],
    ]) {
      const port = await freePort();
      origins[host!] = `http://localhost:${port}`;
      assets[host!] = authoringTree(resolve(countRoot, `apps/${app}/.next`));
    }
    process.env.E2E_ADMIN_URL = origins.admin;
    for (const [host, app] of [
      ["admin", "admin"],
      ["academy", "portal"],
      ["doctor", "doctor"],
    ]) {
      const appRoot = resolve(countRoot, `apps/${app}`);
      const cli = createRequire(resolve(appRoot, "package.json")).resolve(
        "next/dist/bin/next",
      );
      const port = new URL(origins[host!]!).port;
      countOperation("start owned production Next child", {
        host,
        appRoot,
        port,
        apiOrigin: api.url,
        database: api.database,
        assetsSha256: assets[host!],
      });
      const log = openSync(
        resolve(countDirectory(), `${host}.private.log`),
        "a",
      );
      const child = spawn(
        process.execPath,
        [cli, "start", "-p", port, "-H", "127.0.0.1"],
        {
          cwd: appRoot,
          windowsHide: true,
          env: {
            ...process.env,
            API_PROXY_TARGET: api.url,
            INTERNAL_API_URL: api.url,
            ACADEMY_PUBLIC_ORIGIN: origins.academy,
            DOCTOR_PUBLIC_ORIGIN: origins.doctor,
          },
          stdio: ["ignore", log, log],
        },
      );
      children.push(child);
      countOperation("record exact owned production child", {
        host,
        pid: child.pid,
        port,
        appRoot,
        head: api.head,
      });
      await expect
        .poll(
          async () => {
            if (child.exitCode !== null)
              throw new Error(`Owned ${host} exited ${child.exitCode}`);
            countOperation("probe own Next HTTP readiness", {
              origin: origins[host!],
            });
            try {
              return (await fetch(origins[host!]!)).status;
            } catch {
              return 0;
            }
          },
          { timeout: 30000, intervals: [1000] },
        )
        .toBeGreaterThan(0);
    }
    authoringCapture("runtime-provenance.json", {
      head: api.head,
      root: countRoot,
      origins,
      assets,
      children: children.map((child) => child.pid),
      apiOrigin: api.url,
      database: api.database,
    });
    return { api, origins, assets, ssr, close, noSniffingUnitPassed: true };
  } catch (error) {
    await close();
    throw error;
  }
}
export type AuthoringRuntime = Awaited<
  ReturnType<typeof bootEventAuthoringRuntime>
>;
