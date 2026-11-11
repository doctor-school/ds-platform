"use client";

import { useEffect } from "react";

import { EVENT_GONE_NOTICE_VALUE, LANDING_NOTICE_PARAM } from "./marker";

/**
 * 021 EARS-10 (amendment 2026-11-11) — once the notice has rendered, the marker
 * leaves the address bar (`history.replaceState`, the history state kept), so
 * a reload, Back/Forward or a copied link does not repeat it. No storage, no
 * cookie: the line is one-time because the URL that asked for it is gone.
 */
export function ClearNoticeMarker() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (
      url.searchParams.get(LANDING_NOTICE_PARAM) !== EVENT_GONE_NOTICE_VALUE
    ) {
      return;
    }
    url.searchParams.delete(LANDING_NOTICE_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);
  return null;
}
