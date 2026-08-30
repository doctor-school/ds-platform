"use client";

import { useEffect, useMemo, useState } from "react";
import { useList } from "@refinedev/core";
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
  type ExpertAdminListItem,
  type ResolveSpeakerMigrationReviewRequest,
  type SpeakerMigrationReviewItem,
} from "@ds/schemas";
import { resolveSpeakerMigrationReview } from "@/providers/data-provider";

type ResolutionKind = ResolveSpeakerMigrationReviewRequest["disposition"];

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
  const [expertId, setExpertId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [patronymic, setPatronymic] = useState("");
  const [professionalRole, setProfessionalRole] = useState("");
  const [role, setRole] = useState("");
  const [position, setPosition] = useState(String(review?.sourcePosition ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { result: experts, query: expertsQuery } = useList<ExpertAdminListItem>({
    resource: "experts",
    pagination: { currentPage: 1, pageSize: 100 },
  });

  useEffect(() => {
    if (!open) return;
    setKind("existing_expert");
    setExpertId(null);
    setFamilyName("");
    setGivenName("");
    setPatronymic("");
    setProfessionalRole("");
    setRole("");
    setPosition(String(review?.sourcePosition ?? 0));
    setError(null);
  }, [open, review?.sourcePosition]);

  const expertOptions = useMemo(
    () =>
      (experts.data ?? [])
        .filter((expert) => expert.name)
        .map((expert) => ({
          value: expert.id,
          label: expert.name!,
          description: expert.professionalRole ?? undefined,
        })),
    [experts.data],
  );

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
      setError(t("errors.validation"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resolveSpeakerMigrationReview(review.sourceId, parsed.data);
      onOpenChange(false);
      onResolved();
    } catch (caught) {
      const errorCode =
        typeof caught === "object" &&
        caught !== null &&
        "errorCode" in caught &&
        typeof caught.errorCode === "string"
          ? caught.errorCode
          : null;
      setError(
        errorCode === "SPEAKER_POSITION_OCCUPIED" ||
          errorCode === "RELATIONSHIP_CONFLICT"
          ? t("errors.conflict")
          : t("errors.resolveFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
                <Label htmlFor="resolution-expert">{t("resolution.expert")}</Label>
                <div data-testid="resolution-expert">
                  <Combobox
                    id="resolution-expert"
                    options={expertOptions}
                    value={expertId}
                    onValueChange={setExpertId}
                    placeholder={
                      expertsQuery.isLoading
                        ? t("loading")
                        : t("resolution.expertPlaceholder")
                    }
                    searchLabel={t("resolution.expertSearch")}
                    searchPlaceholder={t("resolution.expertSearch")}
                    emptyLabel={
                      expertsQuery.isError
                        ? t("errors.expertsLoadFailed")
                        : t("resolution.expertEmpty")
                    }
                    showSearch
                    disabled={expertsQuery.isLoading || expertsQuery.isError}
                    aria-label={t("resolution.expert")}
                  />
                </div>
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
          <FormSection legend={t("resolution.sections.event") }>
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
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
