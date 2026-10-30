import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as dbSchema from "@ds/db";
import { AppModule } from "../../src/app.module.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { MediaSlotRegistry } from "../../src/taxonomy/media/media-slot.registry.js";

// #3572 — schema coverage of the ONE media-slot registry both sweeps' reference
// predicate iterates. Every `*_ref` column in `packages/db/src/schema/` is a
// media slot unless it is listed below with the reason no sweep is ever handed
// its value. The registry is read from the BOOTED app, so a slot a module
// outside taxonomy registers in its own `onModuleInit` counts — and a slot
// nobody registered fails here instead of being deleted after its window.

/** `table.column` → why it is not a media slot of the two sweeps. */
const NOT_MEDIA_SLOTS: Readonly<Record<string, string>> = {
  "event_recordings.embed_ref":
    "provider-scoped stream id (006 provider abstraction), not an object-storage key",
  "stream_config.embed_ref":
    "provider-scoped stream id (006 provider abstraction), not an object-storage key",
  "event_recordings.poster_ref":
    "operator-entered poster reference string; never uploaded through the taxonomy pipeline",
  "events.partner_ref": "free-text sponsor / partner reference (wave 1)",
  "events.program_pdf_ref":
    "object key written by EventsService.storeProgramPdf, which notes no upload locator and enqueues no cleanup job — neither sweep is ever handed it",
};

function schemaRefColumns(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(dbSchema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const column of config.columns) {
      if (column.name.endsWith("_ref"))
        names.add(`${config.name}.${column.name}`);
    }
  }
  return [...names].sort();
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "3572 media-slot registry schema coverage (e2e)",
  () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      // init() runs every module's onModuleInit — where an outside slot registers.
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it("3572: every *_ref media column in packages/db/src/schema/ shall be registered as a media slot of the booted app", () => {
      const registered = new Set(app.get(MediaSlotRegistry).names());
      const refColumns = schemaRefColumns();
      // The scan itself must see the schema — an empty scan proves nothing.
      expect(refColumns).toContain("organisations.logo_ref");
      const missing = refColumns.filter(
        (name) => !registered.has(name) && !(name in NOT_MEDIA_SLOTS),
      );
      expect(missing).toEqual([]);
    });

    it("3572: the not-a-media-slot list shall name only real, unregistered schema columns", () => {
      const registered = new Set(app.get(MediaSlotRegistry).names());
      const refColumns = new Set(schemaRefColumns());
      for (const name of Object.keys(NOT_MEDIA_SLOTS)) {
        expect(refColumns.has(name), `${name} is not a schema column`).toBe(
          true,
        );
        expect(registered.has(name), `${name} is registered`).toBe(false);
      }
    });

    it("3572: the registry shall hold the three taxonomy slots", () => {
      expect(app.get(MediaSlotRegistry).names()).toEqual(
        expect.arrayContaining([
          "projects.cover_ref",
          "experts.photo_ref",
          "organisations.logo_ref",
        ]),
      );
    });
  },
);
