"use client";

import { type ReactNode, useEffect, useReducer, useState } from "react";

import { useBotProtectedAction } from "@ds/design-system/blocks";

import {
  ApplicationsError,
  readOwnAuthorApplications,
  submitAuthorApplication,
} from "../client";
import { applicationsCopy as copy } from "../copy";
import {
  type AuthorFormErrors,
  type AuthorFormField,
  type AuthorFormValues,
  emptyAuthorForm,
  fieldErrorsFromRefusal,
  validateAuthorForm,
} from "../model/form";
import {
  classifyFailure,
  showRepeatBanner,
  startSubmission,
  type SubmissionEvent,
  type SubmissionState,
  submissionReducer,
} from "../model/submission";
import { AuthorForm, type AuthorSpecialty } from "./author-form";
import { SentState } from "./sent-state";

/** The signed-in account the application is sent under (EARS-4). */
export interface ApplyViewer {
  displayName: string | null;
  email: string;
}

/** What the page's server side hands the form. */
export interface AuthorApplicationHost {
  /** The current consent version tag the page rendered (EARS-6). */
  consentVersion: string;
  /** The personal-data policy and consents page. */
  policyHref: string;
  /** The `specialties_minzdrav` book by name, «Другое» excluded (EARS-4). */
  specialties: AuthorSpecialty[];
  /** The SmartCaptcha site key; absent — no challenge (the dev stand). */
  botProtectionSiteKey?: string | undefined;
}

/**
 * 033 EARS-4…10 — the signed-in half of «Подать заявку»: the repeat banner
 * from the applicant read, the form with its inline errors, the server-failure
 * state that retries with the same idempotency key, and «Заявка отправлена».
 * The submission lifecycle is `@ds/applications`' `submissionReducer`; a request
 * is sent only when that reducer moved to `sending`, so a double tap sends one.
 */
export function AuthorApplication({
  viewer,
  host,
  disclosure,
}: {
  viewer: ApplyViewer;
  host: AuthorApplicationHost;
  disclosure?: ReactNode;
}) {
  const [submission, dispatch] = useReducer(
    (state: SubmissionState, event: SubmissionEvent) =>
      submissionReducer(state, event),
    undefined,
    () => startSubmission(),
  );
  const [values, setValues] = useState<AuthorFormValues>(emptyAuthorForm);
  const [errors, setErrors] = useState<AuthorFormErrors>({});
  const [focusField, setFocusField] = useState<{
    field: AuthorFormField;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);

  // EARS-10 — read once on load; a failed read hides the banner, the form stays.
  useEffect(() => {
    let live = true;
    void readOwnAuthorApplications().then((read) => {
      if (live) setRepeat(showRepeatBanner(read));
    });
    return () => {
      live = false;
    };
  }, []);

  const captcha = useBotProtectedAction({
    onChallengeError: () => {
      dispatch({ type: "failed", failure: { kind: "bot-protection" } });
      setNotice(copy.errors.botProtection);
    },
    onActionError: () => {
      dispatch({ type: "failed", failure: { kind: "unavailable" } });
    },
  });

  const idempotencyKey = submission.idempotencyKey;

  function send() {
    if (submission.phase !== "editing" && submission.phase !== "unavailable")
      return;
    const check = validateAuthorForm(values, host.consentVersion);
    if (!check.ok) {
      setErrors(check.errors);
      setFocusField({ field: check.firstInvalid });
      return;
    }
    setErrors({});
    setNotice(null);
    dispatch({ type: "submit" });
    captcha.request(async (captchaToken) => {
      try {
        const result = await submitAuthorApplication(check.body, {
          idempotencyKey,
          ...(captchaToken ? { captchaToken } : {}),
        });
        dispatch({ type: "succeeded", result });
        setRepeat(true);
      } catch (error) {
        const failure =
          error instanceof ApplicationsError
            ? classifyFailure(error)
            : ({ kind: "unavailable" } as const);
        dispatch({ type: "failed", failure });
        if (failure.kind === "fields") {
          const refused = fieldErrorsFromRefusal(failure.problems);
          if (refused) {
            setErrors(refused.errors);
            setFocusField({ field: refused.firstInvalid });
          } else setNotice(copy.errors.refused);
        } else if (failure.kind === "signed-out") {
          window.location.reload();
        } else if (failure.kind === "bot-protection") {
          setNotice(copy.errors.botProtection);
        } else if (failure.kind === "refused") {
          setNotice(copy.errors.refused);
        }
      }
    });
  }

  function another() {
    dispatch({ type: "another" });
    setValues(emptyAuthorForm());
    setErrors({});
    setNotice(null);
  }

  if (submission.phase === "sent") return <SentState onAnother={another} />;

  return (
    <div>
      {repeat ? (
        <div
          data-testid="apply-repeat-banner"
          className="mb-5 flex items-start gap-3 border-2 border-border bg-section px-4 py-3.5"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 flex-none items-center justify-center bg-tint text-caption font-extrabold text-tint-foreground"
          >
            !
          </span>
          <p className="text-caption leading-assurance text-muted-foreground">
            <b className="text-foreground">{copy.repeatBanner.lead}</b>{" "}
            {copy.repeatBanner.rest}
          </p>
        </div>
      ) : null}
      <AuthorForm
        viewer={viewer}
        host={host}
        values={values}
        errors={errors}
        focusField={focusField}
        sending={submission.phase === "sending"}
        unavailable={submission.phase === "unavailable"}
        notice={notice}
        captchaFieldProps={captcha.fieldProps}
        disclosure={disclosure}
        onChange={(patch) => {
          setValues((v) => ({ ...v, ...patch }));
          // A field the expert is fixing drops its own message; the others stay.
          setErrors((e) => {
            const next = { ...e };
            for (const k of Object.keys(patch))
              delete next[k as AuthorFormField];
            return next;
          });
        }}
        onSubmit={send}
      />
    </div>
  );
}
