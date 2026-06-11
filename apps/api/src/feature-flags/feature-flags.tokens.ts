/**
 * DI token for the {@link FeatureFlags} port (#185).
 *
 * Call sites (the bot-protection provider, the delivery reconcile) inject the
 * interface by this token, never the concrete Unleash-backed service, so the SDK
 * is swappable and the unit specs inject a fake.
 */
export const FEATURE_FLAGS = Symbol("FEATURE_FLAGS");
