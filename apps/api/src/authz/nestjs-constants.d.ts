// @nestjs/common@11 ships `constants.d.ts` but has no `exports` map, so under
// `moduleResolution: NodeNext` TypeScript cannot resolve types for the
// `@nestjs/common/constants` subpath. We import the explicit `.js` subpath
// (`@nestjs/common/constants.js`) because built ESM on Node REQUIRES the
// extension: under NodeNext + `"type": "module"`, Node cannot resolve the
// extensionless subpath and throws ERR_MODULE_NOT_FOUND (only Vitest/tsx/webpack
// tolerate the extensionless form). These constants are NOT re-exported from the
// `@nestjs/common` barrel, so the `.js` subpath is the canonical runtime form.
// This ambient declaration types the three reflection keys the discovery scan
// reads (authz.discovery.ts) WITHOUT hardcoding their values — the real
// constants are still imported at runtime, so they cannot drift from Nest's own
// definitions.
declare module "@nestjs/common/constants.js" {
  export const PATH_METADATA: string;
  export const METHOD_METADATA: string;
  export const VERSION_METADATA: string;
}
