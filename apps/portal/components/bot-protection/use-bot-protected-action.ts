"use client";

import { useCallback, useRef, useState } from "react";
import type { BotProtectionFailure } from "./smart-captcha";

type ProtectedAction = (token?: string) => Promise<void>;

/**
 * Resume-one-action orchestration for provider-native invisible CAPTCHA.
 * Each `request()` mints a new widget key; the first token consumes the pending
 * closure atomically, duplicate callbacks are ignored, and every terminal path
 * returns to idle so no Yandex one-time token can be reused.
 */
export function useBotProtectedAction(options: {
  onVerified?: () => void;
  onChallengeError: (failure: BotProtectionFailure) => void;
  onActionError: (error: unknown) => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const actionRef = useRef<ProtectedAction | null>(null);
  const pendingRef = useRef(false);
  const nextKey = useRef(0);
  const [requestKey, setRequestKey] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const finish = useCallback(() => {
    actionRef.current = null;
    pendingRef.current = false;
    setRequestKey(null);
    setPending(false);
  }, []);

  const request = useCallback((action: ProtectedAction) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    actionRef.current = action;
    setPending(true);
    nextKey.current += 1;
    setRequestKey(nextKey.current);
  }, []);

  const onToken = useCallback(
    (token?: string) => {
      const action = actionRef.current;
      if (!action) return;
      // Consume before awaiting: provider duplicate success callbacks cannot
      // replay the protected network mutation.
      actionRef.current = null;
      optionsRef.current.onVerified?.();
      void action(token)
        .catch((error: unknown) => optionsRef.current.onActionError(error))
        .finally(finish);
    },
    [finish],
  );

  const onError = useCallback(
    (failure: BotProtectionFailure) => {
      if (!actionRef.current) return;
      finish();
      optionsRef.current.onChallengeError(failure);
    },
    [finish],
  );

  return {
    request,
    pending,
    fieldProps: { requestKey, onToken, onError },
  };
}
