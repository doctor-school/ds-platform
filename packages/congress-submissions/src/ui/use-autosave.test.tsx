import { act, renderHook } from "@testing-library/react";

import { useAutosave } from "./use-autosave";

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("EARS-7: saves 1.5 s after the last change, the whole latest value once", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => result.current.schedule({ title: "a" }));
    expect(result.current.state).toBe("saving");
    await act(async () => vi.advanceTimersByTime(1000));
    act(() => result.current.schedule({ title: "ab" }));
    await act(async () => vi.advanceTimersByTime(1499));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "ab" }, { keepalive: false });
    expect(result.current.state).toBe("saved");
    expect(result.current.savedAt).not.toBeNull();
  });

  it("EARS-7: a flush (blur) saves at once without waiting for the pause", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.schedule({ title: "x" }));
    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("EARS-7: a failed save shows the failure and retries on its own", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.schedule({ title: "x" }));
    await act(async () => vi.advanceTimersByTime(1500));
    expect(result.current.state).toBe("failed");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("saved");
  });

  it("EARS-7: hiding the page flushes the pending change with keepalive", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.schedule({ title: "x" }));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(save).toHaveBeenCalledWith({ title: "x" }, { keepalive: true });
  });
});
