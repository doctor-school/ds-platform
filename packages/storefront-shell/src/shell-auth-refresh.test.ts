// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ShellAuthState } from "./config";
import { refreshShellAuth, useShellAuth } from "./shell-auth-refresh";

/**
 * 008 EARS-4 / EARS-5 - the CLIENT half of the shell's auth cluster (#1004),
 * moved out of `apps/portal/lib/header-auth.ts` into the package that owns the
 * cluster (#2027 PR 1.4, wave-1 gate S4.3:322).
 *
 * The cluster's look has been package-owned since #2180; the re-read SIGNAL was
 * still a host module, which is what let the two storefronts' post-login refresh
 * drift. The signal belongs to the same contract as the slot it refreshes.
 *
 * What the package owns: the subscription, the latest-read-wins ordering, the
 * no-flash re-read and the unmount guard. What the HOST owns: the `read` itself
 * - the Academy derives its initials from the self-profile, the doctor host has
 * no display-name read at all - and therefore its own degrade-to-guest wording,
 * which is why a rejected read keeps the last state here rather than inventing a
 * guest label the package cannot know.
 */

const guest: ShellAuthState = {
  status: "guest",
  loginHref: "/login",
  label: "Войти",
};
const doctor: ShellAuthState = {
  status: "doctor",
  profileHref: "/account",
  label: "Кабинет",
};

describe("008 EARS-4 shared shell auth refresh", () => {
  it("008 EARS-4.1: opens on loading so the header reserves the box, then swaps to the read result", async () => {
    const read = vi.fn(async () => guest);
    const { result } = renderHook(() => useShellAuth(read));

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual(guest));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("008 EARS-4.2: a signalled re-read swaps the cluster without a hard reload", async () => {
    let next: ShellAuthState = guest;
    const read = vi.fn(async () => next);
    const { result } = renderHook(() => useShellAuth(read));
    await waitFor(() => expect(result.current).toEqual(guest));

    next = doctor;
    await act(async () => {
      refreshShellAuth();
    });
    await waitFor(() => expect(result.current).toEqual(doctor));
  });

  it("008 EARS-4.3: a signalled re-read never resets to loading - no affordance flash", async () => {
    const seen: ShellAuthState["status"][] = [];
    let resolveSecond: ((state: ShellAuthState) => void) | undefined;
    const read = vi
      .fn<() => Promise<ShellAuthState>>()
      .mockResolvedValueOnce(doctor)
      .mockImplementationOnce(
        () =>
          new Promise<ShellAuthState>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { result } = renderHook(() => {
      const state = useShellAuth(read);
      seen.push(state.status);
      return state;
    });
    await waitFor(() => expect(result.current).toEqual(doctor));

    await act(async () => {
      refreshShellAuth();
    });
    // Still the previous cluster while the second read is in flight.
    expect(result.current).toEqual(doctor);
    await act(async () => {
      resolveSecond?.(guest);
    });
    await waitFor(() => expect(result.current).toEqual(guest));
    // `loading` was seen exactly once, at mount.
    expect(seen.filter((s) => s === "loading")).toHaveLength(1);
  });

  it("008 EARS-4.4: the most recently STARTED read wins - a slow stale response never overwrites a fresher one", async () => {
    let resolveSlow: ((state: ShellAuthState) => void) | undefined;
    const read = vi
      .fn<() => Promise<ShellAuthState>>()
      .mockImplementationOnce(
        () =>
          new Promise<ShellAuthState>((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValueOnce(doctor);
    const { result } = renderHook(() => useShellAuth(read));

    await act(async () => {
      refreshShellAuth();
    });
    await waitFor(() => expect(result.current).toEqual(doctor));
    // The stale first read lands last and must be ignored.
    await act(async () => {
      resolveSlow?.(guest);
    });
    expect(result.current).toEqual(doctor);
  });

  it("008 EARS-4.5: an unmounted header is neither signalled nor written to", async () => {
    const read = vi.fn(async () => guest);
    const { result, unmount } = renderHook(() => useShellAuth(read));
    await waitFor(() => expect(result.current).toEqual(guest));

    unmount();
    await act(async () => {
      refreshShellAuth();
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("008 EARS-4.6: a rejected read keeps the last cluster - the shell never goes down over it", async () => {
    const read = vi
      .fn<() => Promise<ShellAuthState>>()
      .mockResolvedValueOnce(doctor)
      .mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useShellAuth(read));
    await waitFor(() => expect(result.current).toEqual(doctor));

    await act(async () => {
      refreshShellAuth();
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual(doctor);
  });
});
