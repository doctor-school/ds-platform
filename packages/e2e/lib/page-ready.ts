import type { Page } from "@playwright/test";

/**
 * True once React has finished hydrating the document `doc` (the page's
 * `document` when omitted): `hydrateRoot` has taken the container, the root
 * shell is no longer dehydrated, and no Suspense / Activity boundary in the
 * committed tree is still waiting for its server HTML to hydrate. Reads React's
 * own committed fiber tree, so it is the signal a step needs before it clicks a
 * server-rendered control whose handler only exists after hydration (#2253,
 * #3229). Self-contained so Playwright can serialise it into
 * `page.waitForFunction`.
 */
export function isDocumentHydrated(doc?: object | null): boolean {
  type Fiber = {
    tag?: number;
    memoizedState?: { isDehydrated?: boolean; dehydrated?: unknown } | null;
    child?: Fiber | null;
    sibling?: Fiber | null;
  };
  const root =
    doc ?? (globalThis as unknown as { document?: object }).document ?? null;
  if (root === null) return false;
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  if (key === undefined) return false;
  const hostRoot = (root as Record<string, unknown>)[key] as {
    stateNode?: { current?: Fiber };
  } | null;
  const current = hostRoot?.stateNode?.current;
  if (!current || current.memoizedState?.isDehydrated !== false) return false;
  // React 19: SuspenseComponent = 13, ActivityComponent = 31; both keep the
  // dehydrated server boundary in `memoizedState.dehydrated` until it hydrates.
  const stack: Fiber[] = current.child ? [current.child] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      (node.tag === 13 || node.tag === 31) &&
      node.memoizedState != null &&
      node.memoizedState.dehydrated != null
    )
      return false;
    if (node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  return true;
}

/**
 * The «page is ready for the step» wait of the shared e2e steps (#3465): the
 * document has loaded and React has hydrated it, so a server-rendered control's
 * client handler exists. It replaces `networkidle`, which never settles on a
 * page carrying the real SmartCaptcha widget (its Metrika beacon stays in
 * flight). Data a step reads next is awaited by that step's own auto-waiting
 * locator / `expect` or a `waitForResponse`, never by this helper.
 */
export async function waitForClientReady(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForFunction(isDocumentHydrated, null);
}

/**
 * An ordering barrier for a step that asserts what the page did NOT send (or
 * sent exactly once) after an action it has already observed settle: one page
 * macrotask runs and its result returns over the protocol, so every request the
 * page had started by then has been reported to the test's `request` listeners.
 * It replaces a `networkidle` settle, which the SmartCaptcha beacon never lets
 * resolve (#3465).
 */
export async function settleClientTurn(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  );
}
