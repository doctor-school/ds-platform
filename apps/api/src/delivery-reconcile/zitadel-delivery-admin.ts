import type {
  DeliveryAdmin,
  ZitadelProvider,
} from "./delivery-reconcile.types.js";

/** Subset of `fetch` the admin adapter needs — narrowed so the spec injects a fake. */
export type AdminFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface ZitadelDeliveryAdminConfig {
  /** Zitadel instance base URL (the existing `IDP_ISSUER`). */
  baseUrl: string;
  /** Org-owner service-account PAT with admin scope (the existing `IDP_SERVICE_TOKEN`). */
  serviceToken: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: AdminFetchLike | undefined;
}

/** Raw provider shape the admin `_search` endpoints return (the subset we read). */
interface RawProvider {
  id?: string;
  description?: string;
  state?: string;
  /** SMS HTTP providers nest their description under `http`. */
  http?: { description?: string };
}

/**
 * Real Zitadel admin adapter for the {@link DeliveryAdmin} port (#185).
 *
 * Reuses the existing {@link ZitadelIdpClient} pattern — `baseUrl` +
 * `serviceToken` (the org-owner PAT) + an injectable `fetchImpl`. It speaks the
 * Zitadel **admin** API: `/admin/v1/smtp/_search`, `/admin/v1/sms/_search`, and
 * `…/{id}/_activate`. No SMTP/SMS secrets pass through here — it only reads the
 * provider list and flips which one is active.
 *
 * Idempotency: `_activate` on an already-active provider is rejected by Zitadel
 * with a precondition error (version-dependent wording, NOT "No changes"). The
 * activate methods tolerate that class of error as a no-op — mirroring
 * `provision.sh`'s `api_activate` — so a redundant activation never throws. Any
 * other non-2xx is a genuine failure and throws.
 */
export class ZitadelDeliveryAdmin implements DeliveryAdmin {
  private readonly fetchImpl: AdminFetchLike;

  constructor(private readonly config: ZitadelDeliveryAdminConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as AdminFetchLike);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.serviceToken}`,
      "content-type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async search(path: string): Promise<ZitadelProvider[]> {
    const res = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`zitadel ${path} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { result?: RawProvider[] };
    return (data.result ?? []).map((p) => ({
      id: p.id ?? "",
      // SMTP carries `description` at the top level; the SMS HTTP provider nests
      // it under `http`. Read both so one adapter serves both channels.
      description: p.description ?? p.http?.description ?? "",
      active: isActiveState(p.state),
    }));
  }

  listSmtpProviders(): Promise<ZitadelProvider[]> {
    return this.search("/admin/v1/smtp/_search");
  }

  listSmsProviders(): Promise<ZitadelProvider[]> {
    return this.search("/admin/v1/sms/_search");
  }

  private async activate(path: string): Promise<void> {
    const res = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (res.ok) return;
    // Tolerate the already-active precondition (idempotent no-op), mirroring
    // provision.sh's api_activate. Match loosely on the converged-state phrases;
    // anything else is a real failure and throws.
    const body = await res.text().catch(() => "");
    if (/already active|already|no changes/i.test(body)) return;
    throw new Error(`zitadel ${path} failed: HTTP ${res.status}: ${body}`);
  }

  activateSmtp(id: string): Promise<void> {
    return this.activate(`/admin/v1/smtp/${id}/_activate`);
  }

  activateSms(id: string): Promise<void> {
    return this.activate(`/admin/v1/sms/${id}/_activate`);
  }
}

/**
 * Normalise Zitadel's provider state to a boolean `active`. The state enum is
 * version/channel-dependent (`SMTP_CONFIG_ACTIVE`, `ACTIVE`, …) — treat any state
 * containing `ACTIVE` but not `INACTIVE` as active. Absent state ⇒ inactive
 * (fail-safe: we'd rather redundantly activate than wrongly assume active).
 */
function isActiveState(state: string | undefined): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  return s.includes("ACTIVE") && !s.includes("INACTIVE");
}
