import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeCommand } from "../api-probes/native-pg.js";
afterEach(() => vi.unstubAllEnvs());
describe("native PostgreSQL service transport", () => {
  it("uses argv locally and quotes remote arguments without shell interpolation", () => {
    vi.stubEnv("E2E_API_PROBE_PG_CONTAINER", "owned-pg");
    vi.stubEnv("E2E_API_PROBE_PG_SSH_HOST", "");
    expect(nativeCommand(["psql", "-d", "ds_dev_3688"])).toEqual({
      executable: "docker",
      args: ["exec", "-i", "owned-pg", "psql", "-d", "ds_dev_3688"],
    });
    vi.stubEnv("E2E_API_PROBE_PG_SSH_HOST", "task-host");
    expect(
      nativeCommand(["bash", "-c", "printf '%s' \"$value\""]).args[1],
    ).toContain("'printf '\\''%s'\\'' \"$value\"'");
  });
  it("honors all canonical recipe sudo spellings", () => {
    vi.stubEnv("E2E_API_PROBE_PG_CONTAINER", "owned-pg");
    vi.stubEnv("E2E_API_PROBE_PG_SSH_HOST", "task-host");
    for (const value of ["1", "true", "yes"]) {
      vi.stubEnv("E2E_API_PROBE_PG_SUDO", value);
      expect(nativeCommand(["pg_restore", "--version"]).args[1]).toMatch(
        /^sudo docker /,
      );
    }
  });
  it("refuses an absent container and metacharacters in transport identifiers", () => {
    vi.stubEnv("E2E_API_PROBE_PG_CONTAINER", "");
    expect(() => nativeCommand(["psql"])).toThrow();
    vi.stubEnv("E2E_API_PROBE_PG_CONTAINER", "owned-pg");
    vi.stubEnv("E2E_API_PROBE_PG_SSH_HOST", "host; false");
    expect(() => nativeCommand(["psql"])).toThrow();
  });
});
