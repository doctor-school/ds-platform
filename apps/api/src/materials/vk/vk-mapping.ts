import { FEED_ENTRY_TITLE_MAX } from "@ds/db";
import { vkVideoHref, vkWallPostHref } from "@ds/schemas";
import { cutPostText } from "../telegram/telegram-post-mapping.js";
import type { VkImage, VkVideo, VkWallPost } from "./vk-api.types.js";

// 048 EARS-41, EARS-42 (#4004) — a VK wall post or video → the card fields of
// its entry (048-design «Post and video mapping»), or the reason it is
// dropped. Pure: the writer (`vk.feed-source.ts`) applies the dedup of
// EARS-43. Only card fields leave this module (EARS-51).

/** The widest preview the card takes (EARS-41, EARS-42). */
export const VK_PREVIEW_MAX_WIDTH = 1280;

export type VkPostDropReason =
  "repost" | "not_published" | "empty" | "other_owner";

export type VkVideoDropReason =
  "other_owner" | "live" | "other_video_type" | "no_title" | "incomplete";

export interface VkPostCard {
  postId: number;
  /** EARS-41 — the plain text, cut to 500 with «…»; may be empty. */
  title: string;
  publishedAt: Date;
  imageUrl: string | null;
  durationSeconds: number | null;
  href: string;
  /** The own-community videos attached to the post — their EARS-43 keys. */
  videoIds: number[];
}

export interface VkVideoCard {
  videoId: number;
  title: string;
  publishedAt: Date;
  imageUrl: string | null;
  durationSeconds: number;
  href: string;
}

/**
 * EARS-41, EARS-42 — the largest size at most 1280 px wide, else the
 * smallest; `null` with none.
 */
export function choosePreview(images: readonly VkImage[]): string | null {
  if (images.length === 0) return null;
  const fitting = images.filter((i) => i.width <= VK_PREVIEW_MAX_WIDTH);
  const pick = fitting.length
    ? fitting.reduce((a, b) => (b.width > a.width ? b : a))
    : images.reduce((a, b) => (b.width < a.width ? b : a));
  return pick.url;
}

/** 048-design «Text» — VK's inline mention `[id…|name]` / `[club…|name]` reduced to its name. */
export function plainVkText(raw: string): string {
  return raw.replace(/\[(?:id|club|public)\d+\|([^\]]*)\]/gu, "$1");
}

/**
 * EARS-42 — a video title trimmed and, over 160 characters, cut at the last
 * word boundary so that it ends in «…» within 160 (counted in code points,
 * like Postgres `char_length`).
 */
export function cutVideoTitle(raw: string): string {
  const text = raw.trim();
  const chars = Array.from(text);
  if (chars.length <= FEED_ENTRY_TITLE_MAX) return text;
  const room = FEED_ENTRY_TITLE_MAX - 1;
  const head = chars.slice(0, room);
  let end = room;
  if (chars[room] !== " ") {
    const lastSpace = head.lastIndexOf(" ");
    if (lastSpace > 0) end = lastSpace;
  }
  return `${head.slice(0, end).join("").trimEnd()}…`;
}

/** EARS-41 — a processed wall post of community `groupId`. */
export function mapWallPost(
  post: VkWallPost,
  groupId: number,
): { card: VkPostCard } | { dropped: VkPostDropReason } {
  if (post.owner_id !== -groupId) return { dropped: "other_owner" };
  if (post.copy_history.length > 0 || post.post_type === "copy") {
    return { dropped: "repost" };
  }
  if (post.post_type !== "post") return { dropped: "not_published" };
  const title = cutPostText(plainVkText(post.text));
  const photo = post.attachments.find((a) => a.type === "photo");
  const videos = post.attachments.flatMap((a) =>
    a.type === "video" && "video" in a ? [a.video] : [],
  );
  if (title === "" && !photo && videos.length === 0) {
    return { dropped: "empty" };
  }
  let imageUrl: string | null = null;
  let durationSeconds: number | null = null;
  if (photo && "photo" in photo) {
    imageUrl = choosePreview(photo.photo.sizes);
  } else if (videos[0]) {
    imageUrl = choosePreview(videos[0].image);
    durationSeconds = imageUrl === null ? null : (videos[0].duration ?? null);
  }
  return {
    card: {
      postId: post.id,
      title,
      publishedAt: new Date(post.date * 1000),
      imageUrl,
      durationSeconds,
      href: vkWallPostHref(groupId, post.id),
      videoIds: [
        ...new Set(
          videos.filter((v) => v.owner_id === -groupId).map((v) => v.id),
        ),
      ],
    },
  };
}

/** EARS-42 — a processed `video_new` of community `groupId`. */
export function mapVideo(
  video: VkVideo,
  groupId: number,
): { card: VkVideoCard } | { dropped: VkVideoDropReason } {
  if (video.owner_id !== -groupId) return { dropped: "other_owner" };
  if (video.live === true) return { dropped: "live" };
  if (video.type !== "video") return { dropped: "other_video_type" };
  const title = cutVideoTitle(video.title);
  if (title === "") return { dropped: "no_title" };
  if (video.duration === undefined || video.date === undefined) {
    return { dropped: "incomplete" };
  }
  return {
    card: {
      videoId: video.id,
      title,
      publishedAt: new Date(video.date * 1000),
      imageUrl: choosePreview(video.image),
      durationSeconds: video.duration,
      href: vkVideoHref(groupId, video.id),
    },
  };
}
