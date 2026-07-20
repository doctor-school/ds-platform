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

  // #1125 — a well-formed embed that the provider silently refuses (YouTube
  // geo-blocked in RU, or «Allow embedding» disabled on the broadcast) renders a
  // black iframe the app cannot detect cross-origin. So alongside the embed `src`
  // the resolver ALSO yields the provider-correct DIRECT watch URL, surfaced as an
  // always-present truthful escape hatch beneath the player.
  it("EARS-2.1: resolves the provider-correct direct watch URL for YouTube", () => {
    const embed = resolveEmbed({ provider: "youtube", embedRef: "NSVn97_5BXc" });
    expect(embed).toMatchObject({
      kind: "youtube",
      src: "https://www.youtube.com/embed/NSVn97_5BXc",
      directUrl: "https://www.youtube.com/watch?v=NSVn97_5BXc",
    });
  });

  it("EARS-2.1: resolves the provider-correct direct watch URL for Rutube", () => {
    const embed = resolveEmbed({
      provider: "rutube",
      embedRef: "caafe83ff1c6ed38d394635b83ece578",
    });
    expect(embed).toMatchObject({
      kind: "rutube",
      src: "https://rutube.ru/play/embed/caafe83ff1c6ed38d394635b83ece578",
      directUrl: "https://rutube.ru/video/caafe83ff1c6ed38d394635b83ece578/",
    });
  });

  it("EARS-2.1: the ids are URL-encoded into the direct watch URL", () => {
    const embed = resolveEmbed({ provider: "youtube", embedRef: "a b/c" });
    expect(embed).toMatchObject({
      directUrl: "https://www.youtube.com/watch?v=a%20b%2Fc",
    });
  });

  it("EARS-2.1: the unavailable state carries no direct URL (nothing to link to)", () => {
    expect(resolveEmbed(null)).toEqual({ kind: "unavailable" });
    expect(resolveEmbed(null)).not.toHaveProperty("directUrl");
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
