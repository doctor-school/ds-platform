import { describe, expect, it } from "vitest";
import { FEED_POST_TEXT_MAX } from "@ds/db";
import {
  cutPostText,
  mapChannelPost,
  telegramPermalink,
} from "./telegram-post-mapping.js";
import type { TelegramMessage } from "./telegram-update.schema.js";

// 048 EARS-26 (#3994) — the pure mapping of one channel post into card data
// (048-design §Post mapping). The webhook suite proves the written entries.

const base = (extra: Partial<TelegramMessage>): TelegramMessage =>
  ({
    message_id: 1201,
    date: 1_763_000_000,
    chat: { id: -1001, type: "channel", username: "bbmacademy" },
    ...extra,
  }) as TelegramMessage;

const size = (width: number, id = `f${width}`) => ({
  file_id: id,
  file_unique_id: `u${id}`,
  width,
  height: Math.round(width * 0.75),
});

describe("048 Telegram post mapping", () => {
  it("048 EARS-26: when a post's text is long, the system shall keep plain text with whitespace collapsed, cut at a word boundary to 500 characters with «…»", () => {
    expect(cutPostText("  Сегодня\n\nв   19:00  ")).toBe("Сегодня в 19:00");
    const words = Array.from({ length: 200 }, (_, i) => `слово${i}`).join(" ");
    const cut = cutPostText(words);
    expect(cut.endsWith("…")).toBe(true);
    const body = cut.slice(0, -1);
    expect([...body].length).toBeLessThanOrEqual(FEED_POST_TEXT_MAX);
    expect(words.startsWith(body)).toBe(true);
    expect(words[body.length]).toBe(" ");
    // Code points, never a split surrogate pair.
    const emoji = "😀".repeat(600);
    const e = cutPostText(emoji);
    expect([...e].length).toBe(FEED_POST_TEXT_MAX + 1);
    expect(e.endsWith("😀…")).toBe(true);
    expect(cutPostText("a".repeat(FEED_POST_TEXT_MAX))).toBe(
      "a".repeat(FEED_POST_TEXT_MAX),
    );
  });

  it("048 EARS-26: when a processed post is a text, a photo or a video, the system shall map its text, date, preview, duration and permalink", () => {
    expect(
      mapChannelPost(
        base({
          text: "Привет",
          entities: [{ type: "bold", offset: 0, length: 6 }],
        }),
      ),
    ).toEqual({
      kind: "card",
      card: {
        messageId: 1201,
        text: "Привет",
        publishedAt: new Date(1_763_000_000_000),
        mediaGroupId: null,
        durationSeconds: null,
        preview: null,
      },
    });
    const photo = mapChannelPost(
      base({
        caption: "Фото",
        photo: [size(90), size(800), size(1280), size(2560)],
      }),
    );
    expect(photo).toMatchObject({
      kind: "card",
      card: {
        text: "Фото",
        preview: { fileId: "f1280", fileUniqueId: "uf1280" },
      },
    });
    // No size within 1280 px — the smallest one.
    expect(
      mapChannelPost(base({ photo: [size(2560), size(1600)] })),
    ).toMatchObject({ card: { text: "", preview: { fileId: "f1600" } } });
    const video = mapChannelPost(
      base({
        caption: "PRP",
        video: {
          file_id: "vid",
          file_unique_id: "uvid",
          width: 1280,
          height: 720,
          duration: 72,
          thumbnail: size(320, "thumb"),
        },
      }),
    );
    expect(video).toMatchObject({
      kind: "card",
      card: {
        text: "PRP",
        durationSeconds: 72,
        preview: { fileId: "thumb", fileUniqueId: "uthumb" },
      },
    });
    expect(telegramPermalink("bbmacademy", 1201)).toBe(
      "https://t.me/bbmacademy/1201",
    );
  });

  it("048 EARS-26: when a post is a forward, other content, a service message or empty, the system shall drop it with its reason", () => {
    const cases: Array<[Partial<TelegramMessage>, string]> = [
      [{ text: "x", forward_origin: { type: "channel" } }, "forward"],
      [{ poll: { id: "1" } }, "unsupported_content"],
      [{ sticker: { file_id: "s" } }, "unsupported_content"],
      [{ animation: {}, document: {}, caption: "gif" }, "unsupported_content"],
      [{ paid_media: {} }, "unsupported_content"],
      [{ pinned_message: {} }, "service_message"],
      [{ new_chat_title: "t" }, "service_message"],
      [{}, "empty"],
      [{ text: "   " }, "empty"],
    ];
    for (const [extra, reason] of cases) {
      expect(mapChannelPost(base(extra))).toEqual({ kind: "drop", reason });
    }
  });

  it("048 EARS-36: the mapped card carries no author signature", () => {
    const mapped = mapChannelPost(
      base({ text: "x", author_signature: "Иван Петров" } as never),
    );
    expect(JSON.stringify(mapped)).not.toContain("Иван");
  });
});
