import { describe, expect, it } from "vitest";
import {
  botApiChannelId,
  mapExportMessage,
  parseTelegramExport,
  type TelegramExportMessage,
} from "./telegram-history-export.js";

// 048 EARS-30 (#3995) — the pure half of the one-off history import: the
// whole-file validation of a Telegram Desktop JSON export and the mapping of
// an exported message onto the EARS-26 card (048-design «One-off history
// import (EARS-30)»). Fixtures are shaped after the tdesktop JSON writer
// (export_output_json.cpp); no real channel content. The command suite
// (`test/materials/telegram-history-import.e2e-spec.ts`) proves the writes.

const message = (extra: Record<string, unknown>): TelegramExportMessage =>
  ({
    id: 900,
    type: "message",
    date: "2025-11-01T10:00:00",
    date_unixtime: "1761991200",
    from: "BBM Academy",
    from_id: "channel1234567890",
    text: "",
    text_entities: [],
    ...extra,
  }) as TelegramExportMessage;

const exportFile = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "BBM Academy",
    type: "public_channel",
    id: 1234567890,
    messages: [message({ text: "Пост" })],
    ...extra,
  });

describe("048 Telegram history export", () => {
  it("048 EARS-30: when the file does not parse, the system shall refuse it with its reason", () => {
    const parsed = parseTelegramExport("{ not json");
    expect(parsed).toEqual({
      ok: false,
      reason: expect.stringMatching(/parse/i),
    });
  });

  it("048 EARS-30: when the file is not a channel export, the system shall refuse it", () => {
    for (const type of ["private_supergroup", "personal_chat", undefined]) {
      const parsed = parseTelegramExport(exportFile({ type }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toMatch(/not a channel export/);
    }
    // A full-account export (chats list) is not a single-channel export.
    const account = parseTelegramExport(
      JSON.stringify({ chats: { list: [] } }),
    );
    expect(account.ok).toBe(false);
  });

  it("048 EARS-30: when any message lacks a field the import reads, the system shall refuse the whole file", () => {
    const parsed = parseTelegramExport(
      exportFile({
        messages: [message({ text: "ok" }), { id: 901, type: "message" }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/messages\.1/);
  });

  it("048 EARS-30: when the file is a public or private channel export, the system shall accept it with its bare id and messages", () => {
    for (const type of ["public_channel", "private_channel"]) {
      const parsed = parseTelegramExport(exportFile({ type }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.export.id).toBe(1234567890);
        expect(parsed.export.messages).toHaveLength(1);
      }
    }
  });

  it("048 EARS-30: when the export id is compared with the bound id, the system shall convert the bare channel id to the Bot API -100 form", () => {
    expect(botApiChannelId(1234567890)).toBe(-1001234567890n);
    expect(botApiChannelId(1)).toBe(-1000000000001n);
  });

  it("048 EARS-30: when an exported message has text, the system shall map it under EARS-26 with its Telegram date", () => {
    const mapped = mapExportMessage(
      message({
        text: ["Сегодня ", { type: "bold", text: "в  19:00" }, "\n\nэфир"],
      }),
    );
    expect(mapped).toEqual({
      kind: "card",
      card: {
        messageId: 900,
        text: "Сегодня в 19:00 эфир",
        publishedAt: new Date(1761991200 * 1000),
        mediaGroupId: null,
        durationSeconds: null,
        preview: null,
      },
    });
  });

  it("048 EARS-30: when an exported photo or video carries a caption, the system shall take its preview from the exported photo or video thumbnail file", () => {
    const photo = mapExportMessage(
      message({
        text: "Фото",
        photo: "photos/photo_1@01-11-2025_10-00-00.jpg",
      }),
    );
    expect(photo).toMatchObject({
      kind: "card",
      card: {
        preview: {
          kind: "file",
          path: "photos/photo_1@01-11-2025_10-00-00.jpg",
        },
        durationSeconds: null,
      },
    });
    const video = mapExportMessage(
      message({
        text: "Видео",
        file: "(File not included. Change data exporting settings to download.)",
        thumbnail: "video_files/clip.mp4_thumb.jpg",
        media_type: "video_file",
        mime_type: "video/mp4",
        duration_seconds: 125,
      }),
    );
    expect(video).toMatchObject({
      kind: "card",
      card: {
        preview: { kind: "file", path: "video_files/clip.mp4_thumb.jpg" },
        durationSeconds: 125,
      },
    });
  });

  it("048 EARS-30: when an exported photo was not included in the export, the system shall map the card with a preview that was not exported", () => {
    const mapped = mapExportMessage(
      message({
        text: "Фото",
        photo:
          "(File not included. Change data exporting settings to download.)",
      }),
    );
    expect(mapped).toMatchObject({
      kind: "card",
      card: { preview: { kind: "not_exported" } },
    });
  });

  it("048 EARS-30: when an exported photo or video has no text, the system shall skip it as media with no text", () => {
    expect(mapExportMessage(message({ photo: "photos/p.jpg" }))).toEqual({
      kind: "media_no_text",
    });
    expect(
      mapExportMessage(
        message({
          media_type: "video_file",
          file: "video_files/v.mp4",
          duration_seconds: 3,
        }),
      ),
    ).toEqual({ kind: "media_no_text" });
  });

  it("048 EARS-30: when an exported message is a service message, a forward or other content, the system shall drop it with its reason", () => {
    expect(
      mapExportMessage(
        message({ type: "service", action: "pin_message", text: "" }),
      ),
    ).toEqual({ kind: "drop", reason: "service_message" });
    expect(
      mapExportMessage(message({ text: "Репост", forwarded_from: "Другой" })),
    ).toEqual({ kind: "drop", reason: "forward" });
    expect(
      mapExportMessage(message({ text: "Скрытый", forwarded_from: null })),
    ).toEqual({ kind: "drop", reason: "forward" });
    expect(mapExportMessage({ id: 905, type: "unsupported" })).toEqual({
      kind: "drop",
      reason: "unsupported_content",
    });
    for (const extra of [
      { media_type: "sticker", file: "stickers/s.webp" },
      { media_type: "voice_message", file: "voice/v.ogg" },
      { media_type: "animation", file: "gifs/a.mp4" },
      { file: "files/doc.pdf", mime_type: "application/pdf" },
      { poll: { question: "?" } },
      { contact_information: { first_name: "x" } },
      { location_information: { latitude: 1, longitude: 2 } },
    ]) {
      expect(mapExportMessage(message({ text: "x", ...extra }))).toEqual({
        kind: "drop",
        reason: "unsupported_content",
      });
    }
    expect(mapExportMessage(message({ text: "" }))).toEqual({
      kind: "drop",
      reason: "empty",
    });
  });
});
