import type { Metadata } from "next";

import { LayoutRhythmView } from "./layout-rhythm-view";

export const metadata: Metadata = {
  title: "Layout & spatial rhythm · DS Showcase",
  description:
    "The container / breakpoint contract and the semantic spacing roles (canvas §09), composed at both breakpoints.",
};

export default function LayoutRhythmPage() {
  return <LayoutRhythmView />;
}
