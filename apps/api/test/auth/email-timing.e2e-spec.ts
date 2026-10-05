import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { Test } from "@nestjs/testing";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import {
  AUTH_AUDIT,
  type AuthAuditLog,
} from "../../src/auth/session/auth-audit.types.js";
import {
  ZitadelIdpClient,
  type FetchLike,
} from "../../src/auth/idp/zitadel.idp.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { SmtpMailer } from "../../src/mailer/smtp-mailer.js";
import { createBoundedSmtpTransport } from "../../src/mailer/smtp-transport.js";
import { ChannelRejection } from "../../src/mailer/relay-channel.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  DEFAULT_TIMING_ROUNDS,
  describeTiming,
  medianSpread,
  sampleInterleaved,
} from "../support/timing-oracle.js";

// Actual controller -> AuthService -> Zitadel adapter -> SmtpMailer. Only the
// native IdP API is simulated; no provider credentials or external emails.
describe.skipIf(!process.env.DATABASE_URL)("003 email response timing", () => {
  it.each([
    "smtp-stall",
    "fallback-stall",
    "fallback-accept",
    "configuration",
  ] as const)(
    "EARS-16: register/resend/reset keep known and unknown HTTP timing within 50 ms during %s",
    async (scenario) => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        // Deliberately never send an SMTP greeting: a real owned stalled socket.
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No test port");
      const relayFailure = vi.fn();
      const failover = vi.fn();
      const accepted = vi.fn();
      const fallback = scenario.startsWith("fallback-");
      let fallbackFinished = 0;
      const mailer = new SmtpMailer({
        intercept: {
          host: "127.0.0.1",
          port: address.port,
          from: "sender@ds.test",
        },
        real:
          scenario === "configuration"
            ? {}
            : {
                provider: "postbox",
                host: "postbox.cloud.yandex.net",
                port: 465,
                user: "test",
                password: "test",
                from: "sender@ds.test",
              },
        isEnabled: () => scenario !== "smtp-stall",
        portalBaseUrl: "https://portal.ds.test",
        observability: { relayFailure, failover, accepted },
        transportFactory: fallback
          ? () => ({
              sendMail: async () => {
                throw new ChannelRejection("535", "Rejected");
              },
            })
          : (options) =>
              createBoundedSmtpTransport(options, {
                connection: 300,
                greeting: 300,
                socket: 300,
                absolute: 350,
              }),
        resend: {
          enabled: fallback,
          apiKey: "test",
          fetchFn: (async () => {
            // Exercise the actual Resend channel with delayed final rejection.
            await new Promise((resolve) => setTimeout(resolve, 350));
            fallbackFinished++;
            return new Response("", {
              status: scenario === "fallback-accept" ? 200 : 503,
            });
          }) as typeof fetch,
        },
      });
      const email = `timing-${randomUUID()}@ds.test`;
      const ghost = `timing-${randomUUID()}@ds.test`;
      const sub = randomUUID();
      // The register "new account" class needs a fresh address per measured
      // round; `email` is registered in the warm-up round and is the
      // duplicate class from then on (#2591).
      const fresh = Array.from(
        { length: DEFAULT_TIMING_ROUNDS },
        () => `timing-${randomUUID()}@ds.test`,
      );
      const rounds = DEFAULT_TIMING_ROUNDS + 1; // warm-up + measured
      const subs = new Map<string, string>();
      const addressIn = (body?: string) =>
        [email, ...fresh].find((address) => body?.includes(address));
      const nativeCalls: string[] = [];
      const fetchImpl: FetchLike = async (url, init) => {
        const path = new URL(url).pathname;
        nativeCalls.push(path);
        const ok = (body: unknown, status = 200) => ({
          ok: status < 300,
          status,
          json: async () => body,
        });
        if (path === "/v2/users/new") {
          const address = addressIn(init.body);
          if (!address) throw new Error("Unexpected registration address");
          if (subs.has(address)) return ok({}, 409);
          const id = address === email ? sub : randomUUID();
          subs.set(address, id);
          return ok({ id, emailCode: "NATIVE1" });
        }
        if (path.endsWith("/CreateAuthorization")) return ok({});
        if (path.endsWith("/email/resend") || path.endsWith("/password_reset"))
          return ok({ verificationCode: "NATIVE1" });
        throw new Error("Unexpected native path");
      };
      const idp = new ZitadelIdpClient({
        baseUrl: "https://idp.ds.test",
        serviceToken: "test",
        orgId: "test",
        projectId: "test",
        mailer,
        fetchImpl: async (url, init) => {
          if (new URL(url).pathname === "/v2/users") {
            const address = addressIn(init.body);
            const known =
              address === email || (address !== undefined && subs.has(address));
            return {
              ok: true,
              status: 200,
              json: async () => ({
                result: known
                  ? [
                      {
                        userId: subs.get(address!) ?? sub,
                        human: { email: { email: address, isVerified: false } },
                      },
                    ]
                  : [],
              }),
            };
          }
          return fetchImpl(url, init);
        },
      });
      let app: NestFastifyApplication | undefined;
      let pool: pg.Pool | undefined;
      try {
        const module = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(idp)
          .overrideProvider(MAILER)
          .useValue(mailer)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .compile();
        app = module.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
        pool = app.get<pg.Pool>(DRIZZLE_POOL);
        const audit = vi.spyOn(app.get<AuthAuditLog>(AUTH_AUDIT), "record");
        await app.inject({ method: "GET", url: "/v1/health" });
        const request = (url: string, identifier: string) =>
          app!.inject({
            method: "POST",
            url,
            payload: url.endsWith("/register")
              ? {
                  email: identifier,
                  password: "long-enough-password",
                  consent: [{ purpose: "tos", version: "2026-01" }],
                }
              : { identifier },
          });
        for (const route of [
          "/v1/auth/register",
          "/v1/auth/verify/resend",
          "/v1/auth/password/reset",
        ]) {
          const register = route.endsWith("/register");
          // Known vs unknown, interleaved; register compares a NEW account
          // (warm-up `email`, then a fresh address per round) with the
          // duplicate `email`. The band bounds the medians (#2591).
          const timing = await sampleInterleaved([
            (round) =>
              request(route, register && round > 0 ? fresh[round - 1]! : email),
            () => request(route, register ? email : ghost),
          ]);
          const first = timing[0]!;
          const second = timing[1]!;
          const reference = first.results[0]!;
          expect(reference.statusCode).toBe(200);
          for (const response of [...first.results, ...second.results]) {
            expect(response.statusCode).toBe(reference.statusCode);
            expect(response.json()).toEqual(reference.json());
            expect(response.body).not.toContain("NATIVE1");
          }
          expect.soft(medianSpread(timing)).toBeLessThanOrEqual(50);
          expect
            .soft(Math.max(...first.samples, ...second.samples))
            .toBeLessThan(200);
          console.info(
            `EARS-16 ${scenario} ${route}: ${describeTiming(timing)} ms`,
          );
        }
        // Wait for every real delivery attempt before fixture teardown — per
        // round: new account, resend, reset; plus ONE account-exists notice,
        // since the per-address notice throttle sends the duplicate `email`
        // a single notice however often it re-registers. Failed resend must
        // not create a success row.
        const deliveries = 3 * rounds + 1;
        await vi.waitFor(
          () =>
            expect(
              scenario === "fallback-accept" ? accepted : relayFailure,
            ).toHaveBeenCalledTimes(deliveries),
          { timeout: 5000 },
        );
        await vi.waitFor(() =>
          expect(
            audit.mock.calls.filter(([event]) => event.type === "OtpSent"),
          ).toHaveLength(scenario === "fallback-accept" ? rounds : 0),
        );
        expect(
          audit.mock.calls.filter(
            ([event]) => event.type === "PasswordResetRequested",
          ),
        ).toHaveLength(2 * rounds);
        expect(
          nativeCalls.filter((p) => p.endsWith("/email/resend")),
        ).toHaveLength(rounds);
        expect(
          nativeCalls.filter((p) => p.endsWith("/password_reset")),
        ).toHaveLength(rounds);
        if (fallback) {
          expect(failover).toHaveBeenCalledTimes(deliveries);
          expect(fallbackFinished).toBe(deliveries);
        }
        const { rows } = await pool.query(
          "SELECT event_type, metadata::text FROM audit_ledger WHERE subject_id = $1",
          [sub],
        );
        expect(
          rows.filter((row) => row.event_type === "auth.register"),
        ).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain("NATIVE1");
      } finally {
        // All listeners belong to this test, never to the shared stand.
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (pool)
          for (const address of [email, ...fresh])
            await deleteUserFixture(pool, "email", address);
        await app?.close();
      }
    },
    15000,
  );
});
