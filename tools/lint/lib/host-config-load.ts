/**
 * Child-process loader for `tools/lint/host-config-parity-lint.ts` (#2443).
 *
 * The guard needs the REAL host-config constants of each storefront, and each
 * app resolves its own `@/*` alias from its own `tsconfig.json` — two aliases
 * one process cannot hold at once. So the guard spawns this file once per app
 * under `tsx --tsconfig <app>/tsconfig.json`, and it imports that app's host
 * modules and prints their values as JSON on stdout.
 *
 * argv[2] is a JSON array of `{ module, export, catalog? }` (module paths are
 * absolute). An export that is a function is a host config built from the
 * host's message catalog (the Academy shell): it is called with a translator
 * over `catalog.file`'s `catalog.namespace`, the catalog the app itself reads.
 *
 * `undefined` is kept as `{ "$undefined": true }` so a key the host SETS to an
 * undefined value (an unset `process.env` site key) is still a key the guard
 * classifies — plain JSON would drop it.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

interface LoadRequest {
  module: string;
  export: string;
  catalog?: { file: string; namespace: string };
}

function encode(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encode(v)]),
    );
  }
  if (typeof value === "function")
    return { $function: value.name || "anonymous" };
  return value;
}

async function main(): Promise<void> {
  const requests = JSON.parse(process.argv[2] ?? "[]") as LoadRequest[];
  const out: unknown[] = [];
  for (const req of requests) {
    const mod = (await import(pathToFileURL(req.module).href)) as Record<
      string,
      unknown
    >;
    if (!(req.export in mod)) {
      throw new Error(`${req.module} does not export ${req.export}`);
    }
    let value = mod[req.export];
    if (typeof value === "function") {
      if (!req.catalog) {
        throw new Error(
          `${req.module}:${req.export} is a function but no message catalog is named for it`,
        );
      }
      const catalog = JSON.parse(
        readFileSync(req.catalog.file, "utf8"),
      ) as Record<string, Record<string, string>>;
      const ns = catalog[req.catalog.namespace] ?? {};
      value = (value as (t: (key: string) => string) => unknown)((key) => {
        if (!(key in ns)) {
          throw new Error(
            `catalog ${req.catalog?.file} has no ${req.catalog?.namespace}.${key}`,
          );
        }
        return ns[key]!;
      });
    }
    out.push(encode(value));
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(2);
});
