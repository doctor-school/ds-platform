"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Combobox } from "@ds/design-system/blocks";
import { fetchRelationshipEndpointOptions } from "@/providers/data-provider";
import { useServerCombobox } from "@/lib/use-server-combobox";

/**
 * 023 EARS-26, EARS-22 (#4018) — the one server-backed picker the learning
 * structure editor chooses its taxonomy rows with: a school's direction,
 * leading expert and project, a course's 032 partner organisation. It is the
 * shared `useServerCombobox` state layer over the same bounded admin list
 * reads the relationship selectors use, rendered by the DS `Combobox`.
 */
export function LearningRelationPicker({
  id,
  resource,
  value,
  onChange,
  placeholder,
  initialLabel = null,
  invalid = false,
  describedBy,
}: {
  id: string;
  resource: "directions" | "experts" | "projects" | "organisations";
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  /** The saved choice's name, shown before a page that carries it loads. */
  initialLabel?: string | null;
  invalid?: boolean;
  /** The id of the field error that describes the control, when one shows. */
  describedBy?: string;
}) {
  const t = useTranslations();
  const fetchPage = useCallback(
    (args: { q: string; page: number; pageSize: number }) =>
      fetchRelationshipEndpointOptions({ resource, ...args }),
    [resource],
  );
  const picker = useServerCombobox({
    fetchPage,
    toOption: (row) => ({ id: row.id, label: row.title ?? row.name ?? row.id }),
    selectedId: value,
    initialSelected:
      value && initialLabel ? { id: value, label: initialLabel } : null,
  });
  return (
    <Combobox
      id={id}
      options={picker.options}
      value={value}
      onValueChange={(next) => {
        picker.select(next);
        onChange(next);
      }}
      placeholder={placeholder}
      searchLabel={placeholder}
      onSearchChange={picker.search}
      hasMore={picker.hasMore}
      onLoadMore={picker.loadMore}
      loadingMore={picker.loadingMore}
      loadMoreError={picker.loadMoreError}
      loadMoreLabel={t("learning.schools.picker.loadMore")}
      loadingMoreLabel={t("learning.schools.picker.loadingMore")}
      loadMoreErrorLabel={t("learning.schools.picker.loadMoreError")}
      emptyLabel={
        picker.isError
          ? t("learning.schools.picker.failed")
          : t("learning.schools.picker.empty")
      }
      showSearch
      invalid={invalid}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
    />
  );
}
