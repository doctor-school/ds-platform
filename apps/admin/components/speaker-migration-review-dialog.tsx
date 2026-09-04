"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system";
import { Combobox, FormFieldGroup, FormSection } from "@ds/design-system/blocks";
import {
  EVENT_EXPERT_POSITION_MAX,
  EVENT_EXPERT_ROLE_MAX,
  ResolveSpeakerMigrationReviewRequestSchema,
  type ResolveSpeakerMigrationReviewRequest,
  type SpeakerMigrationReviewItem,
} from "@ds/schemas";
import { useRelationshipCombobox } from "@/lib/use-relationship-combobox";
import { resolveSpeakerMigrationReview } from "@/providers/data-provider";
import {
  SpeakerMigrationErrorNote,
  readHttpError,
  type MigrationErrorState,
} from "@/components/speaker-migration-error-note";

type ResolutionKind = ResolveSpeakerMigrationReviewRequest["disposition"];

/**
 * 012 EARS-24 — the explicit resolution of ONE retained source row.
 *
 * The three resolutions are peers behind a `Tabs` selector, never a default with
 * two escape hatches: an operator has to say which one this row is. Two rules
 * about names are structural, not cosmetic:
 *
 *  - the Expert selector is the same closed, SERVER-PAGINATED `Combobox` every
 *    other admin relationship uses (`useRelationshipCombobox`), so the operator
 *    searches the Expert register by hand and picks from it — the source row's
 *    own name is never a query, a filter or a ranking input;
 *  - the «create Expert» fields start EMPTY. Prefilling them from `sourceName`
 *    would make the free-text legacy string the seed of the structured record and
 *    quietly re-introduce the name-derived identity 012 exists to remove.
 */
