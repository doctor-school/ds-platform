import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STALL_BUDGET_BUILD_MS,
  STALL_BUDGET_DEFAULT_MS,
  createStallWatchdog,
  formatStallMessage,
  sshBaseArgs,
} from "../../deploy/prod.mjs";
import {
  classifyProbe,
  formatProbeLine,
  gatherProbe,
  parseDockerPs,
} from "../../deploy/deploy-probe.mjs";

/**
 * Unit cover for the #905 deploy stall detector: the ssh keepalive arg builder
 * and the per-step inactivity watchdog in `tools/deploy/prod.mjs`, plus the
 * box-reality probe `tools/deploy/deploy-probe.mjs`. Only the pure half is
 * tested (same harness pattern as dispatch-probe.spec.ts — imports the pure
 * exports through the invoke-guard, never fires `main()`); the watchdog runs
 * on vitest fake timers, so nothing here sleeps, shells out, or touches ssh /
 * the network.
 */

describe("deploy-stall sshBaseArgs()", () => {
  it("carries the keepalive flags before the host (channel dies loudly, never half-open)", () => {
    expect(sshBaseArgs("ds-api-prod")).toEqual([
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "ds-api-prod",
    ]);
  });

  it("is spreadable in front of the remote command", () => {
    const argv = [...sshBaseArgs("ds-data-prod"), "echo ok"];
    expect(argv[argv.length - 2]).toBe("ds-data-prod");
    expect(argv[argv.length - 1]).toBe("echo ok");
  });
});

describe("deploy-stall budgets", () => {
  it("build-class steps get 5 min, everything else 2 min", () => {
    expect(STALL_BUDGET_BUILD_MS).toBe(5 * 60 * 1000);
    expect(STALL_BUDGET_DEFAULT_MS).toBe(2 * 60 * 1000);
  });
});

describe("deploy-stall formatStallMessage()", () => {
  const msg = formatStallMessage(
    "api-prod deploy",
    STALL_BUDGET_BUILD_MS,
    "ds-api-prod",
  );

  it("is loud, names the step and the budget in minutes", () => {
    expect(msg).toContain("STALLED: api-prod deploy");
    expect(msg).toContain("no output for 5m");
  });

  it("warns the remote work MAY have completed (a stall is not a rollback cue)", () => {
    expect(msg).toContain("remote work MAY have completed");
  });

  it("names pnpm deploy:probe plus the hand-verification commands", () => {
    expect(msg).toContain("pnpm deploy:probe");
    expect(msg).toContain(
      "curl -fsS https://api.doctor.school/v1/health",
    );
    expect(msg).toContain("ssh ds-api-prod docker ps");
  });
});

describe("deploy-stall createStallWatchdog() (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips after the budget with no data and reports the step name", () => {
    const stalls: string[] = [];
    createStallWatchdog({
      label: "pgbackrest checkpoint",
      budgetMs: STALL_BUDGET_DEFAULT_MS,
      host: "ds-data-prod",
      onStall: (m) => stalls.push(m),
    });
    vi.advanceTimersByTime(STALL_BUDGET_DEFAULT_MS - 1);
    expect(stalls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toContain("STALLED: pgbackrest checkpoint");
    expect(stalls[0]).toContain("pnpm deploy:probe");
  });

  it("data chunks reset the timer — a long quiet-ish build with flowing output never trips", () => {
    const stalls: string[] = [];
    const wd = createStallWatchdog({
      label: "api-prod deploy",
      budgetMs: STALL_BUDGET_BUILD_MS,
      host: "ds-api-prod",
      onStall: (m) => stalls.push(m),
    });
    // 20 minutes of output arriving every 4 minutes: never a 5-min gap.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(4 * 60 * 1000);
      wd.touch();
    }
    expect(stalls).toEqual([]);
    // Then output stops entirely → trips exactly one budget later.
    vi.advanceTimersByTime(STALL_BUDGET_BUILD_MS);
    expect(stalls).toHaveLength(1);
  });

  it("fires at most once, and never after stop()", () => {
    const stalls: string[] = [];
    const wd = createStallWatchdog({
      label: "caddy reload",
      budgetMs: STALL_BUDGET_DEFAULT_MS,
      host: "ds-api-prod",
      onStall: (m) => stalls.push(m),
    });
    wd.stop();
    vi.advanceTimersByTime(10 * STALL_BUDGET_DEFAULT_MS);
    expect(stalls).toEqual([]);
    // touch() after stop() must not re-arm.
    wd.touch();
    vi.advanceTimersByTime(10 * STALL_BUDGET_DEFAULT_MS);
    expect(stalls).toEqual([]);
  });
});

