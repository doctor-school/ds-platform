"use client";

import { useState } from "react";
import { useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Input } from "@ds/design-system";
import { TokenSelect } from "@/components/fields";
import { relationshipPickerState } from "@/lib/relationship-authoring-state";

type EndpointKind = "event" | "project";

interface EndpointListItem {
  id: string;
  title: string;
}

interface EndpointList {
  data: EndpointListItem[];
}

interface PickerCopy {
  search: string;
  searchPlaceholder: string;
  select: string;
  selectPlaceholder: string;
  noOptions: string;
}

const RESOURCE: Record<EndpointKind, string> = {
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
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (search.trim().length > 0) query.set("q", search.trim());

  const { query: endpointsQuery } = useCustom<EndpointList>({
    url: `/v1/admin/${RESOURCE[endpoint]}?${query.toString()}`,
    method: "get",
  });

  // Events currently return the complete admin list and ignore `q`; the local
  // predicate keeps the shared picker immediate without inventing another API.
  // Project search is already server-narrowed and the same predicate is a no-op.
  const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");
  const options = (endpointsQuery.data?.data.data ?? []).filter(
    (item) =>
      !excludedIds.includes(item.id) &&
      (normalizedSearch.length === 0 ||
        item.title.toLocaleLowerCase("ru-RU").includes(normalizedSearch)),
  );
  const viewState = relationshipPickerState({
    isLoading: endpointsQuery.isLoading || endpointsQuery.isFetching,
    isError: endpointsQuery.isError,
    optionCount: options.length,
  });

  return (
    <>
      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor={`${testIdPrefix}-search`}
        >
          {copy.search}
        </label>
        <Input
          id={`${testIdPrefix}-search`}
          data-testid={`${testIdPrefix}-search`}
          value={search}
          placeholder={copy.searchPlaceholder}
          onChange={(event) => {
            setSearch(event.target.value);
            onChange("");
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-sm text-foreground"
          htmlFor={`${testIdPrefix}-select`}
        >
          {copy.select}
        </label>
        <TokenSelect
          id={`${testIdPrefix}-select`}
          data-testid={`${testIdPrefix}-select`}
          value={value}
          disabled={viewState.selectDisabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{copy.selectPlaceholder}</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </TokenSelect>
        {viewState.kind === "loading" ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`${testIdPrefix}-loading`}
          >
            {t("common.loading")}
          </p>
        ) : viewState.kind === "error" ? (
          <Alert variant="danger" data-testid={`${testIdPrefix}-error`}>
            {t("relationshipEndpointPicker.loadFailed")}
          </Alert>
        ) : viewState.kind === "empty" ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`${testIdPrefix}-no-options`}
          >
            {copy.noOptions}
          </p>
        ) : null}
      </div>
    </>
  );
}
