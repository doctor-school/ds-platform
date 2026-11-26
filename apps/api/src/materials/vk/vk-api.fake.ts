import {
  VkApiError,
  type VkApi,
  type VkCallCounter,
  type VkCallOutcome,
  type VkGroup,
  type VkGroupRef,
  type WallGetParams,
  type WallPage,
} from "./vk-api.types.js";

/**
 * In-memory {@link VkApi} — the test double of ADR-0011 channel #11 (048
 * V-25…V-31). Records every call by method so a suite can assert exactly what
 * reached "VK" (only `wall.get` and `groups.getById` can), and answers from
 * the tables a suite fills. Contract parity: an unknown community answers the
 * VK error the real client turns into a {@link VkApiError}.
 */
export class FakeVkApi implements VkApi {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** Communities by id; `groups.getById` also finds them by screen name. */
  readonly groups = new Map<number, VkGroup>();
  /** The wall of each community id, newest first (raw VK post objects). */
  readonly walls = new Map<number, unknown[]>();
  /**
   * While set, every call fails with this transport outcome after being
   * recorded — "VK is unreachable" (EARS-44, EARS-45).
   */
  outage: Extract<VkCallOutcome, "timeout" | "network_error"> | null = null;
  /** While set, every call answers this VK error code (an `api_error`). */
  apiErrorCode: number | null = null;
  /**
   * While set, every call is counted here before it is answered, as the real
   * client counts each call before its request (EARS-44, EARS-46).
   */
  counter: VkCallCounter | null = null;

  reset(): void {
    this.calls.length = 0;
    this.groups.clear();
    this.walls.clear();
    this.outage = null;
    this.apiErrorCode = null;
    this.counter = null;
  }

  async wallGet(params: WallGetParams): Promise<WallPage> {
    await this.record("wall.get", params);
    const wall = this.walls.get(-params.owner_id);
    if (!wall) throw new VkApiError("wall.get", "api_error", 200, 100);
    const offset = params.offset ?? 0;
    return {
      count: wall.length,
      items: wall.slice(offset, offset + params.count),
    };
  }

  async groupsGetById(group: VkGroupRef): Promise<VkGroup[]> {
    await this.record("groups.getById", group);
    const found =
      typeof group === "number"
        ? this.groups.get(group)
        : [...this.groups.values()].find(
            (g) =>
              g.screen_name?.toLowerCase() === group ||
              `club${g.id}` === group ||
              `public${g.id}` === group,
          );
    if (!found) throw new VkApiError("groups.getById", "api_error", 200, 100);
    return [found];
  }

  private async record(method: string, ...args: unknown[]): Promise<void> {
    this.calls.push({ method, args });
    await this.counter?.count();
    if (this.outage) throw new VkApiError(method, this.outage, null, null);
    if (this.apiErrorCode !== null) {
      throw new VkApiError(method, "api_error", 200, this.apiErrorCode);
    }
  }
}
