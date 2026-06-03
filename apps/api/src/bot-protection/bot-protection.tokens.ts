/**
 * DI token for the {@link BotProtection} provider (design §10.1).
 *
 * Call sites inject the interface by this token, never a concrete adapter, so
 * the provider is swappable (ADR-0001 open-q #7: SmartCaptcha default,
 * alternatives → DSO-26) without touching a single consumer.
 */
export const BOT_PROTECTION = Symbol("BOT_PROTECTION");
