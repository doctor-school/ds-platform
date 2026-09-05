import type { ReactNode } from "react";

/**
 * 020 §6.1 D4 (#1722, slice 3) — the `(room)` route group.
 *
 * The room is a VIEWPORT-BOUNDED surface: `RoomShell` fills `h-dvh` and clips its
 * own overflow, and it paints its own header bar. The 017 storefront chrome
 * (`app/(storefront)/layout.tsx` — header, nav, footer) would therefore stack a
 * second header above it and push the room out of the viewport. So the room does
 * not live under that group; it lives here, and this layout is deliberately a
 * PASS-THROUGH — a group whose only purpose is to opt OUT of the storefront
 * shell. The group adds no URL segment: the route stays `/events/:slug/room`.
 *
 * The academy reaches the same result differently (its room route sits outside
 * the `@chrome` parallel route), which is exactly why the shell is host-agnostic
 * and each host seats it its own way.
 */
export default function RoomGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
