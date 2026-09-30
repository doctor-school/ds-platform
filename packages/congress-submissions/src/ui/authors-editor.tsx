"use client";

import * as React from "react";

import {
  CONGRESS_SUBMISSION_LIMITS,
  type CongressSubmissionDraftAuthor,
} from "@ds/schemas";
import { Button } from "@ds/design-system/button";
import { Input } from "@ds/design-system/input";
import { Link } from "@ds/design-system/link";
import { Radio } from "@ds/design-system/radio";
import { cn } from "@ds/design-system/lib/utils";

import { COPY } from "../copy";

/**
 * The authors editor of the oral form (046 EARS-8; canvas block `isAuthors`):
 * numbered rows with the name and workplace, the one «Докладчик» choice, and —
 * while editing — «Изменить/Готово», reorder ↑ ↓ and remove ✕, with the four
 * name inputs unfolding under a row. The first author is the account holder
 * the API pre-filled from the congress registration.
 */

export interface AuthorRow extends CongressSubmissionDraftAuthor {
  /** Client-only identity so a reorder keeps each row's open/closed state. */
  uid: string;
}

let seq = 0;
export const newUid = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export const withUids = (authors: CongressSubmissionDraftAuthor[]): AuthorRow[] =>
  authors.map((a) => ({ ...a, uid: newUid() }));

export const withoutUids = (rows: AuthorRow[]): CongressSubmissionDraftAuthor[] =>
  rows.map(({ uid: _uid, ...a }) => a);

const blank = (v: string | undefined) => !(v ?? "").trim();

export function authorIncomplete(a: CongressSubmissionDraftAuthor): boolean {
  return blank(a.surname) || blank(a.firstName) || blank(a.workplace);
}

export interface AuthorsEditorProps {
  authors: AuthorRow[];
  editable: boolean;
  /** The send was tried — incomplete rows unfold and missing inputs go red. */
  tried: boolean;
  error: string | null;
  onChange: (next: AuthorRow[]) => void;
  onBlur: () => void;
}

export function AuthorsEditor({
  authors,
  editable,
  tried,
  error,
  onChange,
  onBlur,
}: AuthorsEditorProps) {
  const [openRows, setOpenRows] = React.useState<Record<string, boolean>>({});

  const move = (from: number, to: number) => {
    const next = authors.slice();
    const t = next[from]!;
    next[from] = next[to]!;
    next[to] = t;
    onChange(next);
  };
  const set = (i: number, key: keyof CongressSubmissionDraftAuthor, v: string) =>
    onChange(authors.map((a, j) => (j === i ? { ...a, [key]: v } : a)));
  const add = () => {
    const uid = newUid();
    setOpenRows((o) => ({ ...o, [uid]: true }));
    onChange([
      ...authors,
      { uid, surname: "", firstName: "", patronymic: "", workplace: "", presenting: false },
    ]);
  };

  return (
    <div>
      <div className="border-t border-hairline">
        {authors.map((a, i) => {
          const incomplete = authorIncomplete(a);
          const open =
            editable && (openRows[a.uid] ?? (tried && incomplete));
          const full =
            [a.surname, a.firstName, a.patronymic]
              .map((p) => (p ?? "").trim())
              .filter(Boolean)
              .join(" ") || COPY.newAuthor;
          const inputs: {
            key: keyof CongressSubmissionDraftAuthor;
            short: string;
            label: string;
            max: number;
            wide?: boolean;
          }[] = [
            { key: "surname", short: "sn", label: COPY.surname, max: CONGRESS_SUBMISSION_LIMITS.name },
            { key: "firstName", short: "nm", label: COPY.firstName, max: CONGRESS_SUBMISSION_LIMITS.name },
            { key: "patronymic", short: "pt", label: COPY.patronymic, max: CONGRESS_SUBMISSION_LIMITS.name },
            {
              key: "workplace",
              short: "org",
              label: COPY.workplace,
              max: CONGRESS_SUBMISSION_LIMITS.workplace,
              wide: true,
            },
          ];
          return (
            <div
              key={a.uid}
              data-testid="congress-author"
              className="border-b border-hairline py-3"
            >
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="w-4.5 flex-none text-caption font-bold tabular-nums text-faint">
                  {i + 1}
                </span>
                <div className="min-w-44 flex-1">
                  <div
                    className={cn(
                      "text-sm font-bold",
                      blank(a.surname) ? "text-faint" : "text-foreground",
                    )}
                  >
                    {full}
                  </div>
                  <div className="mt-0.5 text-caption text-muted-foreground">
                    {(a.workplace ?? "").trim() || COPY.noWorkplace}
                  </div>
                </div>
                {editable || a.presenting ? (
                  <Radio
                    name="congress-speaker"
                    checked={!!a.presenting}
                    disabled={!editable}
                    onChange={() =>
                      onChange(authors.map((y, j) => ({ ...y, presenting: j === i })))
                    }
                  >
                    {COPY.speaker}
                  </Radio>
                ) : null}
                {editable ? (
                  <span className="flex items-center gap-0.5">
                    <Link asChild tone="muted" size="sm" className="mr-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRows((o) => ({ ...o, [a.uid]: !open }))
                        }
                      >
                        {open ? COPY.done : COPY.edit}
                      </button>
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={COPY.upTitle}
                      aria-label={COPY.up}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={COPY.downTitle}
                      aria-label={COPY.down}
                      disabled={i === authors.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={COPY.removeAuthor}
                      aria-label={COPY.removeAuthor}
                      disabled={authors.length === 1}
                      onClick={() => onChange(authors.filter((_, j) => j !== i))}
                    >
                      ✕
                    </Button>
                  </span>
                ) : null}
              </div>
              {open ? (
                <div className="mb-1 ml-8 mt-3.5 grid grid-cols-1 gap-2.5 layout:grid-cols-3">
                  {inputs.map((f) => {
                    const id = `in-a${i}-${f.short}`;
                    const missing = tried && f.key !== "patronymic" && blank(a[f.key] as string);
                    return (
                      <label
                        key={f.key}
                        htmlFor={id}
                        className={cn("block min-w-0", f.wide && "layout:col-span-3")}
                      >
                        <span className="mb-1.5 block text-caption font-semibold text-foreground">
                          {f.label}
                        </span>
                        <Input
                          id={id}
                          value={(a[f.key] as string | undefined) ?? ""}
                          maxLength={f.max}
                          aria-invalid={missing || undefined}
                          onChange={(e) => set(i, f.key, e.target.value)}
                          onBlur={onBlur}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {editable && authors.length < CONGRESS_SUBMISSION_LIMITS.authorsMax ? (
        <Link asChild className="mt-3">
          <button type="button" onClick={add}>
            {COPY.addAuthor}
          </button>
        </Link>
      ) : null}
      {error ? (
        <p className="mt-2 text-caption font-semibold text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}
