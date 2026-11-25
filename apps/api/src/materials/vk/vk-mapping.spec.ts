import { describe, expect, it } from "vitest";
import { VkVideoSchema, VkWallPostSchema } from "./vk-api.types.js";
import {
  choosePreview,
  cutVideoTitle,
  mapVideo,
  mapWallPost,
} from "./vk-mapping.js";

// 048 slice 3 (#4004) — the pure VK mapping of EARS-41 (wall post), EARS-42
// (video) and the EARS-51 strip of author fields at the parse.

const GID = 4242;
const img = (width: number) => ({
  url: `https://sun9-1.userapi.com/p${width}.jpg`,
  width,
  height: Math.round(width * 0.66),
});
const post = (over: Record<string, unknown> = {}) =>
  VkWallPostSchema.parse({
    id: 17,
    owner_id: -GID,
    date: 1_760_000_000,
    text: "Новая запись",
    post_type: "post",
    ...over,
  });
const video = (over: Record<string, unknown> = {}) =>
  VkVideoSchema.parse({
    id: 901,
    owner_id: -GID,
    title: "Лекция",
    date: 1_760_000_100,
    duration: 3725,
    image: [img(320), img(800), img(1920)],
    type: "video",
    ...over,
  });

describe("048 VK mapping", () => {
  it("048 EARS-41: when a wall post is a published post, the system shall map plain text, date, the first photo's largest size at most 1280 px and the permalink from the community id", () => {
    const mapped = mapWallPost(
      post({
        text: "Привет,   [club1|BBM Academy]\n\nмир",
        attachments: [
          {
            type: "photo",
            photo: {
              id: 1,
              owner_id: -GID,
              sizes: [img(130), img(1080), img(2560)],
            },
          },
          {
            type: "video",
            video: {
              id: 5,
              owner_id: -GID,
              title: "v",
              image: [img(640)],
              duration: 60,
            },
          },
        ],
      }),
      GID,
    );
    expect(mapped).toEqual({
      card: {
        postId: 17,
        title: "Привет, BBM Academy мир",
        publishedAt: new Date(1_760_000_000_000),
        imageUrl: img(1080).url,
        durationSeconds: null,
        href: `https://vk.com/wall-${GID}_17`,
        videoIds: [5],
      },
    });
  });

  it("048 EARS-41: when a post's text is long, the system shall cut it at a word boundary to 500 characters with «…»", () => {
    const mapped = mapWallPost(post({ text: "слово ".repeat(200) }), GID);
    if (!("card" in mapped)) throw new Error("dropped");
    expect(Array.from(mapped.card.title).length).toBeLessThanOrEqual(500);
    expect(mapped.card.title.endsWith("…")).toBe(true);
    expect(mapped.card.title).not.toContain("  ");
  });

  it("048 EARS-41: when a post has no photo, the system shall take the first video's cover and its duration; with no size at most 1280 px, the smallest", () => {
    const mapped = mapWallPost(
      post({
        attachments: [
          {
            type: "video",
            video: {
              id: 7,
              owner_id: -GID,
              title: "v",
              image: [img(1600), img(2400)],
              duration: 95,
            },
          },
        ],
      }),
      GID,
    );
    if (!("card" in mapped)) throw new Error("dropped");
    expect(mapped.card.imageUrl).toBe(img(1600).url);
    expect(mapped.card.durationSeconds).toBe(95);
    expect(choosePreview([])).toBeNull();
  });

  it("048 EARS-41: when a post is a repost, not published, empty or of another owner, the system shall drop it with its reason", () => {
    expect(mapWallPost(post({ copy_history: [{ id: 1 }] }), GID)).toEqual({
      dropped: "repost",
    });
    expect(mapWallPost(post({ post_type: "copy" }), GID)).toEqual({
      dropped: "repost",
    });
    for (const t of ["postpone", "suggest", "reply"]) {
      expect(mapWallPost(post({ post_type: t }), GID)).toEqual({
        dropped: "not_published",
      });
    }
    expect(
      mapWallPost(post({ text: "  ", attachments: [{ type: "link" }] }), GID),
    ).toEqual({ dropped: "empty" });
    expect(mapWallPost(post({ owner_id: -1 }), GID)).toEqual({
      dropped: "other_owner",
    });
  });

  it("048 EARS-42: when a video_new is a non-live video of the community, the system shall map title, date, cover, duration and the video permalink", () => {
    expect(mapVideo(video(), GID)).toEqual({
      card: {
        videoId: 901,
        title: "Лекция",
        publishedAt: new Date(1_760_000_100_000),
        imageUrl: img(800).url,
        durationSeconds: 3725,
        href: `https://vk.com/video-${GID}_901`,
      },
    });
  });

  it("048 EARS-42: when a video title is over 160 characters, the system shall cut it at a word boundary within 160 ending in «…»", () => {
    const cut = cutVideoTitle("видео ".repeat(60));
    expect(Array.from(cut).length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(cutVideoTitle("  Коротко  ")).toBe("Коротко");
  });

  it("048 EARS-42: when a video is live, another type, untitled or of another owner, the system shall drop it with its reason", () => {
    expect(mapVideo(video({ live: 1 }), GID)).toEqual({ dropped: "live" });
    expect(mapVideo(video({ type: "music_video" }), GID)).toEqual({
      dropped: "other_video_type",
    });
    expect(mapVideo(video({ title: " " }), GID)).toEqual({
      dropped: "no_title",
    });
    expect(mapVideo(video({ owner_id: -9 }), GID)).toEqual({
      dropped: "other_owner",
    });
  });

  it("048 EARS-51: the parsed post and video carry no created_by, signer_id or from_id", () => {
    const p = post({ created_by: 1, signer_id: 2, from_id: 3 });
    const v = video({ created_by: 1, player: "https://vk.com/video_ext.php" });
    for (const o of [p, v]) {
      expect(o).not.toHaveProperty("created_by");
      expect(o).not.toHaveProperty("signer_id");
      expect(o).not.toHaveProperty("from_id");
      expect(o).not.toHaveProperty("player");
    }
  });
});
