"use client";

import { useCallback, useEffect, useState } from "react";
import type { StreamProvider } from "@ds/schemas";
import { Button } from "@ds/design-system/button";
import { resolveEmbed } from "../../../lib/room-player";

/**
 * 014 EARS-7 — the recording player's FAILURE BOUNDARY: the arm of the player
 * card that guarantees a doctor never sits in front of a dead or forever-spinning
 * frame. Per 014-design §5 the player boundary is a CLIENT branch — the api ships
 * no "the embed is broken" status and none may be invented here — so this
 * component watches the mounted embed from the browser and, the moment the embed
 * is not delivering, replaces it with an explicit RU message plus a retry that
 * actually re-creates the frame.
 *
 * Design §8.1 — the player card holds EXACTLY ONE of: the player, the guest gate,
 * the plaque, or the unavailability message. This component owns the first and
 * the last of that set and swaps between them; it never stacks the message over a
 * still-running frame.
 *
 * Two independent failure inputs, because one alone leaves a real hole:
 *   • the frame's own `error` event — the loud failure (a refused/aborted embed);
 *   • a {@link RECORDING_PLAYER_LOAD_TIMEOUT_MS} watchdog — the QUIET one. A
 *     cross-origin iframe that never resolves fires no event at all, and that is
 *     precisely the endless-spinner state EARS-7 exists to forbid.
 * `load` clears the watchdog: the frame document arrived, so «nothing ever came
 * back» is no longer the failure being watched for.
 *
 * Reuse (ADR-0013 A1): the embed URL is built by the SAME `lib/room-player`
 * resolver the 006 room uses — one canonical provider→src mapping for the
 * platform, keyed on the explicit provider enum, never sniffed from `embedRef`.
 * The 006 `usePlayerFailureState` machine is deliberately NOT reused: it grades a
 * LIVE broadcast (provider postMessage handshakes, a bounded AUTO-retry budget,
 * suspected-vs-confirmed stalls) because a live stream self-heals. A published
 * recording does not self-heal on its own schedule — a viewer who wants it again
 * asks for it — so this boundary is a single honest failed state with a manual
 * retry, not a second copy of the live machine.
 *
 * NOT MOUNTED in this slice, by design and not by omission: mounting a player
 * needs the authenticated source read and the guest login gate, which are #1343
 * (EARS-5). Shipping a mount here would either leak a source to a guest or render
 * a frame with nothing behind it — both banned. #1343 mounts this component.
 */

/**
 * How long a mounted embed may deliver nothing before the boundary calls it
 * failed. Deliberately shorter than the 006 room's 20s live watchdog: a room
 * viewer is waiting for a broadcast that may genuinely still be warming up, while
 * a recording is a file that already exists — 12s of blank frame is already an
 * unexplained failure to the doctor.
 */
export const RECORDING_PLAYER_LOAD_TIMEOUT_MS = 12_000;

export interface RecordingPlayerProps {
  /** The explicit provider enum from the authenticated source read (#1343). */
  provider: StreamProvider;
  /** The provider-scoped stream reference — an opaque id, never sniffed. */
  embedRef: string;
  /** The event title, for the frame's accessible name. */
  title: string;
  /** «Монтаж» / «Оригинал» — the cut being played, part of the frame's name. */
  kindLabel: string;
  /** «Запись временно недоступна» (catalog `webinar.playerUnavailable.title`). */
  unavailableTitle: string;
  /** The unavailability explanation (catalog `…playerUnavailable.body`). */
  unavailableBody: string;
  /** «Попробовать ещё раз» (catalog `…playerUnavailable.retry`). */
  retryLabel: string;
}

export function RecordingPlayer({
  provider,
  embedRef,
  title,
  kindLabel,
  unavailableTitle,
  unavailableBody,
  retryLabel,
}: RecordingPlayerProps) {
  // `attempt` doubles as the iframe `key`: bumping it unmounts the failed frame
  // and mounts a genuinely fresh one, so a retry re-requests the embed instead of
  // re-showing the same dead document.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Cleared by `load` — the frame answered, so the "nothing ever arrived"
  // watchdog has nothing left to watch.
  const [watching, setWatching] = useState(true);

  useEffect(() => {
    if (!watching || failed) return;
    const timer = setTimeout(
      () => setFailed(true),
      RECORDING_PLAYER_LOAD_TIMEOUT_MS,
    );
    // Cleared on every state change AND on unmount — no timer outlives the frame
    // it was armed for (the orphan-timer rule).
    return () => clearTimeout(timer);
  }, [watching, failed, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setWatching(true);
    setAttempt((n) => n + 1);
  }, []);

  /**
   * The frame's `load` / `error` are bound as NATIVE listeners through a callback
   * ref rather than as React's `onLoad` / `onError` props. React's synthetic
   * `error` is not delivered for an `<iframe>` (verified in this app's jsdom
   * tier: a dispatched `error` reaches an `onLoad` sibling but never the
   * `onError` prop), and a failure input that silently never fires is the exact
   * hole this boundary exists to close. The listeners are torn down with the
   * element on unmount and on every retry remount, so none outlives its frame.
   */
  const bindFrame = useCallback((node: HTMLIFrameElement | null) => {
    if (!node) return;
    const onLoad = () => setWatching(false);
    const onError = () => setFailed(true);
    node.addEventListener("load", onLoad);
    node.addEventListener("error", onError);
    return () => {
      node.removeEventListener("load", onLoad);
      node.removeEventListener("error", onError);
    };
  }, []);

  const embed = resolveEmbed({ provider, embedRef });

  // A provider whose src cannot be composed is the SAME honest failure, reached
  // before a frame is ever mounted — never a blank card.
  if (failed || embed.kind === "unavailable" || !embed.src) {
    return (
      <div
        data-testid="recording-player-unavailable"
        className="bg-card text-card-foreground -mx-4 p-5 layout:mx-0 layout:border-2 layout:border-border layout:p-8 layout:shadow-lg"
      >
        <p
          role="status"
          className="text-lg font-bold tracking-tight text-card-foreground layout:text-title-lg"
        >
          {unavailableTitle}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {unavailableBody}
        </p>
        <Button
          type="button"
          size="lg"
          className="mt-5"
          data-testid="recording-player-retry"
          onClick={retry}
        >
          {retryLabel}
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="recording-player"
      className="relative -mx-4 aspect-video bg-header layout:mx-0 layout:border-2 layout:border-border layout:shadow-lg"
    >
      <iframe
        key={attempt}
        data-testid={`recording-player-${embed.kind}`}
        src={embed.src}
        title={`${title} — ${kindLabel}`}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="absolute inset-0 size-full border-0"
        ref={bindFrame}
      />
    </div>
  );
}
