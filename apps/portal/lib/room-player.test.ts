import { describe, expect, it } from "vitest";
import type { StreamConfig } from "@ds/schemas";
import { resolveEmbed } from "./room-player";

// 006 EARS-2 — the portal instantiates the embed player by switching on the
// explicit provider enum carried in `RoomConfig.stream`, never by sniffing the
// embed reference. Unknown/absent → the truthful "stream unavailable" state.
describe("006 EARS-2 resolveEmbed — provider enum → embed frame, never URL-sniffed", () => {
  it("EARS-2: builds the YouTube embed frame from the enum + embedRef", () => {
    const stream: StreamConfig = {
      provider: "youtube",
      embedRef: "dQw4w9WgXcQ",
    };
    const embed = resolveEmbed(stream);
    expect(embed.kind).toBe("youtube");
    expect(embed).toMatchObject({
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("EARS-2: builds the Rutube embed frame from the enum + embedRef", () => {
    const stream: StreamConfig = {
      provider: "rutube",
      embedRef: "caafe83ff1c6ed38d394635b83ece578",
    };
    const embed = resolveEmbed(stream);
    expect(embed.kind).toBe("rutube");
    expect(embed).toMatchObject({
      src: "https://rutube.ru/play/embed/caafe83ff1c6ed38d394635b83ece578",
    });
  });

  it("EARS-2: an absent stream yields the 'stream unavailable' state (never a guessed embed)", () => {
    expect(resolveEmbed(null)).toEqual({ kind: "unavailable" });
    expect(resolveEmbed(undefined)).toEqual({ kind: "unavailable" });
  });

  it("EARS-2: the provider is honoured from the enum, not sniffed from a URL-shaped embedRef", () => {
    // embedRef looks like a YouTube URL but the enum says rutube: keying on the
    // enum yields the rutube frame, a sniffing implementation would pick youtube.
    const stream = {
      provider: "rutube",
      embedRef: "youtube.com/watch?v=dQw4w9WgXcQ",
    } as StreamConfig;
    expect(resolveEmbed(stream).kind).toBe("rutube");
  });
});
