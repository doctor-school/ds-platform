"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@ds/design-system";
import { SCHOOL_INTEREST_RETURN_QUERY } from "@ds/schemas";

import { createLearningClient } from "../client/index";
import {
  registerHref,
  schoolHref,
  type LearningHostConfig,
} from "./host-config";
import { SCHOOL_UI_COPY } from "./learning-ui-copy";

const C = SCHOOL_UI_COPY.soon;

// 023 EARS-7 — the «скоро» school's interest capture: a doctor ↔ school
// interest record (never the doctor's specialty). A guest goes through the 021
// registration with the school screen + `capture=interest` as the return
// target, and the same capture completes on return; a signed-in doctor gets
// «Вы в списке» with the way to withdraw.

export interface SchoolInterestProps {
  config: LearningHostConfig;
  schoolId: string;
  schoolSlug: string;
  signedIn: boolean;
  /** The read's flag; null for a guest. */
  interested: boolean | null;
}

type Phase = "idle" | "saving" | "error";

/** Whether the page was landed on from the guest capture's return target. */
function landedWithCapture(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search
    .slice(1)
    .split("&")
    .includes(SCHOOL_INTEREST_RETURN_QUERY);
}

/** Drop the marker so a reload or a later withdraw never re-registers. */
function forgetCapture(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("capture");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function SchoolInterest({
  config,
  schoolId,
  schoolSlug,
  signedIn,
  interested,
}: SchoolInterestProps) {
  const [inList, setInList] = useState(interested === true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failed, setFailed] = useState<"register" | "withdraw" | null>(null);
  const resumed = useRef(false);

  const write = async (kind: "register" | "withdraw") => {
    setPhase("saving");
    setFailed(null);
    const client = createLearningClient();
    try {
      if (kind === "register") await client.registerSchoolInterest(schoolId);
      else await client.withdrawSchoolInterest(schoolId);
      setInList(kind === "register");
      setPhase("idle");
    } catch {
      setFailed(kind);
      setPhase("error");
    }
  };

  // EARS-7 — the guest's capture completes on the return from registration.
  useEffect(() => {
    if (!signedIn || resumed.current || !landedWithCapture()) return;
    resumed.current = true;
    forgetCapture();
    if (!interested) void write("register");
    // Runs once, on the landing.
  }, []);

  const busy = phase === "saving";
  const back = `${schoolHref(config, schoolSlug)}?${SCHOOL_INTEREST_RETURN_QUERY}`;

  return (
    <div className="mx-auto mt-6 flex max-w-prose flex-col items-center gap-4">
      {inList ? (
        <div
          data-testid="school-interest-listed"
          className="flex flex-col items-center gap-3"
        >
          <div className="text-base font-extrabold tracking-tight">
            {C.listed.title}
          </div>
          <div className="text-sm leading-normal font-semibold text-muted-foreground">
            {C.listed.text}
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void write("withdraw")}
          >
            {C.listed.withdraw}
          </Button>
        </div>
      ) : (
        <div
          data-testid="school-interest-capture"
          className="flex flex-col items-center gap-3"
        >
          <div className="text-sm leading-normal font-semibold text-muted-foreground">
            {C.capture.text}
          </div>
          {signedIn ? (
            <Button disabled={busy} onClick={() => void write("register")}>
              {C.capture.action}
            </Button>
          ) : (
            <Button asChild>
              <a href={registerHref(config, back)}>{C.capture.action}</a>
            </Button>
          )}
        </div>
      )}
      {failed ? (
        <div className="w-full text-left">
          <Alert variant="danger">
            {failed === "register" ? C.error.register : C.error.withdraw}
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
