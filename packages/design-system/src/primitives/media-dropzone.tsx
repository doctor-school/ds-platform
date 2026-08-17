import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

/**
 * Media dropzone — drag-and-drop OR click-to-choose for ONE optional image,
 * with a preview and an explicit remove control.
 *
 * Provenance (Stage A #1282, registry search): the interaction pattern is
 * adopted from **Kibo UI Dropzone** (MIT, shadcn registry), re-skinned to DS
 * tokens and reduced to the single-file case the 012 authoring forms need
 * (project cover, then expert photo #1284 and partner logo #1286 unchanged).
 * Nothing here is bespoke invention: the drag-state affordance, the hidden file
 * input behind a visible activator and the preview-with-remove layout are that
 * pattern.
 *
 * The checks it performs are PREFLIGHT ONLY — a friendly early refusal for an
 * obviously wrong type or an over-size file. The API's normalizer is the
 * authority (012-design §2.2), and it re-validates everything: an operator who
 * bypasses the browser control cannot get a bad image stored. That is why this
 * component never reports "valid", only "obviously not worth uploading".
 *
 * Keyboard: the styled zone is a real `<button type="button">` that opens the
 * visually-hidden file input, so Tab reaches a focusable control, Space/Enter
 * activates it, and the focus ring lives on the element the operator sees. The
 * hidden input keeps the caller's `id`, so a `<Label htmlFor={id}>` still opens
 * the picker natively.
 */
export interface MediaDropzoneProps {
  /** Field id — also the label's `htmlFor` target. */
  id: string;
  /** Accepted MIME types, e.g. `["image/jpeg", "image/png", "image/webp"]`. */
  accept: readonly string[];
  /** Preflight byte ceiling. */
  maxBytes: number;
  /** The currently STORED media URL (server-issued), when the row already has one. */
  currentUrl?: string | null;
  /** The file the operator just picked, if any. */
  file?: File | null;
  /** Picked a file (or cleared the picked one). */
  onFileChange: (file: File | null) => void;
  /** The operator asked to remove the stored media (`mediaAction: "clear"`). */
  onRemoveCurrent?: () => void;
  /** True once removal has been requested — the preview shows the pending empty state. */
  removed?: boolean;
  /** Preflight refusal, rendered by the caller's form error element. */
  onPreflightError?: (kind: "type" | "size") => void;
  /** All copy comes from the consumer's typed catalogue; the DS ships no strings. */
  labels: {
    /** Idle prompt, e.g. «Перетащите изображение или выберите файл». */
    prompt: string;
    /** Hint line listing accepted types and limits. */
    hint: string;
    /** Remove-control label, e.g. «убрать». */
    remove: string;
    /** Accessible name of the preview image. */
    previewAlt: string;
  };
  disabled?: boolean;
  className?: string;
}

const MediaDropzone = React.forwardRef<HTMLInputElement, MediaDropzoneProps>(
  (
    {
      id,
      accept,
      maxBytes,
      currentUrl,
      file,
      onFileChange,
      onRemoveCurrent,
      removed,
      onPreflightError,
      labels,
      disabled,
      className,
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [dragging, setDragging] = React.useState(false);
    const [pickedUrl, setPickedUrl] = React.useState<string | null>(null);

    // A picked File is previewed through an object URL, revoked on replace and on
    // unmount — an un-revoked blob URL keeps the whole image in memory for the
    // life of the tab.
    React.useEffect(() => {
      if (!file) {
        setPickedUrl(null);
        return;
      }
      const url = URL.createObjectURL(file);
      setPickedUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [file]);

    const previewUrl = pickedUrl ?? (removed ? null : (currentUrl ?? null));

    /** Which preflight rule the candidate breaks, or `null` when it passes. */
    function refusalOf(candidate: File): "type" | "size" | null {
      if (!accept.includes(candidate.type)) return "type";
      if (candidate.size > maxBytes) return "size";
      return null;
    }

    function take(candidate: File | undefined): void {
      if (!candidate) return;
      const refusal = refusalOf(candidate);
      if (!refusal) {
        onFileChange(candidate);
        return;
      }
      // Clear the previous pick FIRST, then report — the consumer's
      // `onFileChange` handler legitimately resets its own error state, so
      // reporting first would have the clear wipe the message it just set
      // (caught by the live browser run of `e2e/taxonomy-projects.spec.ts`).
      onFileChange(null);
      onPreflightError?.(refusal);
    }

    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <button
          type="button"
          aria-label={labels.prompt}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          data-dragging={dragging ? "true" : undefined}
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDragging(false);
            take(event.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-1.5 border-2 border-dashed border-hairline bg-background px-6 py-8 text-center transition-colors",
            "hover:border-ring hover:bg-muted",
            "active:border-primary-action active:bg-muted",
            "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
            "data-[dragging=true]:border-primary-action data-[dragging=true]:bg-muted",
            "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-hairline disabled:hover:bg-muted",
          )}
        >
          <span className="text-sm font-semibold text-foreground">
            {labels.prompt}
          </span>
          <span className="text-xs text-muted-foreground">{labels.hint}</span>
        </button>
        {/* The input is visually hidden but still a form control, so it carries
            its own accessible name — a consumer's <Label htmlFor={id}> is the
            visible label, and this keeps the control named even without one
            (axe `label`, critical). */}
        <input
          ref={mergeRefs(ref, inputRef)}
          id={id}
          aria-label={labels.prompt}
          type="file"
          accept={accept.join(",")}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => take(event.target.files?.[0])}
        />

        {previewUrl ? (
          <div className="flex items-center gap-4">
            {/* A plain <img>: the preview source is either a blob: URL or a
                server-issued signed URL, neither of which a build-time image
                optimizer can process. (The design system is framework-agnostic —
                it must not reach for a Next-specific <Image>.) */}
            <img
              src={previewUrl}
              alt={labels.previewAlt}
              className="size-20 border-2 border-hairline object-cover"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                if (pickedUrl) {
                  onFileChange(null);
                  return;
                }
                onRemoveCurrent?.();
              }}
            >
              {labels.remove}
            </Button>
          </div>
        ) : null}
      </div>
    );
  },
);
MediaDropzone.displayName = "MediaDropzone";

export { MediaDropzone };

/** Fan one DOM node out to a forwarded ref and a local one. */
function mergeRefs(
  forwarded: React.ForwardedRef<HTMLInputElement>,
  local: React.MutableRefObject<HTMLInputElement | null>,
): React.RefCallback<HTMLInputElement> {
  return (node) => {
    local.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  };
}
