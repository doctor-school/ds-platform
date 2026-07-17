import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Form, FormField } from "@ds/design-system/form";
import { OtpField } from "@ds/design-system/fields";

import { flushOrphanTimers } from "./orphan-timers.setup";

/**
 * #434 — orphan-timer guard (the vitest.setup.ts tracking installed for every
 * portal suite). `input-otp@1.4.2` schedules a 0/10/50ms `setTimeout` triple on
 * every value/focus change (its `syncTimeouts` helper) and returns NO cleanup
 * from the scheduling effect, so a timer scheduled by the last keystrokes of a
 * suite outlives the file's JSDOM environment and throws
 * `ReferenceError: window is not defined` inside React's state dispatch — the
 * intermittent `unit`-job red this guard makes impossible (same class as #405,
 * different root timer).
 *
 * The tracking itself is installed once in vitest.setup.ts; these tests pin the
 * helper's contract: pending timers are tracked, fired/cleared timers are not,
 * `flushOrphanTimers()` defuses what remains (it must never fire after a flush),
 * and orphans are classified by their scheduling stack — the known upstream
 * defect (`input-otp` frames) versus a foreign leak our own code must fix.
 */

function SlottedHarness() {
  const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="code"
        render={({ field }) => (
          <OtpField
            field={field as ControllerRenderProps<{ code: string }>}
            length={6}
            variant="slotted"
            charset="numeric"
            label="Code"
          />
        )}
      />
    </Form>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("#434 orphan-timer tracking (vitest.setup.ts)", () => {
  it("#434: a pending timeout is reported as an orphan and never fires after the flush", async () => {
    const cb = vi.fn();
    setTimeout(cb, 30);

    const { foreign, known } = flushOrphanTimers();
    expect(known).toHaveLength(0);
    expect(foreign).toHaveLength(1);
    expect(foreign[0].stack).toContain("orphan-timers.test");

    // The flush must have defused the handle — give it 3× its delay to prove it.
    await wait(90);
    expect(cb).not.toHaveBeenCalled();
  });

  it("#434: a fired timeout is untracked — nothing to flush", async () => {
    const cb = vi.fn();
    setTimeout(cb, 0);
    await wait(10);

    expect(cb).toHaveBeenCalledTimes(1);
    const { foreign, known } = flushOrphanTimers();
    expect(foreign).toHaveLength(0);
    expect(known).toHaveLength(0);
  });

  it("#434: clearTimeout untracks the handle", () => {
    const cb = vi.fn();
    const handle = setTimeout(cb, 1000);
    clearTimeout(handle);

    const { foreign, known } = flushOrphanTimers();
    expect(foreign).toHaveLength(0);
    expect(known).toHaveLength(0);
  });

  it("#434: tracking survives a fake-timer cycle (vi.useFakeTimers/useRealTimers)", () => {
    vi.useFakeTimers();
    try {
      // Under fake timers the mock owns scheduling — nothing leaks into tracking.
      setTimeout(vi.fn(), 1000);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }

    const cb = vi.fn();
    setTimeout(cb, 1000);
    const { foreign } = flushOrphanTimers();
    expect(foreign).toHaveLength(1);
  });

  it("#434: input-otp's uncleaned syncTimeouts survive unmount and are classified as the known upstream defect", async () => {
    const user = userEvent.setup();
    render(<SlottedHarness />);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("1");

    // Unmount immediately — the 0/10/50ms sync triple from the last value change
    // is still pending (input-otp returns no effect cleanup). This is the exact
    // state a suite's last test leaves the environment in.
    cleanup();

    const { known, foreign } = flushOrphanTimers();
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((o) => /input-otp/.test(o.stack))).toBe(true);
    expect(foreign).toHaveLength(0);
  });
});
