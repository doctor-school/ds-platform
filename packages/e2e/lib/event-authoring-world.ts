import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import {
  EventCountWorld,
  countDirectory,
  countOperation,
} from "./event-count-fixture.js";
import { eventAuthoringCases } from "./event-authoring-report.js";
import {
  authoringCapture,
  authoringSha,
  type AuthoringRuntime,
} from "./event-authoring-runtime.js";
import { openEventLive } from "../admin/events.js";

export type AuthoringRow = Record<string, unknown>;
export class EventAuthoringWorld extends EventCountWorld {
  proof: AuthoringRow = {};
  provider = "";
  embedRef = "";
  before: AuthoringRow = {};
  constructor(
    readonly runtime: AuthoringRuntime,
    page: Page,
    title: string,
    ordinal: number,
  ) {
    super(runtime.api, page, title, ordinal, 4061);
  }
  async admin(
    method: string,
    path: string,
    body?: AuthoringRow,
    version?: number,
  ): Promise<AuthoringRow> {
    countOperation("native supporting Admin HTTP", { method, path });
    const result = await this.page.evaluate(
      async (input) => {
        const response = await fetch(input.path, {
          method: input.method,
          headers: {
            "content-type": "application/json",
            "x-ds-admin-csrf": decodeURIComponent(
              document.cookie
                .split("; ")
                .find((row) => row.startsWith("__Host-ds_admin_csrf="))
                ?.split("=")[1] ?? "",
            ),
            "idempotency-key": input.key,
            ...(input.version ? { "if-match": `"${input.version}"` } : {}),
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        });
        return { status: response.status, body: await response.json() };
      },
      { method, path, body, version, key: randomUUID() },
    );
    expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(
      200,
    );
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return result.body;
  }
  async createDraft() {
    await this.fillCreateForm("canonical draft");
    const msk =
      new Date(Date.now() + 35 * 86400000 + 10800000)
        .toISOString()
        .slice(0, 10) + "T19:00";
    this.pendingMsk = msk;
    await this.page.locator("#startsAtMsk").fill(msk);
    this.eventId = await this.saveNewEvent("canonical draft");
  }
  async configure(provider: string, ref: string) {
    countOperation("actual Admin provider/reference controls and save", {
      eventId: this.eventId,
      provider,
    });
    await this.page.getByTestId("provider").selectOption(provider);
    await this.page.getByTestId("embed-ref").fill(ref);
    await this.page.getByTestId("save-stream").click();
    await expect(this.page.getByTestId("stream-ok")).toBeVisible();
  }
  async persistProvider(provider: string) {
    this.provider = provider;
    this.embedRef =
      provider === "rutube"
        ? "0123456789abcdef0123456789abcdef"
        : "dQw4w9WgXcQ";
    await this.configure(provider, this.embedRef);
  }
  async verifyProvider(provider: string) {
    const detail = await this.detail(this.eventId);
    expect(detail.streamConfig).toMatchObject({
      provider,
      embedRef: this.embedRef,
    });
    const rows = (
      await this.api.query(
        "SELECT provider,embed_ref FROM stream_config WHERE event_id=$1",
        [this.eventId],
      )
    ).rows;
    expect(rows).toEqual([{ provider, embed_ref: this.embedRef }]);
    await this.page.goto(`/events/${this.eventId}`);
    await expect(this.page.getByTestId("provider")).toHaveValue(provider);
    await expect(this.page.getByTestId("embed-ref")).toHaveValue(this.embedRef);
    this.proof = {
      provider,
      embedRef: this.embedRef,
      persisted: true,
      reopened: true,
    };
    authoringCapture(`provider-${this.ordinal}.private.json`, { detail, rows });
  }
  async player(browser: Browser) {
    await this.publish(this.eventId);
    await openEventLive(this.page);
    await this.doctor("POST", this.eventId, "registration");
    countOperation("native own doctor display-name setup", {
      sub: this.doctorSub,
    });
    const profile = await fetch(`${this.api.url}/v1/me/display-name`, {
      method: "PUT",
      headers: {
        cookie: this.doctorCookie,
        "user-agent": this.ua,
        "accept-language": this.language,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Проверочный врач" }),
    });
    expect(profile.status).toBe(200);
    const detail = await this.detail(this.eventId);
    const native = await this.doctor("GET", this.eventId, "room");
    expect(native.body.stream).toMatchObject({
      provider: this.provider,
      embedRef: this.embedRef,
    });
    const frames: AuthoringRow[] = [];
    for (const [host, mount] of [
      ["academy", "webinars"],
      ["doctor", "events"],
    ]) {
      const origin = this.runtime.origins[host!]!;
      const context = await browser.newContext({
        baseURL: origin,
        locale: this.language,
        userAgent: this.ua,
      });
      try {
        const [name, value] = this.doctorCookie.split("=");
        await context.addCookies([
          {
            name: name!,
            value: value!,
            domain: new URL(origin).hostname,
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Strict",
          },
        ]);
        await context.route(
          (url) => url.origin === origin && url.pathname.startsWith("/v1/"),
          async (route) => {
            const request = route.request(),
              source = new URL(request.url());
            const target = new URL(this.api.url);
            target.hostname = new URL(origin).hostname;
            countOperation("URL-only storefront browser transport", {
              host,
              method: request.method(),
              source: source.origin + source.pathname,
              target: target.origin + source.pathname,
              querySha256: authoringSha(source.search),
              bodySha256: authoringSha(
                request.postDataBuffer() ?? Buffer.alloc(0),
              ),
              database: this.api.database,
            });
            await route.continue({
              url: target.origin + source.pathname + source.search,
            });
          },
        );
        const page = await context.newPage();
        const before = this.runtime.ssr.length;
        countOperation("real room SSR navigation", {
          host,
          origin,
          eventId: this.eventId,
          database: this.api.database,
          apiOrigin: this.api.url,
        });
        const response = await page.goto(`/${mount}/${detail.slug}/room`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status()).toBe(200);
        const player = page.getByTestId(`room-player-${this.provider}`);
        await expect(player).toBeVisible();
        const src = await player.getAttribute("src");
        const expected =
          (this.provider === "rutube"
            ? "https://rutube.ru/play/embed/"
            : "https://www.youtube.com/embed/") + this.embedRef;
        expect(src).toBe(expected);
        const request = this.runtime.ssr
          .slice(before)
          .find(
            (row) =>
              row.path === `/v1/events/${this.eventId}/room` &&
              row.status === 200,
          );
        expect(request, "actual normal SSR reaches owned API").toBeDefined();
        frames.push({
          host,
          provider: this.provider,
          src,
          nativeProvider: (native.body.stream as AuthoringRow).provider,
          nativeEmbedRef: (native.body.stream as AuthoringRow).embedRef,
          ssrStatus: request!.status,
          ssrApiOrigin: request!.apiOrigin,
          ssrDatabase: request!.database,
          eventId: this.eventId,
          assetsSha256: this.runtime.assets[host!],
          ssrReceipt: request,
        });
      } finally {
        await context.close();
      }
    }
    this.proof.frames = frames;
    this.proof.noSniffingUnitPassed = this.runtime.noSniffingUnitPassed;
  }
  async wrongPublished() {
    this.eventId = await this.createEvent("wrong stream", false);
    this.provider = "youtube";
    this.embedRef = "wrongRef123";
    await this.configure(this.provider, this.embedRef);
    await this.publish(this.eventId);
    this.before = await this.detail(this.eventId);
    this.proof = {
      wrongRef: this.embedRef,
      lifecycleBefore: await this.lifecycle(),
    };
  }
  async lifecycle() {
    return (
      await this.api.query(
        "SELECT event_type,metadata->>'from' AS from,metadata->>'to' AS to FROM audit_ledger WHERE metadata->>'aggregateId'=$1 ORDER BY created_at",
        [this.eventId],
      )
    ).rows.map((row) => ({ type: row.event_type, from: row.from, to: row.to }));
  }
  async correct() {
    this.embedRef = "correctedYt";
    await this.configure(this.provider, this.embedRef);
  }
  async verifyCorrection() {
    const detail = await this.detail(this.eventId);
    expect(detail.state).toBe("published");
    expect(detail.version).toBe(Number(this.before.version) + 1);
    expect(detail.streamConfig).toMatchObject({ embedRef: this.embedRef });
    await this.page.goto(`/events/${this.eventId}`);
    await expect(this.page.getByTestId("embed-ref")).toHaveValue(this.embedRef);
    const rows = (
      await this.api.query("SELECT * FROM stream_config WHERE event_id=$1", [
        this.eventId,
      ])
    ).rows;
    expect(rows).toHaveLength(1);
    this.proof = {
      ...this.proof,
      beforeState: this.before.state,
      afterState: detail.state,
      beforeVersion: this.before.version,
      afterVersion: detail.version,
      correctedRef: this.embedRef,
      persistedRef: (detail.streamConfig as AuthoringRow).embedRef,
      reopenedRef: await this.page.getByTestId("embed-ref").inputValue(),
      streamRows: rows.length,
      beforeRoomOpen: detail.state === "published",
      lifecycleAfter: await this.lifecycle(),
    };
    expect(this.proof.lifecycleBefore).toEqual([
      { type: "event.published", from: "draft", to: "published" },
    ]);
    expect(this.proof.lifecycleAfter).toEqual(this.proof.lifecycleBefore);
    authoringCapture("correction.private.json", {
      before: this.before,
      after: detail,
      rows,
      proof: this.proof,
    });
  }
  override async cleanup() {
    await super.cleanup(false);
    if (!this.eventId || this.backgrounds.length !== 5) return;
    const events = [];
    for (const [eventId, { ref }] of this.events) {
      const rows = (
        await this.api.query(
          "SELECT state,(SELECT count(*)::int FROM audit_ledger WHERE metadata->>'aggregateId'=events.id::text) AS audit_rows FROM events WHERE id=$1",
          [eventId],
        )
      ).rows;
      expect(rows[0]?.state).toBe("hidden");
      expect(Number(rows[0]?.audit_rows)).toBeGreaterThanOrEqual(4);
      countOperation("verify exact owned PDF absent", { eventId, ref });
      const pdfAbsent = !(await this.api.storage.exists(ref));
      expect(pdfAbsent).toBe(true);
      events.push({
        eventId,
        state: rows[0]!.state,
        pdfAbsent,
        historyRetained: true,
        auditRows: rows[0]!.audit_rows,
      });
    }
    const subjects = [];
    for (const sub of this.subjects) {
      countOperation("verify exact own IdP subject absent", { sub });
      const response = await fetch(
        `${process.env.IDP_ISSUER}/v2/users/${sub}`,
        {
          headers: { authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}` },
        },
      );
      expect([404, 410]).toContain(response.status);
      subjects.push({ sub, status: response.status });
    }
    const resource = {
      caseId: eventAuthoringCases[this.ordinal]!.id,
      title: this.title,
      head: this.api.head,
      database: this.api.database,
      eventId: this.eventId,
      backgroundId: this.backgroundId,
      adminSub: this.adminSub,
      doctorSub: this.doctorSub,
      adminRoles: this.adminRoles,
      doctorRoles: this.doctorRoles,
      apiOrigin: this.api.url,
      compiledApiSha256: this.api.provenance.compiledApi,
      shippingSourceSha256: authoringSha(
        JSON.stringify(this.api.provenance.sourceHashes),
      ),
      proof: this.proof,
      cleanup: { events, subjects, sessionsClosed: true },
    };
    appendFileSync(
      resolve(countDirectory(), "resources.jsonl"),
      JSON.stringify(resource) + "\n",
    );
  }
}
