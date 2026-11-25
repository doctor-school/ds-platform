import {
  FEED_VK_MONTHLY_CALL_WARN,
  feedSourceAddressError,
  normalizeFeedSourceAddressFor,
  type FeedSourceNetwork,
} from "@ds/schemas";

/**
 * 048 EARS-21 / EARS-38 — a source as «Источники» lists it: the stored
 * lowercase name behind its platform's host (`t.me/<имя>`, `vk.com/<имя>`).
 */
export function feedSourceAddressLabel(
  platform: FeedSourceNetwork,
  address: string,
): string {
  return platform === "vk" ? `vk.com/${address}` : `t.me/${address}`;
}

/**
 * The address field's check: `true` when the API's own normalizer for the
 * platform accepts the value, else that platform's RU field sentence.
 */
export function feedSourceAddressFieldError(
  platform: FeedSourceNetwork,
  value: string,
): true | string {
  return normalizeFeedSourceAddressFor(platform, value) === null
    ? feedSourceAddressError(platform)
    : true;
}

/** EARS-44 — the month's VK calls have reached the warning threshold (8 000). */
export function vkCallsNearCap(calls: number): boolean {
  return calls >= FEED_VK_MONTHLY_CALL_WARN;
}
