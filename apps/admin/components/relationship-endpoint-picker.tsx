"use client";

import { useTranslations } from "next-intl";
import { Combobox } from "@ds/design-system/blocks";
import { useRelationshipCombobox } from "@/lib/use-relationship-combobox";

type EndpointKind = "event" | "project";

interface PickerCopy {
  search: string;
  searchPlaceholder: string;
  select: string;
  selectPlaceholder: string;
  noOptions: string;
}

const RESOURCE: Record<EndpointKind, "events" | "projects"> = {
  event: "events",
  project: "projects",
};

/**
 * The shared endpoint picker used when a relationship is authored from its
 * reverse detail page. It is the same approved search + select composition the
 * existing relation panels use; only the queried endpoint and host copy vary.
 */
export function RelationshipEndpointPicker({
  endpoint,
  excludedIds,
  value,
  onChange,
  testIdPrefix,
  copy,
}: {
  endpoint: EndpointKind;
  excludedIds: string[];
  value: string;
  onChange: (next: string) => void;
  testIdPrefix: string;
  copy: PickerCopy;
}) {
  const t = useTranslations();
  const picker = useRelationshipCombobox({
    resource: RESOURCE[endpoint],
    excludedIds,
    value,
  });

  return (
    <div className="flex flex-col gap-2" data-testid={`${testIdPrefix}-picker`}>
      <label
        className="text-sm text-foreground"
        htmlFor={`${testIdPrefix}-combobox`}
      >
        {copy.select}
      </label>
      <Combobox
        id={`${testIdPrefix}-combobox`}
        options={picker.options}
        value={value || null}
        onValueChange={(next) => {
          picker.select(next);
          onChange(next);
        }}
        onSearchChange={picker.search}
        onLoadMore={picker.loadMore}
        hasMore={picker.hasMore}
        loadingMore={picker.loadingMore}
        loadMoreError={picker.loadMoreError}
        loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
        loadingMoreLabel={t("relationshipEndpointPicker.loadingMore")}
        loadMoreErrorLabel={t("relationshipEndpointPicker.retryLoadMore")}
        placeholder={
          picker.isLoading ? t("common.loading") : copy.selectPlaceholder
        }
        searchLabel={copy.search}
        searchPlaceholder={copy.searchPlaceholder}
        emptyLabel={
          picker.isLoading
            ? t("common.loading")
            : picker.isError
              ? t("relationshipEndpointPicker.loadFailed")
              : copy.noOptions
        }
        showSearch
        aria-label={copy.select}
      />
    </div>
  );
}
