import path from 'node:path';
import { makeRouteHandler } from '@keystatic/next/route-handler';
import config from '../../../../keystatic.config';

// Content lives in the sibling `apps/docs` package (Fumadocs reads the
// same tree). Keystatic local mode refuses any path with `..` segments
// and only walks files under `baseDirectory`, so we re-root Keystatic
// at `apps/docs` and reference paths relative to that.
export const { POST, GET } = makeRouteHandler({
  config,
  localBaseDirectory: path.resolve(process.cwd(), '../docs'),
});
