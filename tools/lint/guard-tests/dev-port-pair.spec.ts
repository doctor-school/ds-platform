import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import {
  portSetSequence,
  firstFreePortSet,
  formatPortSet,
} from "../../dev/port-pair.mjs";

/**
 * Unit cover for `tools/dev/port-pair.mjs` (#428; extended to the ADR-0015
 * (api, portal, doctor) triple in #1440) — the per-session dev-server port
 * helper. Pure seams only (set sequence, first-free selection, output shape);
 * the impure bind-probe is exercised once against a real ephemeral listener
 * below, without touching any port another session could be using.
 */
describe("port-pair portSetSequence()", () => {
  it("starts at the single-session default 3000/3001/3004 and steps by 100", () => {
    const sets = portSetSequence();
    expect(sets[0]).toEqual([3000, 3001, 3004]);
    expect(sets[1]).toEqual([3100, 3101, 3104]);
    expect(sets.at(-1)).toEqual([3900, 3901, 3904]);
    expect(sets).toHaveLength(10);
  });

  it("never claims 3002/3003 — the fixed showcase / academy-demo dev ports", () => {
    // The doctor offset is +4 for exactly this reason; a contiguous triple would
    // collide with those two apps in the default set.
    expect(portSetSequence()[0]).not.toContain(3002);
    expect(portSetSequence()[0]).not.toContain(3003);
  });
});

describe("port-pair firstFreePortSet()", () => {
  it("returns the first set where ALL ports probe free", async () => {
    const busy = new Set([3000, 3101]);
    const probe = async (port: number) => !busy.has(port);
    // 3000 busy → set 0 out; 3101 busy → set 1 out; 3200/3201/3204 free.
    await expect(firstFreePortSet(portSetSequence(), probe)).resolves.toEqual([
      3200, 3201, 3204,
    ]);
  });

  it("skips a set whose DOCTOR port alone is taken", async () => {
    const busy = new Set([3004]);
    const probe = async (port: number) => !busy.has(port);
    await expect(firstFreePortSet(portSetSequence(), probe)).resolves.toEqual([
      3100, 3101, 3104,
    ]);
  });

  it("returns null when every set is (partially) taken", async () => {
    const probe = async (port: number) => port % 100 === 1; // every api port busy
    await expect(firstFreePortSet(portSetSequence(), probe)).resolves.toBeNull();
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

describe("port-pair formatPortSet()", () => {
  it("emits ready-to-paste env lines + live URLs", () => {
    const lines = formatPortSet([3100, 3101, 3104]);
    expect(lines).toContain("API_PORT=3100");
    expect(lines).toContain("PORTAL_PORT=3101");
    expect(lines).toContain("DOCTOR_PORT=3104");
    expect(lines.join("\n")).toContain("http://localhost:3101");
    expect(lines.join("\n")).toContain("http://localhost:3104");
  });
});
