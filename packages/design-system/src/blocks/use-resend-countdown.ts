"use client";

import * as React from "react";

/**
 * `useResendCountdown` (#227/#267) — the live resend-cooldown timer shared by the
 * OTP code-entry surfaces. It owns a per-second countdown that (re)starts whenever
 * EITHER the `cooldownSeconds` value changes OR the `resendNonce` counter is bumped
 * (a successful resend re-issues the SAME duration, so the value is unchanged — the
 * nonce is what restarts it WITHOUT a remount, the #266 contract).
 *
 * `<OtpFocusScreen>` uses it for `/login` and `/verify`. The `/reset` complete step
 * cannot adopt `<OtpFocusScreen>` wholesale (it submits the code together with a new
 * password, a shape the single-purpose block doesn't carry), so it composes the SAME
 * timer through this hook instead of duplicating the interval logic — one source of
 * truth for the countdown across every surface.
 *
 * Returns the seconds remaining; `> 0` means the resend control is in cooldown.
 */
export function useResendCountdown(
  cooldownSeconds: number,
  resendNonce: number,
): number {
  const [remaining, setRemaining] = React.useState(cooldownSeconds);

  // Re-seed whenever the duration changes OR a resend bumps the nonce — so the
  // countdown restarts without remounting the consumer; `0` leaves it disabled.
  React.useEffect(() => {
    setRemaining(cooldownSeconds);
  }, [cooldownSeconds, resendNonce]);

  React.useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return remaining;
}
