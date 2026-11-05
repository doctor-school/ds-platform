import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  startMaterialTransport,
  ownedMaterialDatabase,
} from "./material-pages.js";

describe("048 material browser transport", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
  });

  it("EARS-12: faults one exact server read and forwards the subsequent real bytes", async () => {
    const upstreamReads: string[] = [];
    const upstream = createServer((req, res) => {
      upstreamReads.push(req.url!);
      res.writeHead(201, {
        "content-type": "text/plain",
        "x-origin": "upstream",
      });
      res.end(`actual upstream ${req.url}`);
    });
    await new Promise<void>((ok) => upstream.listen(0, "127.0.0.1", ok));
    cleanups.push(
      () =>
        new Promise<void>((ok, fail) =>
          upstream.close((e) => (e ? fail(e) : ok())),
        ),
    );
    const address = upstream.address() as { port: number };
    const transport = await startMaterialTransport(
      `http://127.0.0.1:${address.port}`,
      () => {},
    );
    cleanups.push(transport.stop);
    transport.failOnce("read-me");
    const other = await fetch(`${transport.url}/v1/public/materials/another`);
    expect(other.status).toBe(201);
    expect(await other.text()).toBe(
      "actual upstream /v1/public/materials/another",
    );
    expect(
      (await fetch(`${transport.url}/v1/public/materials/read-me`)).status,
    ).toBe(503);
    const retried = await fetch(`${transport.url}/v1/public/materials/read-me`);
    expect(retried.status).toBe(201);
    expect(retried.headers.get("x-origin")).toBe("upstream");
    expect(await retried.text()).toBe(
      "actual upstream /v1/public/materials/read-me",
    );
    expect(upstreamReads).toEqual([
      "/v1/public/materials/another",
      "/v1/public/materials/read-me",
    ]);
    expect(transport.reads).toEqual([
      { path: "/v1/public/materials/another", status: 201, injected: false },
      { path: "/v1/public/materials/read-me", status: 503, injected: true },
      { path: "/v1/public/materials/read-me", status: 201, injected: false },
    ]);
  });

  it("EARS-12: refuses a shared or different task database before starting any process", () => {
    expect(() =>
      ownedMaterialDatabase("postgres://user:password@localhost/ds_dev"),
    ).toThrow("#3702");
    expect(() =>
      ownedMaterialDatabase("postgres://user:password@localhost/ds_dev_3688"),
    ).toThrow("#3702");
    expect(
      ownedMaterialDatabase("postgres://user:password@localhost/ds_dev_3702"),
    ).toBe("postgres://user:password@localhost/ds_dev_3702");
    expect(
      ownedMaterialDatabase("postgres://user:password@localhost/ds_probe_3702"),
    ).toContain("ds_probe_3702");
  });
});
