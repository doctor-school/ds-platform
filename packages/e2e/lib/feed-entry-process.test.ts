import { describe, expect, it } from "vitest";
import { assertFeedEntryProcessIdentity } from "./feed-entry.js";

const linuxNext = {
  name: "doctor" as const,
  platform: "linux" as const,
  root: "/checkout/task3751",
  command: "next-server (v16.4.1)",
  cwd: "/checkout/task3751/apps/doctor",
  executable: "/opt/node/bin/node",
  nodeExecutable: "/opt/node/bin/node",
};
describe("017 feed-entry listener process identity", () => {
  it("EARS-1: accepts the observed Linux Next title only with the exact worktree cwd and Node executable", () => {
    expect(() => assertFeedEntryProcessIdentity(linuxNext)).not.toThrow();
    expect(() =>
      assertFeedEntryProcessIdentity({
        ...linuxNext,
        cwd: "/checkout/foreign/apps/doctor",
      }),
    ).toThrow("worktree cwd");
    expect(() =>
      assertFeedEntryProcessIdentity({
        ...linuxNext,
        executable: "/foreign/bin/program",
      }),
    ).toThrow("Node executable");
    expect(() =>
      assertFeedEntryProcessIdentity({
        ...linuxNext,
        command: "unrelated-server",
      }),
    ).toThrow("process identity");
  });
  it("EARS-1: retains exact compiled API identity and refuses a same-title API substitute", () => {
    const api = {
      ...linuxNext,
      name: "api" as const,
      cwd: "/checkout/task3751/apps/api",
      command: "node /checkout/task3751/apps/api/dist/main.js",
    };
    expect(() => assertFeedEntryProcessIdentity(api)).not.toThrow();
    expect(() =>
      assertFeedEntryProcessIdentity({ ...api, command: linuxNext.command }),
    ).toThrow("process identity");
    expect(() =>
      assertFeedEntryProcessIdentity({
        ...api,
        cwd: "/checkout/foreign/apps/api",
      }),
    ).toThrow("worktree cwd");
  });
  it("EARS-1: retains the absolute worktree entry requirement on Windows", () => {
    const next = {
      ...linuxNext,
      platform: "win32" as const,
      root: "C:/repo/3751",
      command: "node C:\\repo\\3751\\node_modules\\next\\dist\\bin\\next start",
    };
    expect(() => assertFeedEntryProcessIdentity(next)).not.toThrow();
    expect(() =>
      assertFeedEntryProcessIdentity({
        ...next,
        command:
          "node C:\\repo\\foreign\\node_modules\\next\\dist\\bin\\next start",
      }),
    ).toThrow("process identity");
  });
});