export function SpeakerMigrationReviewDialog({
  review,
  open,
  onOpenChange,
  onResolved,
}: {
  review: SpeakerMigrationReviewItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const t = useTranslations("speakerMigration");
  const [kind, setKind] = useState<ResolutionKind>("existing_expert");
  const [expertId, setExpertId] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [patronymic, setPatronymic] = useState("");
  const [professionalRole, setProfessionalRole] = useState("");
  const [role, setRole] = useState("");
  const [position, setPosition] = useState("0");
  const [error, setError] = useState<MigrationErrorState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const experts = useRelationshipCombobox({
    resource: "experts",
    excludedIds: [],
    value: expertId,
  });

  useEffect(() => {
    if (!open) return;
    setKind("existing_expert");
    setExpertId("");
    setFamilyName("");
    setGivenName("");
    setPatronymic("");
    setProfessionalRole("");
    setRole("");
    // The source position is provenance, not a proposal for the new relation:
    // the operator types the position the structured event should carry.
    setPosition("0");
    setError(null);
  }, [open, review?.sourceId]);

  function resolutionError(caught: unknown): MigrationErrorState {
    const { errorCode } = readHttpError(caught);
    switch (errorCode) {
      case "SPEAKER_MIGRATION_SOURCE_IMMUTABLE":
        return {
          code: errorCode,
          text: t("resolution.errors.SPEAKER_MIGRATION_SOURCE_IMMUTABLE"),
        };
      case "RELATIONSHIP_CONFLICT":
        return {
          code: errorCode,
          text: t("resolution.errors.RELATIONSHIP_CONFLICT"),
        };
      case "VALIDATION_FAILED":
        return { code: errorCode, text: t("resolution.errors.VALIDATION_FAILED") };
      default:
        return {
          code: errorCode ?? null,
          text: t("resolution.errors.default"),
        };
    }
  }

  async function submit() {
    if (!review) return;
    const relation = { role: role.trim(), position: Number(position) };
    const payload =
      kind === "existing_expert"
        ? { disposition: kind, expertId, ...relation }
        : kind === "created_expert"
          ? {
              disposition: kind,
              expert: {
                familyName: familyName.trim(),
                givenName: givenName.trim(),
                ...(patronymic.trim() ? { patronymic: patronymic.trim() } : {}),
                ...(professionalRole.trim()
                  ? { professionalRole: professionalRole.trim() }
                  : {}),
              },
              ...relation,
            }
          : { disposition: kind };
    const parsed = ResolveSpeakerMigrationReviewRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setError({ code: null, text: t("resolution.errors.validation") });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resolveSpeakerMigrationReview(review.sourceId, parsed.data);
      onOpenChange(false);
      onResolved();
    } catch (caught) {
      setError(resolutionError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="resolution-dialog">
        <DialogHeader>
          <DialogTitle>{t("resolution.title")}</DialogTitle>
          <DialogDescription>
            {review
              ? t("resolution.description", { name: review.sourceName })
              : t("resolution.descriptionEmpty")}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setKind(value as ResolutionKind);
            setError(null);
          }}
        >
          <TabsList aria-label={t("resolution.kindLabel")}>
            <TabsTrigger
              value="existing_expert"
              data-testid="resolution-existing-expert"
            >
              {t("resolution.kinds.existing")}
            </TabsTrigger>
            <TabsTrigger
              value="created_expert"
              data-testid="resolution-created-expert"
            >
              {t("resolution.kinds.create")}
            </TabsTrigger>
            <TabsTrigger
              value="content_removed"
              data-testid="resolution-content-removed"
            >
              {t("resolution.kinds.removed")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="existing_expert">
            <FormSection legend={t("resolution.sections.expert")}>
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm text-foreground"
                  htmlFor="resolution-expert-combobox"
                >
                  {t("resolution.expert")}
                </label>
                <Combobox
                  id="resolution-expert-combobox"
                  options={experts.options}
                  value={expertId || null}
                  onValueChange={(next) => {
                    experts.select(next);
                    setExpertId(next);
                  }}
                  onSearchChange={experts.search}
                  onLoadMore={experts.loadMore}
                  hasMore={experts.hasMore}
                  loadingMore={experts.loadingMore}
                  loadMoreError={experts.loadMoreError}
                  loadMoreLabel={t("loading")}
                  loadingMoreLabel={t("loading")}
                  loadMoreErrorLabel={t("retry")}
                  placeholder={
                    experts.isLoading
                      ? t("loading")
                      : t("resolution.expertPlaceholder")
                  }
                  searchLabel={t("resolution.expertSearch")}
                  searchPlaceholder={t("resolution.expertSearch")}
                  emptyLabel={
                    experts.isLoading
                      ? t("loading")
                      : t("resolution.expertEmpty")
                  }
                  showSearch
                  aria-label={t("resolution.expert")}
                />
              </div>
            </FormSection>
          </TabsContent>
          <TabsContent value="created_expert">
            <FormSection legend={t("resolution.sections.newExpert")}>
              <FormFieldGroup columns="two">
                <MigrationField
                  id="resolution-family-name"
                  label={t("resolution.familyName")}
                  value={familyName}
                  onChange={setFamilyName}
                />
                <MigrationField
                  id="resolution-given-name"
                  label={t("resolution.givenName")}
                  value={givenName}
                  onChange={setGivenName}
                />
              </FormFieldGroup>
              <MigrationField
                id="resolution-patronymic"
                label={t("resolution.patronymic")}
                value={patronymic}
                onChange={setPatronymic}
              />
              <MigrationField
                id="resolution-professional-role"
                label={t("resolution.professionalRole")}
                value={professionalRole}
                onChange={setProfessionalRole}
              />
            </FormSection>
          </TabsContent>
          <TabsContent value="content_removed">
            <p className="text-sm text-muted-foreground">
              {t("resolution.removedNote")}
            </p>
          </TabsContent>
        </Tabs>
        {kind !== "content_removed" ? (
          <FormSection legend={t("resolution.sections.event")}>
            <FormFieldGroup columns="two">
              <MigrationField
                id="resolution-role"
                label={t("resolution.role")}
                value={role}
                onChange={setRole}
                maxLength={EVENT_EXPERT_ROLE_MAX}
              />
              <MigrationField
                id="resolution-position"
                label={t("resolution.position")}
                value={position}
                onChange={setPosition}
                type="number"
                min={0}
                max={EVENT_EXPERT_POSITION_MAX}
              />
            </FormFieldGroup>
          </FormSection>
        ) : null}
        {error ? (
          <SpeakerMigrationErrorNote testId="resolution-error" state={error} />
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            data-testid="resolution-submit"
            loading={submitting}
            onClick={() => void submit()}
          >
            {t("resolution.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MigrationField({
  id,
  label,
  value,
  onChange,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </div>
  );
}
