"use client";

import { useState } from "react";
import { useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button, Input } from "@ds/design-system";
import { TokenSelect } from "@/components/fields";
import { relationshipPickerState } from "@/lib/relationship-authoring-state";
import {
  relationshipEndpointQuery,
  relationshipEndpointTotalPages,
  RELATIONSHIP_ENDPOINT_PAGE_SIZE,
} from "@/lib/relationship-endpoint-query";

type EndpointKind = "event" | "project";

interface EndpointListItem {
  id: string;
  title: string;
}

interface EndpointList {
  data: EndpointListItem[];
  total: number;
  page: number;
  pageSize: number;
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
  const [page, setPage] = useState(1);
  const query = relationshipEndpointQuery({ page, search });

  const { query: endpointsQuery } = useCustom<EndpointList>({
    url: `/v1/admin/${RESOURCE[endpoint]}?${query}`,
    method: "get",
  });

  const options = (endpointsQuery.data?.data.data ?? []).filter(
    (item) => !excludedIds.includes(item.id),
  );
  const envelope = endpointsQuery.data?.data;
  const totalPages = relationshipEndpointTotalPages(
    envelope?.total ?? 0,
    envelope?.pageSize ?? RELATIONSHIP_ENDPOINT_PAGE_SIZE,
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
            setPage(1);
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
            <div className="flex flex-col gap-2">
              <span>{t("relationshipEndpointPicker.loadFailed")}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`${testIdPrefix}-retry`}
                onClick={() => void endpointsQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          </Alert>
        ) : viewState.kind === "empty" ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`${testIdPrefix}-no-options`}
          >
            {copy.noOptions}
          </p>
        ) : null}
        {!endpointsQuery.isError && totalPages > 1 ? (
          <nav
            className="flex items-center gap-3"
            aria-label={t("common.list.paginationNav")}
            data-testid={`${testIdPrefix}-pagination`}
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || endpointsQuery.isFetching}
              data-testid={`${testIdPrefix}-previous`}
              onClick={() => {
                setPage((current) => Math.max(1, current - 1));
                onChange("");
              }}
            >
              {t("common.list.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("common.list.pageReadout", { page, pages: totalPages })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= totalPages || endpointsQuery.isFetching}
              data-testid={`${testIdPrefix}-next`}
              onClick={() => {
                setPage((current) => Math.min(totalPages, current + 1));
                onChange("");
              }}
            >
              {t("common.list.next")}
            </Button>
          </nav>
        ) : null}
      </div>
    </>
  );
}
