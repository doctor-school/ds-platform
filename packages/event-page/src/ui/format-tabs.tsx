"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";
import type { EventFormatMode } from "@ds/design-system/blocks";

/**
 * 020 EARS-8 / LD-4 (wave-3 gate row 33) — the hybrid format block's «очно /
 * онлайн» tabs. The active tab is URL state: a switch PUSHES the tab's href, so
 * a shared link reproduces it, a reload keeps it and the browser back button
 * moves between tabs rather than off the page; the server re-render then
 * carries the tab into the LD-9 return target. The tab flips at once (local
 * state) and follows the URL when history moves it (the `mode` prop).
 *
 * The `@ds/design-system` Tabs primitive supplies the tablist/tab/tabpanel
 * semantics and the arrow-key roving focus; the inactive panel is not in the
 * DOM.
 */
export function FormatTabs({
  mode,
  tabs,
  hrefs,
  offline,
  online,
}: {
  mode: EventFormatMode;
  tabs: Readonly<Record<EventFormatMode, string>>;
  hrefs: Readonly<Record<EventFormatMode, string>>;
  offline: ReactNode;
  online: ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState<EventFormatMode>(mode);
  useEffect(() => setActive(mode), [mode]);
  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        const next = value as EventFormatMode;
        setActive(next);
        router.push(hrefs[next], { scroll: false });
      }}
      data-testid="event-format-tabs"
      data-mode={active}
    >
      <TabsList>
        <TabsTrigger value="offline">{tabs.offline}</TabsTrigger>
        <TabsTrigger value="online">{tabs.online}</TabsTrigger>
      </TabsList>
      <TabsContent value="offline" className="mt-5">
        {offline}
      </TabsContent>
      <TabsContent value="online" className="mt-5">
        {online}
      </TabsContent>
    </Tabs>
  );
}
