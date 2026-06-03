import type { INestApplicationContext, Type } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import {
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import {
  assembleEndpoint,
  validateRow,
  type MatrixRow,
} from "./authz.matrix.js";
import { AUTHZ_KEY, type AuthzMeta } from "./authz.types.js";

export interface AuthzScanResult {
  rows: MatrixRow[];
  violations: string[];
}

function firstString(value: unknown, fallback = ""): string {
  if (Array.isArray(value)) return firstString(value[0], fallback);
  return typeof value === "string" ? value : fallback;
}

/**
 * Layer-2 completeness gate (spec §6.1). Enumerate **every route the Nest router
 * actually registers** — via Nest's own `DiscoveryService` + `MetadataScanner`,
 * not a static AST parse and not the OpenAPI document (§2.1) — read each
 * handler's route + `AUTHZ_KEY` metadata, and validate it (§3.1 / §6.2).
 *
 * Returns the projected rows (for the matrix generator) and the list of
 * violations (non-empty ⇒ the gate fails). The caller passes the real
 * application context, so internal/excluded-from-OpenAPI routes are included.
 */
export function collectAuthzRows(
  app: INestApplicationContext,
): AuthzScanResult {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();

  const rows: MatrixRow[] = [];
  const violations: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as Type | undefined;
    if (!metatype || !wrapper.instance) continue;

    const prototype = Object.getPrototypeOf(wrapper.instance) as object;
    const controllerPath = firstString(
      Reflect.getMetadata(PATH_METADATA, metatype),
    );
    const version = firstString(
      Reflect.getMetadata(VERSION_METADATA, metatype),
      "1",
    );

    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[name] as
        | (object & { name?: string })
        | undefined;
      if (typeof handler !== "function") continue;

      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        | number
        | undefined;
      // Only route handlers carry METHOD_METADATA; helpers are skipped.
      if (httpMethod === undefined) continue;

      const handlerPath = firstString(
        Reflect.getMetadata(PATH_METADATA, handler),
      );
      const endpoint = assembleEndpoint(
        RequestMethod[httpMethod] ?? "ALL",
        version,
        controllerPath,
        handlerPath,
      );

      const meta = reflector.getAllAndOverride<AuthzMeta | undefined>(
        AUTHZ_KEY,
        [handler, metatype],
      );

      violations.push(...validateRow(endpoint, meta));
      if (meta) rows.push({ endpoint, meta });
    }
  }

  return { rows, violations };
}
