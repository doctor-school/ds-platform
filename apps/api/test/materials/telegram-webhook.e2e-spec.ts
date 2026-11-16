import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger, VersioningType } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FeedEntriesRepository } from "../../src/materials/feed-entries.repository.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import { TELEGRAM_BOT_API } from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  type TelegramConfig,
} from "../../src/materials/telegram/telegram-config.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-15 (#3994) — the Telegram webhook over the REAL stack (Fastify +
// Postgres) against the Telegram double: the secret check before the body is
// read and the 404 kill switch (EARS-24); matching, drops and idempotent
// re-delivery, 500 with nothing written on our own failure (EARS-25); the
// mapping (EARS-26), albums (EARS-27), edits (EARS-28) and the EARS-36
// hygiene of every log line and stored row. The webhook's only Bot API calls
// are the preview copy's `getFile` / download after the commit (EARS-29,
// `telegram-preview-check.e2e-spec.ts`); the double holds no file here, so
// each copy attempt fails, is counted and leaves the card imageless.
describe.skipIf(!process.env.DATABASE_URL)("048 Telegram webhook (e2e)", () => {
  const TOKEN = "123456:E2E-bot_token-value";
  const SECRET = "e2e_webhook-secret_0123";
  const SIGNATURE = "Иван Подписантов";
  const config: TelegramConfig = {
    botToken: TOKEN,
    webhookSecret: SECRET,
    webhookUrl: "https://api.example.test/v1/integrations/telegram/webhook",
  };
  const telegram = new FakeTelegramBotApi();
  let app: NestFastifyApplication;
  let offApp: NestFastifyApplication;
  let pool: pg.Pool;
  const sourceIds: string[] = [];
  const logged: string[] = [];
  let updateSeq = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  const base = Math.floor(Date.now() / 1000) - 3600;

  async function boot(cfg: TelegramConfig | null) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .overrideProvider(TELEGRAM_CONFIG)
      .useValue(cfg)
      .overrideProvider(TELEGRAM_BOT_API)
      .useValue(telegram)
      .compile();
    const a = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
    return a;
  }

  /** A fresh valid channel username and a negative channel id. */
  const username = () =>
    `c${Math.random().toString(36).slice(2, 8)}${Math.random()
      .toString(36)
      .slice(2, 7)}`.padEnd(12, "x");
  const chatId = () => -1_000_000_000_000 - Math.floor(Math.random() * 1e9);

  async function source(opts: { enabled?: boolean } = {}) {
    const address = username();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO feed_sources (platform, address, enabled)
         VALUES ('telegram', $1, $2) RETURNING id`,
      [address, opts.enabled ?? true],
    );
    sourceIds.push(rows[0]!.id);
    return { id: rows[0]!.id, address, chatId: chatId() };
  }
  type Src = Awaited<ReturnType<typeof source>>;

  function message(
    src: Src,
    messageId: number,
    extra: Record<string, unknown> = {},
  ) {
    return {
      message_id: messageId,
      date: base + messageId,
      chat: {
        id: src.chatId,
        type: "channel",
        username: src.address,
        title: "BBM Academy",
      },
      sender_chat: { id: src.chatId, type: "channel" },
      author_signature: SIGNATURE,
      ...extra,
    };
  }

  const photo = (id: string, widths = [90, 800, 1280, 2560]) =>
    widths.map((w) => ({
      file_id: `${id}-${w}`,
      file_unique_id: `u-${id}-${w}`,
      width: w,
      height: w,
    }));

  function deliver(
    body: unknown,
    opts: { secret?: string | null; target?: NestFastifyApplication } = {},
  ) {
    const secret = opts.secret === undefined ? SECRET : opts.secret;
    return (opts.target ?? app).inject({
      method: "POST",
      url: "/v1/integrations/telegram/webhook",
      headers: {
        "content-type": "application/json",
        ...(secret === null
          ? {}
          : { "x-telegram-bot-api-secret-token": secret }),
      },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const post = (msg: unknown) => ({
    update_id: ++updateSeq,
    channel_post: msg,
  });
  const edit = (msg: unknown) => ({
    update_id: ++updateSeq,
    edited_channel_post: msg,
  });

  interface EntryRow {
    id: string;
    kind: string;
    source_platform: string;
    source_ref: string;
    title: string;
    href: string;
    published_at: Date;
    source_name: string;
    partner_organisation_id: string | null;
    image_ref: string | null;
    image_url: string | null;
    media_group_id: string | null;
    duration_seconds: number | null;
    preview_file_id: string | null;
    preview_file_unique_id: string | null;
    preview_state: string | null;
    preview_attempts: number;
    hidden_at: Date | null;
    updated_at: Date;
  }

  async function entries(src: Src): Promise<EntryRow[]> {
    const { rows } = await pool.query<EntryRow>(
      "SELECT * FROM feed_entries WHERE feed_source_id = $1 ORDER BY source_ref",
      [src.id],
    );
    return rows;
  }

  async function messageIds(entryId: string): Promise<number[]> {
    const { rows } = await pool.query<{ message_id: string }>(
      "SELECT message_id FROM feed_entry_messages WHERE feed_entry_id = $1 ORDER BY message_id",
      [entryId],
    );
    return rows.map((r) => Number(r.message_id));
  }

  async function boundId(src: Src): Promise<string | null> {
    const { rows } = await pool.query<{ telegram_chat_id: string | null }>(
      "SELECT telegram_chat_id FROM feed_sources WHERE id = $1",
      [src.id],
    );
    return rows[0]!.telegram_chat_id;
  }

  /** The drop lines of the log, parsed. */
  const drops = () =>
    logged
      .filter((l) => l.includes("telegram_update_dropped"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    app = await boot(config);
    offApp = await boot(null);
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
  });

  beforeEach(() => {
    logged.length = 0;
    telegram.reset();
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (...args: unknown[]) => {
          logged.push(
            args
              .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
              .join(" "),
          );
        },
      );
    }
  });

  afterEach(async () => {
    // EARS-36 — no log line of any test carries a secret, the author or a payload.
    const all = logged.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(SIGNATURE);
    // The webhook calls the Bot API only for the preview copy (EARS-29).
    expect(
      telegram.calls.filter(
        (c) => c.method !== "getFile" && c.method !== "downloadFile",
      ),
    ).toEqual([]);
    vi.restoreAllMocks();
    for (const id of sourceIds.splice(0)) {
      await pool.query(
        "DELETE FROM feed_entry_messages WHERE feed_source_id = $1",
        [id],
      );
      await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
        id,
      ]);
      await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
    }
  });

  afterAll(async () => {
    await offApp?.close();
    await app?.close();
  });

  // ── EARS-24: the secret and the kill switch ─────────────────────────

  it("048 EARS-24: when a webhook request's secret header is absent or differs, the system shall answer 401 before reading the body and store nothing", async () => {
    const src = await source();
    const body = post(message(src, 1201, { text: "Пост" }));
    expect((await deliver(body, { secret: null })).statusCode).toBe(401);
    expect((await deliver(body, { secret: "wrong" })).statusCode).toBe(401);
    expect((await deliver(body, { secret: `${SECRET}x` })).statusCode).toBe(
      401,
    );
    // The body is never parsed: a malformed JSON body still gets the 401.
    const res = await deliver("{not json", { secret: "wrong" });
    expect(res.statusCode).toBe(401);
    expect(res.payload).not.toContain(SECRET);
    expect(await entries(src)).toEqual([]);
    expect(await boundId(src)).toBeNull();
  });

  it("048 EARS-24: while the bot token or the webhook secret is not configured, the system shall answer 404 on the webhook route", async () => {
    const src = await source();
    const res = await deliver(post(message(src, 1201, { text: "Пост" })), {
      target: offApp,
    });
    expect(res.statusCode).toBe(404);
    expect(await entries(src)).toEqual([]);
  });

  // ── EARS-25: matching, drops, idempotency, our own failure ──────────

  it("048 EARS-25: when an update's channel is unlisted, switched off, of another type or malformed, the system shall answer 200, drop it and log its ids and reason only", async () => {
    const off = await source({ enabled: false });
    const stranger: Src = {
      id: "-",
      address: "somebodyelse",
      chatId: chatId(),
    };
    const cases: Array<[unknown, string]> = [
      [post(message(stranger, 77, { text: "Чужой" })), "unlisted"],
      [post(message(off, 78, { text: "Выключен" })), "source_off"],
      [
        { update_id: ++updateSeq, message: message(off, 79, { text: "ЛС" }) },
        "other_update_type",
      ],
      [
        { update_id: ++updateSeq, channel_post: { text: "нет id" } },
        "malformed",
      ],
    ];
    for (const [body, reason] of cases) {
      const res = await deliver(body);
      expect(res.statusCode, res.payload).toBe(200);
      expect(drops().at(-1)?.reason).toBe(reason);
    }
    for (const line of drops()) {
      expect(Object.keys(line).sort()).toEqual(
        ["chatId", "event", "messageId", "reason", "updateId"].sort(),
      );
    }
    expect(drops()[0]).toMatchObject({
      chatId: stranger.chatId,
      messageId: 77,
    });
    expect(JSON.stringify(drops())).not.toMatch(/Чужой|Выключен/);
    expect(await entries(off)).toEqual([]);
    const { rows } = await pool.query(
      "SELECT 1 FROM feed_entries WHERE href LIKE 'https://t.me/somebodyelse/%'",
    );
    expect(rows).toEqual([]);
  });

  it("048 EARS-25: when a listed channel first posts, the system shall match it by username and bind its id; from then on the id decides", async () => {
    const src = await source();
    expect(
      (await deliver(post(message(src, 10, { text: "Первый" })))).statusCode,
    ).toBe(200);
    expect(await boundId(src)).toBe(String(src.chatId));
    // A rename keeps delivering by the bound id.
    const renamed = message(src, 11, { text: "После переименования" });
    renamed.chat.username = "renamedchannel";
    expect((await deliver(post(renamed))).statusCode).toBe(200);
    expect((await entries(src)).map((e) => e.title)).toEqual([
      "Первый",
      "После переименования",
    ]);
    // Another channel claiming the bound source's username does not match.
    const impostor = message({ ...src, chatId: chatId() }, 12, {
      text: "Самозванец",
    });
    await deliver(post(impostor));
    expect(drops().at(-1)?.reason).toBe("unlisted");
    expect(await entries(src)).toHaveLength(2);
  });

  it("048 EARS-25: when a post already processed is delivered again, the system shall change nothing", async () => {
    const src = await source();
    const body = post(message(src, 20, { text: "Один раз" }));
    expect((await deliver(body)).statusCode).toBe(200);
    const [before] = await entries(src);
    expect((await deliver(body)).statusCode).toBe(200);
    expect(
      (await deliver(post(message(src, 20, { text: "Один раз" })))).statusCode,
    ).toBe(200);
    const after = await entries(src);
    expect(after).toHaveLength(1);
    expect(after[0]!.updated_at).toEqual(before!.updated_at);
    expect(await messageIds(before!.id)).toEqual([20]);
  });

  it("048 EARS-25: when processing fails on our side, the system shall answer 500 and write nothing partial", async () => {
    const src = await source();
    vi.spyOn(
      FeedEntriesRepository.prototype,
      "attachTelegramMessage",
    ).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    const body = post(message(src, 30, { text: "Сбой" }));
    const res = await deliver(body);
    expect(res.statusCode).toBe(500);
    expect(res.payload).not.toContain("Сбой");
    expect(await entries(src)).toEqual([]);
    expect(await boundId(src)).toBeNull();
    // Telegram's redelivery then lands once.
    expect((await deliver(body)).statusCode).toBe(200);
    expect(await entries(src)).toHaveLength(1);
  });

  // ── EARS-26: the mapping ─────────────────────────────────────────────

  it("048 EARS-26: when a processed post is a text, a photo or a video, the system shall write one post entry with its plain text, date, preview, duration and permalink and no partner", async () => {
    const src = await source();
    const long = Array.from({ length: 150 }, (_, i) => `слово${i}`).join(" ");
    await deliver(
      post(
        message(src, 1200, {
          text: `  ${long}  `,
          entities: [{ type: "bold", offset: 0, length: 5 }],
        }),
      ),
    );
    await deliver(
      post(
        message(src, 1201, {
          caption: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
          photo: photo("p1201"),
        }),
      ),
    );
    await deliver(
      post(
        message(src, 1202, {
          caption: "PRP при гонартрозе — фрагмент эфира",
          video: {
            file_id: "video-1202",
            file_unique_id: "u-video-1202",
            width: 1280,
            height: 720,
            duration: 72,
            thumbnail: {
              file_id: "thumb-1202",
              file_unique_id: "u-thumb-1202",
              width: 320,
              height: 180,
            },
          },
        }),
      ),
    );
    const [text, pic, video] = await entries(src);
    for (const e of [text!, pic!, video!]) {
      expect(e).toMatchObject({
        kind: "post",
        source_platform: "telegram",
        source_name: "BBM Academy · Telegram",
        partner_organisation_id: null,
        image_ref: null,
        image_url: null,
        hidden_at: null,
      });
    }
    expect(text!.title.endsWith("…")).toBe(true);
    expect([...text!.title].length).toBeLessThanOrEqual(501);
    expect(long.startsWith(text!.title.slice(0, -1))).toBe(true);
    expect(text).toMatchObject({
      href: `https://t.me/${src.address}/1200`,
      source_ref: `${src.id}:1200`,
      preview_state: null,
      preview_file_id: null,
      duration_seconds: null,
    });
    expect(text!.published_at.getTime()).toBe((base + 1200) * 1000);
    expect(pic).toMatchObject({
      title: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
      href: `https://t.me/${src.address}/1201`,
      preview_state: "pending",
      preview_file_id: "p1201-1280",
      preview_file_unique_id: "u-p1201-1280",
    });
    expect(video).toMatchObject({
      title: "PRP при гонартрозе — фрагмент эфира",
      duration_seconds: 72,
      preview_state: "pending",
      preview_file_id: "thumb-1202",
    });
  });

  it("048 EARS-26: when a post is a forward, other content, a service message or has neither text nor image, the system shall drop and log it, writing nothing", async () => {
    const src = await source();
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { text: "Репост", forward_origin: { type: "channel", date: base } },
        "forward",
      ],
      [
        { poll: { id: "p", question: "Q?", options: [] } },
        "unsupported_content",
      ],
      [
        { document: { file_id: "d", file_unique_id: "ud" }, caption: "PDF" },
        "unsupported_content",
      ],
      [{ pinned_message: { message_id: 1 } }, "service_message"],
      [{}, "empty"],
    ];
    let id = 40;
    for (const [extra, reason] of cases) {
      expect((await deliver(post(message(src, ++id, extra)))).statusCode).toBe(
        200,
      );
      expect(drops().at(-1)?.reason).toBe(reason);
    }
    expect(await entries(src)).toEqual([]);
  });

  // ── EARS-27: albums ──────────────────────────────────────────────────

  it("048 EARS-27: when the parts of one album arrive as separate updates, the system shall keep exactly one entry with the caption's text and the smallest part's preview, permalink and earliest date", async () => {
    const src = await source();
    const group = `album-${Date.now()}`;
    // Out of order: the captioned middle part first, the smallest last.
    for (const [id, extra] of [
      [1204, { caption: "Кадры со съёмок подкаста", photo: photo("a1204") }],
      [1205, { photo: photo("a1205") }],
      [1203, { photo: photo("a1203") }],
    ] as const) {
      const res = await deliver(
        post(message(src, id, { media_group_id: group, ...extra })),
      );
      expect(res.statusCode, res.payload).toBe(200);
    }
    const rows = await entries(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Кадры со съёмок подкаста",
      href: `https://t.me/${src.address}/1203`,
      source_ref: `${src.id}:1203`,
      media_group_id: group,
      preview_file_id: "a1203-1280",
      preview_state: "pending",
    });
    expect(rows[0]!.published_at.getTime()).toBe((base + 1203) * 1000);
    expect(await messageIds(rows[0]!.id)).toEqual([1203, 1204, 1205]);
    // A re-delivered part changes nothing.
    await deliver(
      post(
        message(src, 1205, { media_group_id: group, photo: photo("a1205") }),
      ),
    );
    expect(await entries(src)).toHaveLength(1);
  });

  // ── EARS-28: edits ───────────────────────────────────────────────────

  it("048 EARS-28: when an edit arrives for a post that has an entry, the system shall rewrite its text and changed preview in place, keeping its date and hidden state", async () => {
    const src = await source();
    await deliver(
      post(message(src, 50, { caption: "Было", photo: photo("e50") })),
    );
    const [before] = await entries(src);
    await pool.query(
      "UPDATE feed_entries SET hidden_at = now(), preview_state = 'done', image_ref = 'materials/feed/x.webp' WHERE id = $1",
      [before!.id],
    );
    const hidden = (await entries(src))[0]!.hidden_at;
    // Text-only edit: the medium is the same, the preview is kept.
    await deliver(
      edit(
        message(src, 50, {
          caption: "Стало",
          photo: photo("e50"),
          edit_date: base + 99,
        }),
      ),
    );
    let [after] = await entries(src);
    expect(after).toMatchObject({
      id: before!.id,
      title: "Стало",
      preview_state: "done",
      image_ref: "materials/feed/x.webp",
    });
    expect(after!.published_at).toEqual(before!.published_at);
    expect(after!.hidden_at).toEqual(hidden);
    // A replaced medium queues a new preview copy.
    await deliver(
      edit(message(src, 50, { caption: "Стало", photo: photo("e50b") })),
    );
    [after] = await entries(src);
    // The count restarts for the new medium; its immediate copy attempt
    // found no file in the double, so it is counted once and the old copy
    // stays on the card until a new one replaces it (EARS-29).
    expect(after).toMatchObject({
      preview_file_id: "e50b-1280",
      preview_file_unique_id: "u-e50b-1280",
      preview_state: "pending",
      preview_attempts: 1,
      image_ref: "materials/feed/x.webp",
    });
    expect(after!.published_at).toEqual(before!.published_at);
    expect(await entries(src)).toHaveLength(1);
  });

  it("048 EARS-28: when an edit arrives for a post that has no entry, the system shall process it as a new post", async () => {
    const src = await source();
    await deliver(edit(message(src, 60, { text: "Правка неизвестного" })));
    const rows = await entries(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Правка неизвестного",
      href: `https://t.me/${src.address}/60`,
    });
  });

  // ── EARS-36: nothing secret or raw is stored ─────────────────────────

  it("048 EARS-36: the system shall store only the card fields, the message ids and the preview state — never the raw update, the author signature or a file link", async () => {
    const src = await source();
    await deliver(
      post(message(src, 70, { caption: "Публикация", photo: photo("s70") })),
    );
    const [row] = await entries(src);
    const { rows: stored } = await pool.query<{ j: string }>(
      `SELECT row_to_json(e)::text AS j FROM feed_entries e WHERE e.id = $1
         UNION ALL SELECT row_to_json(m)::text FROM feed_entry_messages m WHERE m.feed_entry_id = $1
         UNION ALL SELECT row_to_json(s)::text FROM feed_sources s WHERE s.id = $2`,
      [row!.id, src.id],
    );
    const { rows: audit } = await pool.query<{ j: string }>(
      `SELECT row_to_json(a)::text AS j FROM audit_ledger a
          WHERE a.metadata->'pk'->>'id' = $1 OR a.metadata->'pk'->>'feed_entry_id' = $1
             OR a.metadata::text LIKE $2`,
      [row!.id, `%${row!.id}%`],
    );
    const everything = [...stored, ...audit].map((r) => r.j).join("\n");
    expect(everything).not.toContain(SIGNATURE);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("api.telegram.org");
    expect(everything).not.toContain("sender_chat");
    expect(everything).not.toContain("update_id");
  });
});
