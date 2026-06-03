// @nestjs/common ships `constants.d.ts` but has no `exports` map, so under
// `moduleResolution: NodeNext` TypeScript cannot resolve types for the
// `@nestjs/common/constants` subpath (the runtime import resolves fine). This
// ambient declaration types the three reflection keys the discovery scan reads
// (authz.discovery.ts) WITHOUT hardcoding their values — the real constants are
// still imported at runtime, so they cannot drift from Nest's own definitions.
declare module "@nestjs/common/constants" {
  export const PATH_METADATA: string;
  export const METHOD_METADATA: string;
  export const VERSION_METADATA: string;
}
