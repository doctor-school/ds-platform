import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

// Single loader rooted at site root '/'. ADRs land at /adr/<slug>,
// architecture/ data/ operations/ etc. resolve from their content paths
// per ADR-0006 §10.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
