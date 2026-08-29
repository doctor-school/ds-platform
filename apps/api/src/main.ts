import "reflect-metadata";
import { createApiApplication } from "./api-application.js";
import { initSentry } from "./observability/instrument.js";

async function bootstrap(): Promise<void> {
  // Error monitoring (GlitchTip, DSO-125) — initialised BEFORE the app so the
  // SDK's global handlers register first. No-op when SENTRY_DSN is unset.
  initSentry();
  const app = await createApiApplication();
  // Enable shutdown hooks so OnModuleDestroy fires on SIGTERM/SIGINT — the
  // Unleash SDK poll timer (FeatureFlagsService) and the delivery-reconcile
  // subscription are cleaned up on a graceful stop (#185).
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}

void bootstrap();
