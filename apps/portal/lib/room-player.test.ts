import { describe, expect, it } from "vitest";
import type { StreamConfig } from "@ds/schemas";
import { resolveDirectUrl, resolveEmbed } from "./room-player";

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

  it("EARS-2: builds the VK embed frame by re-composing video_ext.php from the oid_id_hash triple", () => {
    const stream: StreamConfig = {
      provider: "vk",
      embedRef: "-9944999_456239622_5ee41bc00ebc765a",
    };
    const embed = resolveEmbed(stream);
    expect(embed.kind).toBe("vk");
    expect(embed).toMatchObject({
      src: "https://vk.com/video_ext.php?oid=-9944999&id=456239622&hash=5ee41bc00ebc765a",
    });
  });

  it("EARS-2: builds the CDNVideo embed frame from the provisioned player URL verbatim", () => {
    // CDNVideo has no bare stream id — embedRef IS the host-allowlisted player URL
    // (validated at the 007 SSOT boundary); the room embeds it verbatim (#1134).
    const url =
      "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190";
    const stream: StreamConfig = { provider: "cdnvideo", embedRef: url };
    const embed = resolveEmbed(stream);
    expect(embed.kind).toBe("cdnvideo");
    expect(embed).toMatchObject({ src: url });
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

// 006 EARS-2 — the provider-scoped DIRECT (non-embed) watch URL, derived from the
// same enum + embedRef contract. VK's watch URL drops the embed-only hash; CDNVideo
// has no distinct watch page, so its direct URL IS the player URL (#1134).
describe("006 EARS-2 resolveDirectUrl — provider-scoped direct watch link", () => {
  it("EARS-2: derives the direct watch URL per provider from the enum + embedRef", () => {
    expect(
      resolveDirectUrl({ provider: "rutube", embedRef: "caafe83ff1c6ed38d394635b83ece578" }),
    ).toBe("https://rutube.ru/video/caafe83ff1c6ed38d394635b83ece578/");
    expect(
      resolveDirectUrl({ provider: "youtube", embedRef: "dQw4w9WgXcQ" }),
    ).toBe("https://youtu.be/dQw4w9WgXcQ");
    // VK: literal `video` + `<oid>_<id>` (sign preserved), hash omitted.
    expect(
      resolveDirectUrl({
        provider: "vk",
        embedRef: "-9944999_456239622_5ee41bc00ebc765a",
      }),
    ).toBe("https://vk.com/video-9944999_456239622");
    // CDNVideo: no separate watch page — the player URL is the artifact.
    const url =
      "https://playercdn.cdnvideo.ru/aloha/players/iframe_moygorod_potok2_player.html";
    expect(resolveDirectUrl({ provider: "cdnvideo", embedRef: url })).toBe(url);
  });

  it("EARS-2: an absent stream has no direct URL (null, never a guessed link)", () => {
    expect(resolveDirectUrl(null)).toBeNull();
    expect(resolveDirectUrl(undefined)).toBeNull();
  });
});
