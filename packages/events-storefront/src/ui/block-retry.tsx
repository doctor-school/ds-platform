"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
} from "react";

/**
 * What a failed block's «Повторить» runs: the block's own retry, and whether
 * one is in flight.
 */
type BlockRetryState = { readonly retry: () => void; readonly pending: boolean };

const BlockRetryContext = createContext<BlockRetryState | null>(null);

/** The retry of the failed block this control sits in; `null` outside one. */
export function useBlockRetry(): BlockRetryState | null {
  return useContext(BlockRetryContext);
}

/**
 * One failed block of the events page and its retry (019 EARS-9, #2832): the
 * retry is the host's server action bound to THIS block, which re-runs only
 * the block's read and answers the block re-rendered; the answer replaces the
 * block in place — no route refresh, so every other block and its read stay
 * as they are. A block that fails again answers its error with a fresh
 * boundary of its own. When the server renders the page again (a navigation),
 * its new block replaces the retried one.
 *
 * An action that cannot be reached at all leaves the block as it was: the
 * cause and «Повторить» stay, ready for another try.
 */
export function BlockRetry({
  retry,
  children,
}: {
  retry: () => Promise<ReactNode>;
  children: ReactNode;
}) {
  const [retried, setRetried] = useState<{
    readonly over: ReactNode;
    readonly block: ReactNode;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(() => {
    startTransition(async () => {
      try {
        const block = await retry();
        startTransition(() => setRetried({ over: children, block }));
      } catch {
        // Unreachable action: the block keeps its cause and its «Повторить».
      }
    });
  }, [retry, children]);

  const shown =
    retried !== null && retried.over === children ? retried.block : children;
  return (
    <BlockRetryContext.Provider value={{ retry: run, pending }}>
      {shown}
    </BlockRetryContext.Provider>
  );
}
