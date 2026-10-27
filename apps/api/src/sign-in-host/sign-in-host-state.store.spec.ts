import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemorySignInHostStateStore,
  resolveEntryIntent,
} from "./sign-in-host-state.store.js";

// 003 EARS-71 — the entry intent is resolved at most once, only for its own
// client, and every unusable id is simply «no intent».
describe("entry intent (003 EARS-71)", () => {
  const key = randomBytes(32);
  const intent = {
    door: "login" as const,
    method: "code" as const,
    eventTarget: "spring-congress",
    handoff: "handoff-ref-abc",
    clientId: "doctor-client",
  };

  it("EARS-71: a live intent resolves once for its own client and is spent by that read", async () => {
    const store = new InMemorySignInHostStateStore(key);
    const id = await store.putIntent(intent, 600);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await resolveEntryIntent(store, id, "doctor-client")).toEqual(
      intent,
    );
    expect(
      await resolveEntryIntent(store, id, "doctor-client"),
    ).toBeUndefined();
  });

  it("EARS-71: a foreign client gets no intent, and the read still spends it", async () => {
    const store = new InMemorySignInHostStateStore(key);
    const id = await store.putIntent(intent, 600);
    expect(
      await resolveEntryIntent(store, id, "academy-client"),
    ).toBeUndefined();
    expect(
      await resolveEntryIntent(store, id, "doctor-client"),
    ).toBeUndefined();
  });

  it("EARS-71: an unknown, malformed, absent or expired id is no intent and no error", async () => {
    let now = 1_000_000;
    const store = new InMemorySignInHostStateStore(key, () => now);
    const id = await store.putIntent(intent, 60);
    now += 60_000;
    expect(
      await resolveEntryIntent(store, id, "doctor-client"),
    ).toBeUndefined();
    expect(
      await resolveEntryIntent(store, "A".repeat(43), "doctor-client"),
    ).toBeUndefined();
    expect(
      await resolveEntryIntent(store, "user@example.com", "doctor-client"),
    ).toBeUndefined();
    expect(
      await resolveEntryIntent(store, undefined, "doctor-client"),
    ).toBeUndefined();
  });

  it("EARS-71: the hand-off reference is sealed at rest, never stored plain", async () => {
    const store = new InMemorySignInHostStateStore(key);
    await store.putIntent(intent, 600);
    const stored = store.storedValues().join("\n");
    expect(stored).not.toContain("handoff-ref-abc");
    expect(stored).toContain('"handoff":"v1.');
  });
});

// 003 EARS-12 / EARS-41 — the subject revocation fence lives exactly as long
// as a record can.
describe("subject revocation fence (003 EARS-12)", () => {
  it("EARS-12: the revocation instant reads back until its TTL, then is gone", async () => {
    let now = 1_000_000;
    const store = new InMemorySignInHostStateStore(randomBytes(32), () => now);
    expect(await store.subjectRevokedAt("sub-1")).toBeNull();
    const at = new Date(now);
    await store.markSubjectRevoked("sub-1", at, 60);
    expect(await store.subjectRevokedAt("sub-1")).toEqual(at);
    expect(await store.subjectRevokedAt("sub-2")).toBeNull();
    now += 60_000;
    expect(await store.subjectRevokedAt("sub-1")).toBeNull();
  });
});

// 003 EARS-62 — the callback finds a transaction by its `state` too, so a
// callback without the browser's own cookie still spends it (single use,
// whichever way it is taken).
describe("storefront transaction by state (003 EARS-62)", () => {
  const tx = {
    client: "academy" as const,
    clientId: "academy-client",
    kind: "interactive" as const,
    door: "login" as const,
    state: "st4te-value",
    nonce: "n0nce",
    verifier: "v3rifier",
  };

  it("003 EARS-62: a transaction is taken once by its state, and then neither its state nor its id finds it", async () => {
    const store = new InMemorySignInHostStateStore(randomBytes(32));
    const id = await store.putTransaction(tx, 60);
    expect(await store.takeTransactionByState("another-state")).toBeNull();
    expect(await store.takeTransactionByState(tx.state)).toEqual(tx);
    expect(await store.takeTransactionByState(tx.state)).toBeNull();
    expect(await store.takeTransaction(id)).toBeNull();
  });

  it("003 EARS-62: a transaction taken by its id is no longer found by its state", async () => {
    const store = new InMemorySignInHostStateStore(randomBytes(32));
    const id = await store.putTransaction(tx, 60);
    expect(await store.takeTransaction(id)).toEqual(tx);
    expect(await store.takeTransactionByState(tx.state)).toBeNull();
  });

  it("003 EARS-62: the state index keeps no usable transaction id or state", async () => {
    const store = new InMemorySignInHostStateStore(randomBytes(32));
    const id = await store.putTransaction(tx, 60);
    const values = store.storedValues().join("\n");
    expect(values).not.toContain(id);
    expect(values).not.toContain(tx.state);
  });
});
