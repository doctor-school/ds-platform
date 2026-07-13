"use client";

import { useEffect, useRef, useState } from "react";
import { Centrifuge, type PublicationContext } from "centrifuge";
import { useTranslations } from "next-intl";
import { Skeleton } from "@ds/design-system";
import {
  ChatMessageTextSchema,
  RoomChatMessageSchema,
  type RoomChatCredential,
  type RoomChatMessage,
} from "@ds/schemas";
import { formatMskParts } from "../../../../lib/msk";
import { fetchFreshChatToken } from "../../../../lib/room-chat-token";

/**
 * 006 EARS-3 — the live chat panel. A gated doctor READS the room chat in real
 * time and POSTS messages that fan out to every participant without a reload
 * (design §4). Three behaviours, all riding the server-side gate:
 *
 * - **Read (subscribe-only, TTL-surviving).** It connects to Centrifugo with the
 *   gate-scoped, subscribe-only connection token the `RoomConfig` grant carried
 *   (`chat.token`) — Centrifugo subscribes the connection SERVER-SIDE to exactly
 *   this room channel (the token's `channels` claim), so every published message
 *   arrives on the instance `publication` event with no reload. The client never
 *   subscribes to another channel and holds no publish capability. The token has
 *   a finite TTL (`CHAT_TOKEN_TTL_SECONDS`), so the client also passes the SDK's
 *   `getToken` refresh callback ({@link fetchFreshChatToken}) — the SDK invokes it
 *   on token expiry and the connection refreshes transparently, so a webinar
 *   longer than one TTL never loses its chat mid-session. The refresh re-fetches
 *   the grant through the SAME admission gate (no weaker path); a caller the gate
 *   no longer admits stops reconnecting.
 * - **Hydrate on join.** On (re)subscribe it loads the channel's recent bounded
 *   history (the `room` namespace enables it exactly for this), so a doctor
 *   joining mid-webinar reads the recent conversation, not an empty pane; live
 *   publications merge by server-minted id, so nothing duplicates.
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
  // History-bootstrap latch (#843): `chatEmpty` («Пока нет сообщений») is a
  // STATEMENT about the room, so it must never render while the answer is
  // still in flight — connect → subscribe → history takes seconds after a
  // reload, and flashing the empty-state over an active conversation reads as
  // staleness. Until the history read settles, the pane shows a loading
  // skeleton instead.
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to the live channel. Server-side subscription (the token's `channels`
  // claim) delivers publications on the Centrifuge instance, so we listen there —
  // no client-side `newSubscription` (which the gate-scoped token does not grant).
  useEffect(() => {
    /** Merge validated messages in by server-minted id (no duplicates), ordered by
     * the server-authoritative instant — history hydration and the live fan-out
     * interleave safely regardless of arrival order. */
    const merge = (incoming: RoomChatMessage[]): void => {
      if (incoming.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = incoming.filter((m) => !seen.has(m.id));
        if (fresh.length === 0) return prev;
        return [...prev, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
      });
    };

    const centrifuge = new Centrifuge(chat.url, {
      token: chat.token,
      // The SDK invokes this when the connection token expires (finite TTL): the
      // refresh re-fetches the grant through the SAME admission gate and the
      // connection + server-side subscription survive a webinar longer than one
      // TTL. A gate refusal throws UnauthorizedError inside → the SDK stops.
      getToken: () => fetchFreshChatToken(slug),
    });
    const onPublication = (ctx: PublicationContext): void => {
      if (ctx.channel !== chat.channel) return;
      const parsed = RoomChatMessageSchema.safeParse(ctx.data);
      if (!parsed.success) return;
      // The poster is subscribed too, so its own message echoes back over the
      // fan-out — `merge` dedupes by server-minted id so it renders exactly once.
      merge([parsed.data]);
    };
    // Hydrate on (re)subscribe: a doctor joining mid-webinar reads the channel's
    // recent bounded history instead of an empty pane. Best-effort — a history
    // failure never breaks the live stream (the subscription is already up).
    const onSubscribed = (ctx: { channel: string }): void => {
      if (ctx.channel !== chat.channel) return;
      void centrifuge
        .history(chat.channel, { limit: 100 })
        .then((res) =>
          merge(
            res.publications
              .map((p) => RoomChatMessageSchema.safeParse(p.data))
              .filter((r) => r.success)
              .map((r) => r.data),
          ),
        )
        .catch(() => {
          // Hydration is additive; live messages still arrive.
        })
        .finally(() => {
          // The history read settled (either way) — only NOW is «no messages
          // yet» a fact the pane may state (#843).
          setHydrated(true);
        });
    };
    centrifuge.on("publication", onPublication);
    centrifuge.on("subscribed", onSubscribed);
    centrifuge.connect();
    return () => {
      centrifuge.removeListener("publication", onPublication);
      centrifuge.removeListener("subscribed", onSubscribed);
      centrifuge.disconnect();
    };
  }, [slug, chat.url, chat.token, chat.channel]);

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
        aria-busy={messages.length === 0 && !hydrated}
        aria-label={t("chatHeading")}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          !hydrated ? (
            // History still loading — a distinct loading state, NEVER the
            // empty-state (#843). DS `Skeleton` primitive (decorative,
            // aria-hidden); the sr-only line carries the accessible status.
            <div
              data-testid="room-chat-loading"
              className="flex flex-col gap-3"
            >
              <span className="sr-only">{t("chatLoading")}</span>
              <Skeleton className="h-14 w-4/5" />
              <Skeleton className="h-14 w-3/5" />
              <Skeleton className="h-14 w-2/3" />
            </div>
          ) : (
            <p className="m-auto text-center text-sm text-muted-foreground">
              {t("chatEmpty")}
            </p>
          )
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
