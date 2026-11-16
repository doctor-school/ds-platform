import { describe, expect, it, vi } from "vitest";
import type { FeedSourcesRepository } from "../feed-sources.repository.js";
import { FakeTelegramBotApi } from "./telegram-bot-api.fake.js";
import { TelegramSourceCheck } from "./telegram-source-check.service.js";

describe("048 Telegram source check schedule", () => {
  it("048 EARS-31: the hourly check runs for every switched-on Telegram source, and a failing source never stops the run or the process", async () => {
    const repo = {
      enabledTelegramSourceIds: vi.fn(async () => ["a", "b", "c"]),
    } as unknown as FeedSourcesRepository;
    const service = new TelegramSourceCheck(
      null,
      new FakeTelegramBotApi(),
      repo,
    );
    const seen: string[] = [];
    vi.spyOn(service, "check").mockImplementation(async (id: string) => {
      seen.push(id);
      return undefined;
    });
    await service.checkAll();
    expect(seen).toEqual(["a", "b", "c"]);

    vi.mocked(repo.enabledTelegramSourceIds).mockRejectedValueOnce(
      new Error("database down"),
    );
    await expect(service.checkAll()).resolves.toBeUndefined();
  });
});
