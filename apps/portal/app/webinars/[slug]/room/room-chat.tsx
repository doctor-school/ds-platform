"use client";

import { useEffect, useRef, useState } from "react";
import { Centrifuge, type PublicationContext } from "centrifuge";
import { useTranslations } from "next-intl";
import { Button, Skeleton, cn } from "@ds/design-system";
import {
  ChatMessageTextSchema,
  RoomChatMessageSchema,
  type RoomChatCredential,
  type RoomChatMessage,
} from "@ds/schemas";
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
  collapsed = false,
  onIncomingWhileCollapsed,
}: {
  slug: string;
  chat: RoomChatCredential;
  /** Desktop collapse state (#1123) — new arrivals while folded feed the rail
   * unread badge instead of scrolling into a hidden ledger. */
  collapsed?: boolean;
  /** Reports how many messages arrived while the chat was collapsed. */
  onIncomingWhileCollapsed?: (delta: number) => void;
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
  // Live connection state (#1124). A webinar outruns one connection-token TTL and
  // a long-lived websocket drops + re-handshakes; a dead connection MUST NOT be
  // silent (an established conversation looking live-but-stale is the exact
  // mid-webinar chat-death the room reported). `connecting` after the first
  // successful connect = a transient drop the SDK is retrying (backoff);
  // `disconnected` = terminal (the gate no longer admits — getToken threw
  // UnauthorizedError — so the SDK stopped). Either way the pane says so.
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  // Stick-to-bottom ledger (#1123, canvas `chat-column.dc.html`): the ledger is
  // `flex-col-reverse` so `scrollTop` 0 == pinned to the newest message. While the
  // reader is stuck to the bottom, new messages autoscroll in; once they scroll up
  // (|scrollTop| ≥ 32) autoscroll pauses and a «Новые сообщения ↓» chip surfaces on
  // each arrival, cleared by a jump-to-newest or by re-sticking.
  const listRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const prevLenRef = useRef(0);
  const [showChip, setShowChip] = useState(false);

  function onLedgerScroll(): void {
    const el = listRef.current;
    if (!el) return;
    const atBottom = Math.abs(el.scrollTop) < 32;
    stuckRef.current = atBottom;
    if (atBottom) setShowChip(false);
  }

  function jumpToNewest(): void {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
    stuckRef.current = true;
    setShowChip(false);
  }

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
    // Connection-lifecycle listeners (#1124): the SDK drives these across the
    // whole session — the initial handshake, a transient drop's backoff retry,
    // and a terminal stop after a gate refusal — so the pane reflects reality
    // instead of silently freezing on a stale conversation.
    const onConnecting = (): void => setConnection("connecting");
    const onConnected = (): void => setConnection("connected");
    const onDisconnected = (): void => setConnection("disconnected");
    centrifuge.on("publication", onPublication);
    centrifuge.on("subscribed", onSubscribed);
    centrifuge.on("connecting", onConnecting);
    centrifuge.on("connected", onConnected);
    centrifuge.on("disconnected", onDisconnected);
    centrifuge.connect();
    return () => {
      centrifuge.removeListener("publication", onPublication);
      centrifuge.removeListener("subscribed", onSubscribed);
      centrifuge.removeListener("connecting", onConnecting);
      centrifuge.removeListener("connected", onConnected);
      centrifuge.removeListener("disconnected", onDisconnected);
      centrifuge.disconnect();
    };
  }, [slug, chat.url, chat.token, chat.channel]);

  // React to the log growing: stuck → autoscroll to newest (scrollTop 0 in the
  // reversed ledger); scrolled-up → raise the «Новые сообщения ↓» chip; collapsed
  // → feed the rail unread badge (#1123). Guards on the DELTA so the initial
  // hydration burst (stuck by default) never flashes a chip.
  useEffect(() => {
    const delta = messages.length - prevLenRef.current;
    prevLenRef.current = messages.length;
    if (delta <= 0) return;
    if (collapsed) {
      onIncomingWhileCollapsed?.(delta);
      return;
    }
    if (stuckRef.current) {
      const list = listRef.current;
      if (list) list.scrollTop = 0;
    } else {
      setShowChip(true);
    }
  }, [messages.length, collapsed, onIncomingWhileCollapsed]);

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
      <div className="flex-none border-b-2 border-hairline bg-tint px-4 py-2.5 text-caption leading-relaxed text-tint-foreground">
        {t("moderatorPin")}
      </div>
      {/* Connection-state banner (#1124): a dropped/terminated live connection is
          stated truthfully — a transient drop shows «Восстанавливаем связь…»
          while the SDK retries, a terminal disconnect prompts a reload — so an
          established conversation is never left silently stale. The empty-state
          («Пока нет сообщений») is NEVER shown in its place. */}
      {connection === "disconnected" ? (
        <div
          role="status"
          data-testid="room-chat-disconnected"
          className="flex-none border-b-2 border-hairline bg-tint px-4 py-2 text-caption text-tint-foreground"
        >
          {t("chatDisconnected")}
        </div>
      ) : connection === "connecting" && hydrated ? (
        <div
          role="status"
          data-testid="room-chat-reconnecting"
          className="flex-none border-b-2 border-hairline bg-tint px-4 py-2 text-caption text-tint-foreground"
        >
          {t("chatReconnecting")}
        </div>
      ) : null}
      {/* Ledger region (relative — anchors the «Новые сообщения ↓» chip). The
          ledger is the ONLY scroll container in the column (#1123): it is
          `flex-col-reverse` so the newest message pins to the bottom and the page
          behind never scrolls. A reconnecting drop dims it rather than blanking it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          onScroll={onLedgerScroll}
          data-testid="room-chat-messages"
          role="log"
          aria-live="polite"
          aria-busy={
            messages.length === 0 && !hydrated && connection !== "disconnected"
          }
          aria-label={t("chatHeading")}
          className={cn(
            "flex min-h-0 flex-1 overflow-y-auto px-3.5 py-3",
            messages.length > 0 ? "flex-col-reverse gap-2.5" : "flex-col",
            connection === "connecting" && hydrated && "opacity-60",
          )}
        >
          {messages.length === 0 ? (
            connection === "disconnected" ? (
              // The disconnected banner above carries the truth — do NOT assert the
              // room is empty («Пока нет сообщений») when we simply lost the link.
              null
            ) : !hydrated ? (
              // History still loading — a distinct loading state, NEVER the
              // empty-state (#843). DS `Skeleton` primitive (decorative,
              // aria-hidden); the sr-only line carries the accessible status.
              <div
                data-testid="room-chat-loading"
                className="flex flex-col gap-3"
              >
                <span className="sr-only">{t("chatLoading")}</span>
                <Skeleton className="h-11 w-4/5" />
                <Skeleton className="h-11 w-3/5" />
                <Skeleton className="h-11 w-2/3" />
              </div>
            ) : (
              <p className="m-auto text-center text-sm text-muted-foreground">
                {t("chatEmpty")}
              </p>
            )
          ) : (
            // Twitch-minimal row anatomy (#1123, `chat-column.dc.html`): a single
            // borderless paragraph — a bold name slot inline with the text, NO
            // timestamp, NO avatar. Own message → «Вы» in the accent colour; others
            // → the poster's own display name (`authorName`, #1121), falling back to
            // the «Участник <tag>» participant label when the poster has no name set
            // (or for legacy history minted before the field existed). Reversed for
            // the `flex-col-reverse` ledger.
            [...messages].reverse().map((message) => {
              const own = message.authorTag === chat.selfTag;
              return (
                <div
                  key={message.id}
                  data-testid="room-chat-message"
                  className="text-sm leading-relaxed text-foreground break-words"
                >
                  <span
                    className={cn(
                      "font-bold",
                      own ? "text-primary-action" : "text-foreground",
                    )}
                  >
                    {own
                      ? t("chatYou")
                      : (message.authorName ??
                        `${t("chatParticipant")} ${message.authorTag}`)}
                  </span>{" "}
                  {message.text}
                </div>
              );
            })
          )}
        </div>
        {showChip && messages.length > 0 ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid="room-chat-chip"
            onClick={jumpToNewest}
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
          >
            {t("chatNewMessages")}
          </Button>
        ) : null}
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
        {/* primitives-first-ok: canvas-pinned webinar-room composer field (room
            canvas) — border-2 hairline box, no DS Input chrome; pre-#828 surface,
            DS-adoption candidate for a follow-up. */}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("composerPlaceholder")}
          aria-label={t("composerPlaceholder")}
          maxLength={2000}
          className="min-w-0 flex-1 border-2 border-hairline bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-focus"
        />
        <Button
          type="submit"
          variant="default"
          disabled={!isSendable}
          aria-label={t("composerSend")}
        >
          {t("composerSend")}
        </Button>
      </form>
    </div>
  );
}
