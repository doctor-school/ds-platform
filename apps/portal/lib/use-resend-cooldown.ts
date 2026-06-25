"use client";

import { useCallback, useState } from "react";

/**
 * Shared resend orchestration for the OTP code-entry surfaces (#227/#267).
 *
 * The visual cooldown countdown lives in the design-system `<OtpFocusScreen>` block
 * (and, where the block doesn't fit wholesale — the `/reset` code+password step —
 * its inline analogue): the block (re)starts its countdown whenever `resendNonce`
 * is bumped, WITHOUT a remount. What every consuming surface repeats is the *app*
 * side of that contract:
 *   - hold a monotonic `resendNonce`,
 *   - on a successful resend bump it (restarting the block's countdown + clearing
 *     the now-stale typed code),
 *   - surface a resend failure through the page's existing error channel.
 *
 * This hook factors exactly that orchestration so `/login`, `/verify`, and `/reset`
 * don't each re-implement it. The actual network call is passed in (each surface
 * resends against a DIFFERENT real endpoint — `requestOtp` / `resendVerification` /
 * `requestPasswordReset`); the hook never knows the transport. The EARS-16 generic
 * outcome is preserved by routing the failure through the caller's `onError`, which
 * already maps via `authErrorMessage`.
 */
export function useResendCooldown(opts: {
  /** Re-issue the code against the real backend. Throws on failure. */
  resend: () => Promise<void>;
  /** Report a resend failure (mapped via the page's `authErrorMessage`). */
  onError: (err: unknown) => void;
  /** Clear the page error before a fresh attempt. */
  onBeforeResend?: () => void;
  /**
   * Acknowledge a SUCCESSFUL resend (#326). Fires only after `resend()` resolves,
   * never on the error path — the page uses it to render a neutral, enumeration-safe
   * confirmation (the resend's on-screen response is generic and identical in every
   * case, so success leaks no account-existence signal).
   */
  onSuccess?: () => void;
}): { resendNonce: number; onResend: () => Promise<void>; resetNonce: () => void } {
  const { resend, onError, onBeforeResend, onSuccess } = opts;
  // Bumped on each successful resend; the focus-screen / inline countdown restarts
  // on the change without a remount (#266).
  const [resendNonce, setResendNonce] = useState(0);

  const onResend = useCallback(async () => {
    onBeforeResend?.();
    try {
      await resend();
      setResendNonce((n) => n + 1);
      // Success-only: the neutral confirmation never fires on the error path, where
      // `onError` already surfaces the failure copy instead (#326).
      onSuccess?.();
    } catch (err) {
      onError(err);
    }
  }, [resend, onError, onBeforeResend, onSuccess]);

  // Reset the nonce when a new challenge is issued (so the cooldown starts fresh
  // from the first send, matching the `/login` request→verify transition).
  const resetNonce = useCallback(() => setResendNonce(0), []);

  return { resendNonce, onResend, resetNonce };
}
