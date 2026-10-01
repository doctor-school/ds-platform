import { DisclosureSummary } from '@ds/design-system';

export const OnHeader = () => (
  <div className="flex items-center gap-3 bg-header p-4">
    <details>
      <DisclosureSummary aria-label="Меню">
        <span aria-hidden="true">≡</span>
      </DisclosureSummary>
    </details>
  </div>
);