describe("deploy-probe parseDockerPs()", () => {
  it("maps the prod container names to roles and keeps image + status", () => {
    const out = [
      "ds-api-prod-api-1\tds-api:abc123\tUp 2 hours (healthy)",
      "ds-api-prod-portal-1\tds-portal:abc123\tUp 2 hours (healthy)",
      "ds-api-prod-admin-1\tds-admin:abc123\tUp 2 hours (healthy)",
      "ds-api-prod-caddy-1\tcaddy:2\tUp 3 days",
      "",
    ].join("\n");
    expect(parseDockerPs(out)).toEqual({
      api: { image: "ds-api:abc123", status: "Up 2 hours (healthy)" },
      portal: { image: "ds-portal:abc123", status: "Up 2 hours (healthy)" },
      admin: { image: "ds-admin:abc123", status: "Up 2 hours (healthy)" },
    });
  });

  it("tolerates missing containers (empty ps) — reachable box, nothing running", () => {
    expect(parseDockerPs("")).toEqual({});
  });
});

describe("deploy-probe classifyProbe() + formatProbeLine()", () => {
  const sha = "88514b60c93d88514b60c93d88514b60c93d8851";
  const containers = {
    api: { image: `ds-api:${sha}`, status: "Up 2 hours (healthy)" },
    portal: { image: `ds-portal:${sha}`, status: "Up 2 hours (healthy)" },
    admin: { image: `ds-admin:${sha}`, status: "Up 2 hours (healthy)" },
  };

  it("healthy inputs → one machine-parseable LIVE line, whitespace collapsed", () => {
    const line = formatProbeLine({ healthSha: sha, containers });
    expect(line).toBe(
      `LIVE health=${sha}` +
        ` api=ds-api:${sha}(Up_2_hours_(healthy))` +
        ` portal=ds-portal:${sha}(Up_2_hours_(healthy))` +
        ` admin=ds-admin:${sha}(Up_2_hours_(healthy))`,
    );
    expect(line).not.toMatch(/\n/);
  });

  it("both sources down → UNREACHABLE line that still parses field-wise", () => {
    expect(formatProbeLine({ healthSha: null, containers: null })).toBe(
      "UNREACHABLE health=UNREACHABLE containers=UNREACHABLE",
    );
  });

  it("one source down → DEGRADED, per-field graceful degradation", () => {
    expect(classifyProbe({ healthSha: sha, containers: null })).toBe(
      "DEGRADED",
    );
    expect(formatProbeLine({ healthSha: sha, containers: null })).toBe(
      `DEGRADED health=${sha} containers=UNREACHABLE`,
    );
    const line = formatProbeLine({ healthSha: null, containers });
    expect(line.startsWith("DEGRADED health=UNREACHABLE api=")).toBe(true);
  });

  it("reachable box with a missing container reports absent for that role", () => {
    const partial = { api: containers.api };
    const line = formatProbeLine({ healthSha: sha, containers: partial });
    expect(line).toContain(" portal=absent");
    expect(line).toContain(" admin=absent");
  });
});

describe("deploy-probe gatherProbe() (injectable seams — no network)", () => {
  it("collects both fields from the injected runners", async () => {
    const probe = await gatherProbe({
      fetchHealth: async () => "abc123",
      sshDockerPs: async () => ({
        api: { image: "ds-api:abc123", status: "Up 1 minute" },
      }),
    });
    expect(probe.healthSha).toBe("abc123");
    expect(probe.containers).toEqual({
      api: { image: "ds-api:abc123", status: "Up 1 minute" },
    });
  });

  it("a throwing runner degrades that field to null, never rejects", async () => {
    const probe = await gatherProbe({
      fetchHealth: async () => {
        throw new Error("timeout");
      },
      sshDockerPs: () => {
        throw new Error("ssh dead");
      },
    });
    expect(probe).toEqual({ healthSha: null, containers: null });
  });
});
