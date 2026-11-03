import { describe, expect, it } from "vitest";

import { isDocumentHydrated, settleClientTurn } from "./page-ready.js";

/** A React container the way `hydrateRoot` leaves it: a key on the container
 * pointing at the HostRoot fiber whose `stateNode` is the FiberRoot. */
function container(current: object): object {
  const hostRoot = { stateNode: { current } };
  return { __reactContainer$k3y: hostRoot };
}

function fiber(
  tag: number,
  memoizedState: unknown,
  child: object | null = null,
  sibling: object | null = null,
) {
  return { tag, memoizedState, child, sibling };
}

describe("isDocumentHydrated", () => {
  it("is false before React has taken the document (no container key)", () => {
    expect(isDocumentHydrated({ title: "x" })).toBe(false);
  });

  it("is false while the root shell is still dehydrated", () => {
    expect(
      isDocumentHydrated(container(fiber(3, { isDehydrated: true }))),
    ).toBe(false);
  });

  it("is false while a Suspense boundary deeper in the tree is still dehydrated", () => {
    const pending = fiber(13, { dehydrated: {} });
    const tree = fiber(
      3,
      { isDehydrated: false },
      fiber(5, null, fiber(0, null), pending),
    );
    expect(isDocumentHydrated(container(tree))).toBe(false);
  });

  it("is false while an Activity boundary is still dehydrated", () => {
    const tree = fiber(
      3,
      { isDehydrated: false },
      fiber(31, { dehydrated: {} }),
    );
    expect(isDocumentHydrated(container(tree))).toBe(false);
  });

  it("is true once the root and every boundary have hydrated", () => {
    const tree = fiber(
      3,
      { isDehydrated: false },
      fiber(5, null, fiber(13, { dehydrated: null }), fiber(13, null)),
    );
    expect(isDocumentHydrated(container(tree))).toBe(true);
  });
});

describe("settleClientTurn", () => {
  it("runs one page macrotask through the protocol before resolving", async () => {
    const calls: string[] = [];
    const page = {
      evaluate: async (fn: () => Promise<void>) => {
        calls.push(String(fn));
        await fn();
      },
    };
    await settleClientTurn(page as never);
    expect(calls).toHaveLength(1);
    // A message-channel turn, never a timer: a step may run under `page.clock`.
    expect(calls[0]).toContain("MessageChannel");
    expect(calls[0]).not.toContain("setTimeout");
  });
});
