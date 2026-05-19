import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/app/layout.config';

export default function Layout({ children }: { children: ReactNode }) {
  // `source.pageTree` is typed against fumadocs-core's PageTree.Root but
  // ships as a plain object literal — recast to satisfy fumadocs-ui's
  // stricter typing on Next 15. Runtime shape is identical.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = source.pageTree as any;

  return (
    <DocsLayout tree={tree} {...baseOptions}>
      {children}
    </DocsLayout>
  );
}
