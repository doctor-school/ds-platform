import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import {
  pairSequence,
  firstFreePair,
  formatPair,
} from "../../dev/port-pair.mjs";

/**
 * Unit cover for `tools/dev/port-pair.mjs` (#428) — the per-session dev-server
 * port helper. Pure seams only (pair sequence, first-free selection, output
 * shape); the impure bind-probe is exercised once against a real ephemeral
 * listener below, without touching any port another session could be using.
 */
describe("port-pair pairSequence()", () => {
  it("starts at the single-session default 3000/3001 and steps by 100", () => {
    const pairs = pairSequence();
    expect(pairs[0]).toEqual([3000, 3001]);
    expect(pairs[1]).toEqual([3100, 3101]);
    expect(pairs.at(-1)).toEqual([3900, 3901]);
    expect(pairs).toHaveLength(10);
  });
});

describe("port-pair firstFreePair()", () => {
  it("returns the first pair where BOTH ports probe free", async () => {
    const busy = new Set([3000, 3101]);
    const probe = async (port: number) => !busy.has(port);
    // 3000 busy → pair 0 out; 3101 busy → pair 1 out; 3200/3201 free.
    await expect(firstFreePair(pairSequence(), probe)).resolves.toEqual([
      3200, 3201,
    ]);
  });

  it("returns null when every pair is (partially) taken", async () => {
    const probe = async (port: number) => port % 100 === 1; // every api port busy
    await expect(firstFreePair(pairSequence(), probe)).resolves.toBeNull();
  });

  it("never reports a really-bound port as free (live probe, own listener)", async () => {
    // Bind an ephemeral port ourselves — probing OUR OWN listener is safe on a
    // shared box — and assert the real probe sees it busy.
    const { probePortFree } = await import("../../dev/port-pair.mjs");
    const srv = createServer();
    const port: number = await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, () => {
        const addr = srv.address();
        if (addr === null || typeof addr === "string")
          rej(new Error("no port"));
        else res(addr.port);
      });
    });
    try {
      await expect(probePortFree(port)).resolves.toBe(false);
    } finally {
      await new Promise((res) => srv.close(res));
    }
  });
});

describe("port-pair formatPair()", () => {
  it("emits ready-to-paste env lines + live URLs", () => {
    const lines = formatPair([3100, 3101]);
    expect(lines).toContain("API_PORT=3100");
    expect(lines).toContain("PORTAL_PORT=3101");
    expect(lines.join("\n")).toContain("http://localhost:3101");
  });
});
