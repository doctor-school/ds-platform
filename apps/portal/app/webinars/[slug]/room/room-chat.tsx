"use client";

import { useEffect, useRef, useState } from "react";
import { Centrifuge, type PublicationContext } from "centrifuge";
import { useTranslations } from "next-intl";
import {
  ChatMessageTextSchema,
  RoomChatMessageSchema,
  type RoomChatCredential,
  type RoomChatMessage,
} from "@ds/schemas";
import { formatMskParts } from "../../../../lib/msk";

/**
 * 006 EARS-3 — the live chat panel. A gated doctor READS the room chat in real
 * time and POSTS messages that fan out to every participant without a reload
 * (design §4). Two halves, both riding the server-side gate:
 *
 * - **Read (subscribe-only).** It connects to Centrifugo with the gate-scoped,
 *   subscribe-only connection token the `RoomConfig` grant carried
 *   (`chat.token`) — Centrifugo subscribes the connection SERVER-SIDE to exactly
 *   this room channel (the token's `channels` claim), so every published message
 *   arrives on the instance `publication` event with no reload. The client never
 *   subscribes to another channel and holds no publish capability.
 * - **Post (server-mediated).** The composer POSTs the text to the gated
 *   `POST /v1/events/:slug/chat` command (same-origin, the `__Host-` session
 *   cookie rides via the `/v1/*` rewrite). The backend re-checks the gate and
 *   publishes; the poster's own message returns over the same live fan-out.
 *
 * The text is validated by the {@link ChatMessageTextSchema} SSOT the API shares,
 * so the composer rejects EXACTLY what the server rejects (empty / whitespace-only
 * disables send; over-2000-chars is blocked). All copy resolves through the typed
 * message catalog (EARS-10) — no hardcoded user-facing string.
 */
export function RoomChat({
  slug,
  chat,
}: {
  slug: string;
  chat: RoomChatCredential;
}) {
  const t = useTranslations("room");
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to the live channel. Server-side subscription (the token's `channels`
  // claim) delivers publications on the Centrifuge instance, so we listen there —
  // no client-side `newSubscription` (which the gate-scoped token does not grant).
  useEffect(() => {
    const centrifuge = new Centrifuge(chat.url, { token: chat.token });
    const onPublication = (ctx: PublicationContext): void => {
      if (ctx.channel !== chat.channel) return;
      const parsed = RoomChatMessageSchema.safeParse(ctx.data);
      if (!parsed.success) return;
      const message = parsed.data;
      setMessages((prev) =>
        // The poster is subscribed too, so its own message echoes back over the
        // fan-out — dedupe by server-minted id so it renders exactly once.
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    };
    centrifuge.on("publication", onPublication);
    centrifuge.connect();
    return () => {
      centrifuge.removeListener("publication", onPublication);
      centrifuge.disconnect();
    };
  }, [chat.url, chat.token, chat.channel]);

  // Keep the newest message in view as the log grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  // The composer's send-enable is the SSOT rule verbatim: a whitespace-only or
  // over-long draft is not sendable (the same rule the server enforces, so the
  // client never posts what the backend would 400).
  const isSendable = ChatMessageTextSchema.safeParse(draft).success && !sending;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = ChatMessageTextSchema.safeParse(draft);
    if (!parsed.success) return;
    setSending(true);
    setFailed(false);
    try {
      const res = await fetch(`/v1/events/${encodeURIComponent(slug)}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text: parsed.data }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      // Sent — clear the composer; the message renders when the fan-out arrives.
      setDraft("");
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-testid="room-chat" className="flex min-h-0 flex-1 flex-col">
      <div className="border-b-2 border-border bg-primary-action px-4 py-3 text-center text-sm font-extrabold text-primary-foreground">
        {t("chatHeading")}
      </div>
      <div className="border-b-2 border-border bg-tint px-4 py-3 text-caption leading-relaxed text-tint-foreground">
        {t("moderatorPin")}
      </div>
      <div
        ref={listRef}
        data-testid="room-chat-messages"
        role="log"
        aria-live="polite"
        aria-label={t("chatHeading")}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-sm text-muted-foreground">
            {t("chatEmpty")}
          </p>
        ) : (
          messages.map((message) => {
            const own = message.authorTag === chat.selfTag;
            return (
              <div
                key={message.id}
                data-testid="room-chat-message"
                className="flex flex-col gap-1 border-2 border-hairline bg-card px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-caption font-extrabold uppercase tracking-micro text-primary-action">
                    {own
                      ? t("chatYou")
                      : `${t("chatParticipant")} ${message.authorTag}`}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {formatMskParts(message.at).time}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-foreground break-words">
                  {message.text}
                </p>
              </div>
            );
          })
        )}
      </div>
      {failed ? (
        <div
          role="alert"
          className="border-t-2 border-border bg-tint px-4 py-2 text-caption text-tint-foreground"
        >
          {t("chatSendError")}
        </div>
      ) : null}
      <form onSubmit={submit} className="flex gap-3 border-t-2 border-border p-4">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("composerPlaceholder")}
          aria-label={t("composerPlaceholder")}
          maxLength={2000}
          className="min-w-0 flex-1 border-2 border-hairline bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-focus"
        />
        <button
          type="submit"
          disabled={!isSendable}
          aria-label={t("composerSend")}
          className="border-2 border-border bg-primary-action px-4 py-3 text-sm font-extrabold text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("composerSend")}
        </button>
      </form>
    </div>
  );
}
