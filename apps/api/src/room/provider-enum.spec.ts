import { describe, expect, it } from "vitest";
import {
  RoomConfigSchema,
  STREAM_PROVIDERS,
  type StreamConfig,
} from "@ds/schemas";
import { resolveRoomStream } from "./provider-enum.js";

// 006 EARS-2 — the embed player is instantiated from the event stream config's
// EXPLICIT provider enum (`rutube | youtube`), never by sniffing the stream URL.
// `resolveRoomStream` is the pure read the `RoomConfig` grant carries into the
// portal: it takes the 007-authored stream config (or its absence) and yields
// either the enum-typed `{ provider, embedRef }` the room switches the player on,
// or `null` — the truthful "stream unavailable" room state — for an unknown or
// absent provider. The provider is ALWAYS read from the closed enum; the embedRef
// (a provider-scoped id, possibly URL-shaped) is NEVER inspected to guess it (the
// legacy URL-sniffing mistake, requirements Constraints / design §3).
//
// The describe prefix `006 EARS-2 ` is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope (see the 005 e2e precedent).
describe("006 EARS-2 embed provider resolution — explicit enum, never URL-sniffed", () => {
  it("EARS-2: reads the provider from the closed enum for each configured provider", () => {
    const cases: Record<(typeof STREAM_PROVIDERS)[number], string> = {
      rutube: "caafe83ff1c6ed38d394635b83ece578",
      youtube: "dQw4w9WgXcQ",
    };
    for (const provider of STREAM_PROVIDERS) {
      const config: StreamConfig = { provider, embedRef: cases[provider] };
      expect(resolveRoomStream(config)).toEqual({
        provider,
        embedRef: cases[provider],
      });
    }
  });

  it("EARS-2: an unknown provider (outside the closed enum) yields the 'stream unavailable' state, never a guessed embed", () => {
    // A drifted / out-of-enum provider value fails CLOSED — the room never falls
    // back to sniffing the embedRef to guess which player to build.
    const unknown = {
      provider: "vimeo",
      embedRef: "123456789",
    } as unknown as StreamConfig;
    expect(resolveRoomStream(unknown)).toBeNull();
  });

  it("EARS-2: an absent stream config yields the 'stream unavailable' state", () => {
    // 007's stream config is a tracked seam: until it is authored (or when it is
    // incomplete) the room shows the truthful unavailable state, not a guess.
    expect(resolveRoomStream(null)).toBeNull();
    expect(resolveRoomStream(undefined)).toBeNull();
  });

  it("EARS-2: the provider is honoured from the enum even when the embedRef looks like a DIFFERENT provider's URL (never URL-sniffed)", () => {
    // The embedRef here is a YouTube-shaped watch URL, but the explicit provider
    // is `rutube`. A URL-sniffing implementation would return `youtube`; reading
    // the enum returns `rutube`. This is the anti-sniff assertion.
    const config = {
      provider: "rutube",
      embedRef: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as unknown as StreamConfig;
    expect(resolveRoomStream(config)?.provider).toBe("rutube");
  });

  it("EARS-2: the RoomConfig grant carries the resolved stream additively (nullable), and the stream provider is the closed enum", () => {
    // The grant is the EARS-1 shape extended ADDITIVELY with the stream section
    // (EARS-2) and the chat credential (EARS-3, nullable — `chat: null` when
    // Centrifugo is unconfigured). A gated caller for an event with a configured
    // stream carries it; an event with no / unknown stream config carries
    // `stream: null` (still a valid grant — the gate passed — rendering the
    // "stream unavailable" room state).
    const withStream = RoomConfigSchema.safeParse({
      eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      heartbeatIntervalSeconds: 60,
      stream: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
      chat: null,
    });
    expect(withStream.success).toBe(true);

    const unavailable = RoomConfigSchema.safeParse({
      eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      heartbeatIntervalSeconds: 60,
      stream: null,
      chat: null,
    });
    expect(unavailable.success).toBe(true);

    // A provider outside the closed enum is rejected at the grant boundary.
    const badProvider = RoomConfigSchema.safeParse({
      eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      heartbeatIntervalSeconds: 60,
      stream: { provider: "vimeo", embedRef: "x" },
      chat: null,
    });
    expect(badProvider.success).toBe(false);
  });
});
