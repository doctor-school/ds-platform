import { describe, expect, it } from "vitest";

import {
  hasActiveProjectCurator,
  hasActiveProjectPrimaryPartner,
  relationshipPickerState,
} from "@/lib/relationship-authoring-state";

describe("reverse relationship authoring state", () => {
  it("EARS-22: derives explicit loading, error, empty and ready picker states", () => {
    expect(
      relationshipPickerState({
        isLoading: true,
        isError: false,
        optionCount: 0,
      }),
    ).toEqual({ kind: "loading", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: true,
        optionCount: 0,
      }),
    ).toEqual({ kind: "error", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: false,
        optionCount: 0,
      }),
    ).toEqual({ kind: "empty", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: false,
        optionCount: 2,
      }),
    ).toEqual({ kind: "ready", selectDisabled: false });
  });

  it("EARS-22: an active curator occupies only the selected project curator seat", () => {
    expect(
      hasActiveProjectCurator([
        { status: "retired", role: "curator" },
        { status: "active", role: "member" },
      ]),
    ).toBe(false);
    expect(
      hasActiveProjectCurator([{ status: "active", role: "curator" }]),
    ).toBe(true);
  });

  it("EARS-22: an active primary occupies only the selected project primary seat", () => {
    expect(
      hasActiveProjectPrimaryPartner([
        { status: "retired", isPrimary: true },
        { status: "active", isPrimary: false },
      ]),
    ).toBe(false);
    expect(
      hasActiveProjectPrimaryPartner([{ status: "active", isPrimary: true }]),
    ).toBe(true);
  });
});
