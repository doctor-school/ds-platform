/** DI token carrying the configured Zitadel Action webhook shared secret (EARS-19). */
export const AUTH_WEBHOOK_SECRET = Symbol("AUTH_WEBHOOK_SECRET");

/** Header the Zitadel Action webhook presents its shared secret in (lower-cased by Fastify). */
export const WEBHOOK_SECRET_HEADER = "x-zitadel-webhook-secret";
