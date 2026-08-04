import { describe, expect, it, vi } from "vitest";

import {
  applyRuntimeConfigs,
  runtimeConfigComparisonScript,
  runtimeConfigRestartScript,
  runtimeConfigServicesToRestart,
} from "../../deploy/prod.mjs";

describe("deploy runtime config apply (#1175)", () => {
  it("does not restart either service when both running mounts match", async () => {
    const compare = vi.fn().mockResolvedValue("caddy=match\ncentrifugo=match");
    const restart = vi.fn();

    await expect(
      applyRuntimeConfigs({ compare, restart, log: vi.fn() }),
    ).resolves.toEqual({ restarted: [] });
    expect(compare).toHaveBeenCalledTimes(2);
    expect(restart).not.toHaveBeenCalled();
  });

  it("restarts only the service whose running mount is stale", async () => {
    const compare = vi
      .fn()
      .mockResolvedValueOnce("caddy=match\ncentrifugo=mismatch")
      .mockResolvedValueOnce("caddy=match\ncentrifugo=match");
    const restart = vi.fn();

    await expect(
      applyRuntimeConfigs({ compare, restart, log: vi.fn() }),
    ).resolves.toEqual({ restarted: ["centrifugo"] });
    expect(restart).toHaveBeenCalledWith(
      expect.stringContaining("docker compose restart centrifugo"),
    );
    expect(restart.mock.calls[0][0]).not.toContain("restart caddy");
  });

  it("fails closed when a restarted mount still does not match", async () => {
    const compare = vi
      .fn()
      .mockResolvedValue("caddy=mismatch\ncentrifugo=match");

    await expect(
      applyRuntimeConfigs({ compare, restart: vi.fn(), log: vi.fn() }),
    ).rejects.toThrow("did not mount the shipped file(s): caddy");
  });

  it("treats missing comparison evidence as stale and can restart both", () => {
    const services = runtimeConfigServicesToRestart("");

    expect(services).toEqual(["caddy", "centrifugo"]);
    expect(runtimeConfigRestartScript(services)).toContain(
      "docker compose restart caddy centrifugo",
    );
  });

  it("compares the shipped files with the actual running mounts", () => {
    const script = runtimeConfigComparisonScript();

    expect(script).toContain("docker cp");
    expect(script).toContain("Caddyfile /etc/caddy/Caddyfile");
    expect(script).toContain("centrifugo/config.json /centrifugo/config.json");
  });
});
