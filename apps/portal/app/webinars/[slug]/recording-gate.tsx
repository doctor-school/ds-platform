import Link from "next/link";
import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * 014 EARS-5 — the GUEST GATE: what a visitor with no session sees in the player
 * position of a post-live page whose recording is published.
 *
 * Built to the `design-source/webinar-archive.dc.html` guest artboard: the event
 * poster, dimmed, with a boxed invitation centred over it — the recording kind +
 * duration as the eyebrow, an explicit «войдите, чтобы посмотреть» headline, the
 * free-for-doctors reassurance, one labelled primary sign-in action, and a
 * secondary «нет аккаунта? создать» line. There is no paywall framing anywhere in
 * it, deliberately: the recording is free, and the account is the only thing
 * between the doctor and it, so the copy says exactly that.
 *
 * The gate is a SERVER component with no client state. It is not an overlay
 * dismissible from the browser and it is not a soft wall over a rendered player:
 * the source never reaches this HTML at all, because a guest render never issues
 * the authenticated source read (`lib/event-playback`). What is behind the dim is
 * the poster — a public field — and nothing else.
 *
 * Both actions carry the current page as a same-origin `returnTo` through
 * `withReturnTarget` (014 EARS-6), so the doctor lands back on this event page,
 * signed in, with the player mounted — never on a generic home page that makes
 * them find the recording again.
 */
export interface RecordingGateProps {
  /** The event's public poster; `null` renders the dim over the flat surface. */
  posterUrl: string | null;
  /** «Монтаж» / «Оригинал» — the kind of recording waiting behind the gate. */
  kindLabel: string;
  /** The eyebrow line above the headline («Запись эфира · 90 мин»). */
  metaLabel: string;
  /** «Войдите, чтобы посмотреть запись». */
  title: string;
  /** The free-for-doctors reassurance line. */
  body: string;
  /** The primary action label («Войти и смотреть»). */
  ctaLabel: string;
  /** Same-origin `/login?returnTo=…` href (built with `withReturnTarget`). */
  signInHref: string;
  /** «Нет аккаунта?» */
  noAccountLabel: string;
  /** «Создать» — the secondary registration link's label. */
  signUpLabel: string;
  /** Same-origin `/register?returnTo=…` href. */
  signUpHref: string;
}

export function RecordingGate({
  posterUrl,
  kindLabel,
  metaLabel,
  title,
  body,
  ctaLabel,
  signInHref,
  noAccountLabel,
  signUpLabel,
  signUpHref,
}: RecordingGateProps) {
  return (
    <div
      data-testid="recording-gate"
      className="relative -mx-4 aspect-video overflow-hidden bg-header layout:mx-0 layout:border-2 layout:border-border layout:shadow-lg"
    >
      {posterUrl ? (
        // Decorative: the invitation below carries the whole message, so the
        // poster adds no information a screen reader would lose (empty alt).
        // A plain <img>, not next/image: the poster URL is remote CMS content
        // with no configured loader domain, and the element is decorative.
        <img
          src={posterUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {/* The dim, per the canvas: the poster stays legible underneath, which is
          what makes the gate read as «there is a recording here» rather than as
          an error state. */}
      <div className="absolute inset-0 flex items-center justify-center bg-header/80 p-5">
        <div className="max-w-md border-2 border-border bg-card p-6 text-center text-card-foreground shadow-lg layout:p-8">
          <p className="text-2xs font-extrabold uppercase tracking-micro text-primary-action">
            {kindLabel} · {metaLabel}
          </p>
          <p className="mt-3 text-lg font-extrabold tracking-tight text-card-foreground layout:text-title-lg">
            {title}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
          <Button asChild size="lg" className="mt-5">
            <Link href={signInHref} data-testid="recording-gate-signin">
              {ctaLabel}
            </Link>
          </Button>
          <p className="mt-4 text-caption font-semibold text-muted-foreground">
            {noAccountLabel}{" "}
            <DsLink asChild className="font-bold">
              <Link href={signUpHref} data-testid="recording-gate-signup">
                {signUpLabel}
              </Link>
            </DsLink>
          </p>
        </div>
      </div>
    </div>
  );
}
