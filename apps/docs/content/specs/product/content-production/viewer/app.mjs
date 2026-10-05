// IDEF0 viewer for the DS content-production model (../model/index.yaml + diagram YAMLs; format: ../model/FORMAT-ru.md).
/* global document, location, addEventListener, removeEventListener -- a browser module, served as is */
// React Flow renders; the layout below is the IDEF0 staircase: boxes A1 … An on a diagonal from
// top-left to bottom-right in number order, ICOM sides fixed (I = west, C = north, O = east,
// M = south), arrows routed orthogonally by IDEF0 convention, labels placed where they cross
// nothing. ELK's layered placer was dropped: with partitions and forced model order it still keeps
// the columns but lifts boxes that feed back (A5, A6 rose above A4 on A0) — it has no notion of a
// staircase, so boxes are placed here and only the routing follows from that placement.
import React from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
} from "@xyflow/react";
import htm from "htm";
import { parse as parseYaml } from "yaml";

const html = htm.bind(React.createElement);
const { useEffect, useMemo, useState, useCallback } = React;

const KIND_NAME = { I: "вход", C: "управление", O: "выход", M: "механизм" };

// Diagram units equal CSS px at zoom 1. Fonts are sized so that at LEGIBLE_ZOOM arrow labels
// render ≥ 11 px and box titles ≥ 13 px; the initial view fits the diagram width and never
// zooms out below that (a wider diagram scrolls instead of shrinking into illegibility).
const U = {
  label: 13,
  line: 16,
  title: 15,
  titleLine: 19,
  lane: 12,
  pad: 16,
};
const LEGIBLE_ZOOM = 0.87;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const asList = (end) => (Array.isArray(end) ? end : end ? [end] : []);
const codeNumber = (code) => Number(String(code).slice(1)) || 0;

const measureCtx = document.createElement("canvas").getContext("2d");
function textWidth(text, size, weight = 400) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}
function wrapTo(text, maxWidth, size, weight) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, weight) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
/** Label block size; matches `.arrow-label` (13 px / 16 px lines, 2 px + 4 px padding, 3 px rule). */
function labelBlock(text, maxWidth) {
  const lines = wrapTo(text, maxWidth - 10, U.label);
  return {
    text: lines.join("\n"),
    lines: lines.length,
    width: Math.ceil(Math.max(...lines.map((l) => textWidth(l, U.label)))) + 11,
    height: lines.length * U.line + 4,
  };
}

/** Arrow kind for colouring: the ICOM role at its target (boundary outputs are O). */
function arrowKind(arrow) {
  const target = asList(arrow.to)[0] ?? {};
  if (target.boundary) return "O";
  return target.side ?? "I";
}

// ---------- Staircase layout ----------

/**
 * Branch kinds. Boundary: `in` (I code → west), `drop` (C code → north), `rise` (M code → south),
 * `out` (east → O code). Between boxes: `fwd` to a later box, `back` to the same or an earlier box
 * (IDEF0 feedback: to a control above all boxes, to an input or mechanism below the source box).
 */
function classify(diagram) {
  const boxes = diagram.boxes ?? [];
  const col = new Map(boxes.map((b, i) => [b.id, i]));
  const routes = [];
  for (const arrow of diagram.arrows ?? []) {
    const from = asList(arrow.from);
    const to = asList(arrow.to);
    if (from.length !== 1)
      throw new Error(
        `стрелка ${arrow.id}: источников ${from.length}, нужен один (ветвление — только в to)`,
      );
    const src = from[0];
    if (!src.boundary && !col.has(src.box))
      throw new Error(`стрелка ${arrow.id}: неизвестный блок ${src.box}`);
    const branches = to.map((end) => {
      if (end.boundary) {
        if (src.boundary)
          throw new Error(
            `стрелка ${arrow.id}: идёт с границы ${src.boundary} на границу ${end.boundary}, минуя блоки`,
          );
        return { end, kind: "out" };
      }
      if (!col.has(end.box))
        throw new Error(`стрелка ${arrow.id}: неизвестный блок ${end.box}`);
      if (src.boundary) {
        const side = src.boundary[0];
        if (end.side !== side)
          throw new Error(
            `стрелка ${arrow.id}: граничная ${src.boundary} входит в ${end.box} со стороны ${end.side}, а должна — со стороны ${side}`,
          );
        return { end, kind: { I: "in", C: "drop", M: "rise" }[side] };
      }
      return {
        end,
        kind: col.get(end.box) > col.get(src.box) ? "fwd" : "back",
      };
    });
    // Boundary drops and rises are drawn left to right; the leftmost carries the label.
    if (src.boundary)
      branches.sort((a, b) => col.get(a.end.box) - col.get(b.end.box));
    routes.push({ arrow, src, branches });
  }
  return { boxes, col, routes };
}

/** Ports on one side, ordered by (group, key, model order) so that routed lines do not cross. */
class Side {
  constructor() {
    this.items = [];
  }
  add(id, group, key) {
    if (!this.items.some((p) => p.id === id))
      this.items.push({ id, group, key, n: this.items.length });
  }
  sort() {
    this.items.sort((a, b) => a.group - b.group || a.key - b.key || a.n - b.n);
    this.items.forEach((p, i) => (p.index = i));
  }
  get length() {
    return this.items.length;
  }
  index(id) {
    return this.items.find((p) => p.id === id).index;
  }
}

/** Drops repeated points and interior points on a straight run: a bend is drawn only where the
 * route turns. Ports share their coordinate with the line feeding them, so no jog is left. */
function straighten(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    const before = out[out.length - 2];
    if (
      before &&
      ((before.x === prev.x && prev.x === p.x) ||
        (before.y === prev.y && prev.y === p.y))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

function layoutDiagram(diagram) {
  const { boxes, col, routes } = classify(diagram);
  const single = boxes.length === 1;
  const last = boxes.length - 1;
  const sides = new Map(
    boxes.map((b) => [
      b.id,
      { I: new Side(), C: new Side(), O: new Side(), M: new Side() },
    ]),
  );

  // 1. Ports. East: feedback up, boundary outputs, forward (farthest first), feedback down.
  // West: from earlier boxes, boundary inputs, feedback. North: from earlier boxes (later source
  // leftmost), boundary controls, feedback. South: from earlier boxes, boundary mechanisms, feedback.
  for (const { arrow, src, branches } of routes) {
    if (!src.boundary) {
      const kinds = branches.map((b) =>
        b.kind === "back" ? (b.end.side === "C" ? "up" : "down") : b.kind,
      );
      const far = Math.max(
        ...branches.map((b) => (b.end.box ? col.get(b.end.box) : 0)),
      );
      const group = kinds.includes("up")
        ? 0
        : kinds.includes("out")
          ? 1
          : kinds.includes("fwd")
            ? 2
            : 3;
      sides.get(src.box).O.add(arrow.id, group, group === 2 ? -far : 0);
    }
    for (const { end, kind } of branches) {
      if (!end.box) continue;
      const srcCol = src.boundary ? -1 : col.get(src.box);
      const group = kind === "fwd" ? 0 : kind === "back" ? 2 : 1;
      const key =
        kind === "fwd"
          ? end.side === "C"
            ? -srcCol
            : srcCol
          : kind === "back"
            ? -srcCol
            : codeNumber(src.boundary);
      sides.get(end.box)[end.side].add(arrow.id, group, key);
    }
  }
  for (const s of sides.values())
    for (const side of Object.values(s)) side.sort();

  // 2. Lanes: vertical tracks right of a source box (feedback leaving it) and left of a target
  // column (arrows coming down or up to a west input); horizontal tracks above all boxes (feedback
  // controls) and under a box (feedback inputs/mechanisms leaving it, forward mechanisms entering it).
  const xrUp = boxes.map(() => []);
  const xrDown = boxes.map(() => []);
  const laneDown = boxes.map(() => []);
  const laneUp = boxes.map(() => []);
  const laneMech = boxes.map(() => []);
  const top = [];
  const under = boxes.map(() => []);
  for (const { arrow, src, branches } of routes) {
    const s = src.box ? col.get(src.box) : -1;
    const westIn = branches.filter(
      (b) => (b.kind === "fwd" || b.kind === "in") && b.end.side === "I",
    );
    if (westIn.length && (src.box || westIn.length > 1)) {
      const first = westIn.reduce((a, b) =>
        col.get(b.end.box) < col.get(a.end.box) ? b : a,
      );
      laneDown[col.get(first.end.box)].push({
        id: arrow.id,
        order: sides.get(first.end.box).I.index(arrow.id),
      });
    }
    for (const { end, kind } of branches) {
      if (kind === "fwd" && end.side === "M") {
        laneMech[col.get(end.box)].push({ id: `${arrow.id}>${end.box}` });
        under[col.get(end.box)].push(`${arrow.id}>${end.box}`);
      }
      if (kind === "back" && end.side === "I")
        laneUp[col.get(end.box)].push({
          id: `${arrow.id}>${end.box}`,
          order: -sides.get(end.box).I.index(arrow.id),
        });
    }
    if (branches.some((b) => b.kind === "back" && b.end.side === "C")) {
      xrUp[s].push({
        id: arrow.id,
        order: sides.get(src.box).O.index(arrow.id),
      });
      top.push(arrow.id);
    }
    if (branches.some((b) => b.kind === "back" && b.end.side !== "C")) {
      xrDown[s].push({
        id: arrow.id,
        order: -sides.get(src.box).O.index(arrow.id),
      });
      under[s].push(arrow.id);
    }
  }
  const byOrder = (list) =>
    list.sort((a, b) => a.order - b.order).map((l) => l.id);
  const xrLanes = boxes.map((_, i) => ({
    up: byOrder(xrUp[i]),
    down: byOrder(xrDown[i]),
  }));
  const leftLanes = boxes.map((_, j) => {
    const down = byOrder(laneDown[j]);
    const up = byOrder(laneUp[j]);
    return { down, up, mech: laneMech[j].map((l) => l.id) };
  });
  const nXr = xrLanes.map((l) => Math.max(l.up.length, l.down.length));
  const nLeft = leftLanes.map(
    (l) => Math.max(l.down.length, l.up.length) + l.mech.length,
  );

  // 3. Box sizes (title measured in its rendered font) and staircase positions.
  const margin = single ? 300 : 130;
  const sized = boxes.map((box) => {
    const s = sides.get(box.id);
    // A title wraps only between words: the longest word sets the floor.
    const longestWord = Math.max(
      ...String(box.name)
        .split(/\s+/)
        .map((w) => textWidth(w, U.title, 600)),
    );
    const width = Math.max(
      single ? 340 : 120,
      Math.ceil(longestWord) + 26,
      (Math.max(s.C.length, s.M.length) + 1) * (single ? 34 : 15),
    );
    const titleLines = wrapTo(box.name, width - 22, U.title, 600).length;
    const height = Math.max(
      single ? 200 : 96,
      titleLines * U.titleLine + 46,
      (Math.max(s.I.length, s.O.length) + 1) * (single ? 56 : 30),
    );
    return { box, width, height };
  });
  const topBand = (single ? 170 : 130) + top.length * U.lane;
  let x = margin + nLeft[0] * U.lane;
  let y = topBand;
  const placed = sized.map((s, i) => {
    if (i) {
      x += Math.max(40, 2 * U.pad + (nXr[i - 1] + nLeft[i]) * U.lane);
      y += Math.max(50, U.pad + under[i - 1].length * U.lane + 34);
    }
    const p = { ...s, x, y };
    x += s.width;
    y += s.height;
    return p;
  });
  const frameW = x + U.pad + nXr[last] * U.lane + (single ? margin : 110);
  const frameH = y + U.pad + under[last].length * U.lane + (single ? 170 : 130);

  // 4. Routes.
  const at = (id) => placed[col.get(id)];
  const port = (boxId, side, arrowId) => {
    const b = at(boxId);
    const list = sides.get(boxId)[side];
    const t = (list.index(arrowId) + 1) / (list.length + 1);
    if (side === "I") return { x: b.x, y: Math.round(b.y + b.height * t) };
    if (side === "O")
      return { x: b.x + b.width, y: Math.round(b.y + b.height * t) };
    if (side === "C") return { x: Math.round(b.x + b.width * t), y: b.y };
    return { x: Math.round(b.x + b.width * t), y: b.y + b.height };
  };
  const leftLaneX = (j, id) => {
    const l = leftLanes[j];
    let k = l.down.indexOf(id);
    if (k < 0) k = l.up.indexOf(id);
    if (k < 0) k = Math.max(l.down.length, l.up.length) + l.mech.indexOf(id);
    return placed[j].x - U.pad - k * U.lane;
  };
  const xrX = (i, id) => {
    const l = xrLanes[i];
    const k = Math.max(l.up.indexOf(id), l.down.indexOf(id));
    return placed[i].x + placed[i].width + U.pad + k * U.lane;
  };
  const underY = (i, id) =>
    placed[i].y + placed[i].height + U.pad + under[i].indexOf(id) * U.lane;
  const topY = (id) => topBand - U.pad - top.indexOf(id) * U.lane;

  // Neighbouring ports sit closer than a code is wide: every second code moves one row out.
  const stagger = (boxId, side, arrowId) =>
    (sides.get(boxId)[side].index(arrowId) % 2) * 14;
  const edges = [];
  const codes = [];
  for (const { arrow, src, branches } of routes) {
    const s = src.box ? col.get(src.box) : -1;
    const S = src.box ? port(src.box, "O", arrow.id) : null;
    const westIn = branches.filter(
      (b) => (b.kind === "fwd" || b.kind === "in") && b.end.side === "I",
    );
    const firstWest = westIn.length
      ? Math.min(...westIn.map((b) => col.get(b.end.box)))
      : -1;
    let inY = null;
    branches.forEach(({ end, kind }, k) => {
      const T = end.box ? port(end.box, end.side, arrow.id) : null;
      const t = end.box ? col.get(end.box) : -1;
      let points;
      if (kind === "in") {
        // A branching boundary input enters at the height of its first (highest) target.
        inY ??= port(
          westIn.find((b) => col.get(b.end.box) === firstWest).end.box,
          "I",
          arrow.id,
        ).y;
        if (k === 0)
          codes.push({
            code: src.boundary,
            side: "I",
            x: 0,
            y: inY,
            key: `${arrow.id}`,
          });
        const lane = westIn.length > 1 ? leftLaneX(firstWest, arrow.id) : T.x;
        points = [
          { x: 0, y: inY },
          { x: lane, y: inY },
          { x: lane, y: T.y },
          T,
        ];
      } else if (kind === "drop") {
        codes.push({
          code: src.boundary,
          side: "C",
          x: T.x,
          y: -stagger(end.box, "C", arrow.id),
          key: `${arrow.id}>${end.box}`,
        });
        points = [{ x: T.x, y: 0 }, T];
      } else if (kind === "rise") {
        codes.push({
          code: src.boundary,
          side: "M",
          x: T.x,
          y: frameH + stagger(end.box, "M", arrow.id),
          key: `${arrow.id}>${end.box}`,
        });
        points = [{ x: T.x, y: frameH }, T];
      } else if (kind === "out") {
        codes.push({
          code: end.boundary,
          side: "O",
          x: frameW,
          y: S.y,
          key: arrow.id,
        });
        points = [S, { x: frameW, y: S.y }];
      } else if (kind === "fwd" && end.side === "C") {
        points = [S, { x: T.x, y: S.y }, T];
      } else if (kind === "fwd" && end.side === "I") {
        const lane = leftLaneX(firstWest, arrow.id);
        points = [S, { x: lane, y: S.y }, { x: lane, y: T.y }, T];
      } else if (kind === "fwd") {
        const lane = leftLaneX(t, `${arrow.id}>${end.box}`);
        const below = underY(t, `${arrow.id}>${end.box}`);
        points = [
          S,
          { x: lane, y: S.y },
          { x: lane, y: below },
          { x: T.x, y: below },
          T,
        ];
      } else if (end.side === "C") {
        const xr = xrX(s, arrow.id);
        const above = topY(arrow.id);
        points = [
          S,
          { x: xr, y: S.y },
          { x: xr, y: above },
          { x: T.x, y: above },
          T,
        ];
      } else {
        const xr = xrX(s, arrow.id);
        const below = underY(s, arrow.id);
        points =
          end.side === "I"
            ? [
                S,
                { x: xr, y: S.y },
                { x: xr, y: below },
                { x: leftLaneX(t, `${arrow.id}>${end.box}`), y: below },
                { x: leftLaneX(t, `${arrow.id}>${end.box}`), y: T.y },
                T,
              ]
            : [
                S,
                { x: xr, y: S.y },
                { x: xr, y: below },
                { x: T.x, y: below },
                T,
              ];
      }
      edges.push({
        id: `${arrow.id}#${k}`,
        arrow,
        kind:
          kind === "in" || kind === "drop" || kind === "rise"
            ? src.boundary[0]
            : arrowKind(arrow),
        prefer: kind === "drop" || kind === "rise" ? "end" : "start",
        points: straighten(points),
        host: k === 0,
      });
    });
  }

  // 5. Labels: one per arrow, on its first branch, at the cheapest free spot along it — never on a
  // box, a boundary or another label; crossing a line costs, distance from the anchor costs a little.
  const boxRects = placed.map((p) => ({
    x: p.x,
    y: p.y,
    w: p.width,
    h: p.height,
  }));
  const segments = edges.flatMap((e) =>
    e.points
      .slice(1)
      .map((p, i) => ({ a: e.points[i], b: p, arrow: e.arrow.id })),
  );
  const labels = [];
  const hits = (r, q, m) =>
    r.x < q.x + q.w + m &&
    q.x < r.x + r.w + m &&
    r.y < q.y + q.h + m &&
    q.y < r.y + r.h + m;
  const crossings = (r) =>
    segments.filter(({ a, b }) => {
      const sx = Math.min(a.x, b.x);
      const sy = Math.min(a.y, b.y);
      return hits(
        r,
        { x: sx, y: sy, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) },
        1,
      );
    }).length;
  const widths = single ? [280, 200, 140] : [240, 170, 120];
  // Shortest paths first: they have the fewest spots, long ones can still move along.
  const pathLength = (e) =>
    e.points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.abs(p.x - e.points[i].x) + Math.abs(p.y - e.points[i].y),
        0,
      );
  const hosts = edges
    .filter((e) => e.host)
    .sort((a, b) => pathLength(a) - pathLength(b));
  for (const edge of hosts) {
    const pts =
      edge.prefer === "end" ? [...edge.points].reverse() : edge.points;
    let best = null;
    const consider = (spot, block, walkedSoFar) => {
      const r = { x: spot.x, y: spot.y, w: block.width, h: block.height };
      if (
        r.x < 4 ||
        r.y < 4 ||
        r.x + r.w > frameW - 4 ||
        r.y + r.h > frameH - 4
      )
        return;
      if (boxRects.some((q) => hits(r, q, 4))) return;
      const overlap = labels.filter((q) => hits(r, q, 3)).length;
      const cost =
        overlap * 1000 +
        crossings(r) * 40 +
        (walkedSoFar + spot.d) * 0.05 +
        block.lines * 6;
      if (!best || cost < best.cost) best = { cost, r, block };
    };
    let walked = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const maxW of widths) {
        const block = labelBlock(edge.arrow.label ?? edge.arrow.id, maxW);
        const spots = [];
        if (a.y === b.y) {
          const x0 = Math.min(a.x, b.x);
          const room = len - block.width - 12;
          for (const f of room > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
            const along = 6 + f * Math.max(room, 0);
            const lx =
              a.x <= b.x
                ? x0 + along
                : Math.max(a.x, b.x) - along - block.width;
            spots.push(
              { x: lx, y: a.y - block.height - 3, d: along },
              { x: lx, y: a.y + 3, d: along + 4 },
            );
          }
        } else {
          const y0 = Math.min(a.y, b.y);
          const room = len - block.height - 12;
          for (const f of room > 0 ? [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1] : [0]) {
            const along = 6 + f * Math.max(room, 0);
            const ly =
              a.y <= b.y
                ? y0 + along
                : Math.max(a.y, b.y) - along - block.height;
            spots.push(
              { x: a.x + 5, y: ly, d: along },
              { x: a.x - 5 - block.width, y: ly, d: along + 4 },
            );
          }
        }
        for (const spot of spots) consider(spot, block, walked);
      }
      walked += len;
    }
    // Dense margins (many boundary arrows side by side) can leave no free spot on the path itself:
    // then search outward from the path's corners, so a label moves aside instead of covering
    // another label or disappearing.
    if (!best || best.cost >= 1000) {
      const block = labelBlock(
        edge.arrow.label ?? edge.arrow.id,
        widths[widths.length - 1],
      );
      for (let k = 1; k <= 16; k += 1) {
        const step = k * 8;
        for (const p of pts)
          for (const [dx, dy] of [
            [5, -block.height - step],
            [5, step],
            [-5 - block.width, -block.height - step],
            [-5 - block.width, step],
            [5 + step, -block.height / 2],
            [-5 - block.width - step, -block.height / 2],
          ])
            consider({ x: p.x + dx, y: p.y + dy, d: 200 + step * 4 }, block, 0);
        if (best && best.cost < 1000) break;
      }
    }
    if (!best) {
      // Never drop a label: clamp it into the frame next to the arrow's first point.
      const block = labelBlock(
        edge.arrow.label ?? edge.arrow.id,
        widths[widths.length - 1],
      );
      const p = pts[0];
      best = {
        block,
        r: {
          x: Math.min(Math.max(p.x + 5, 4), frameW - 4 - block.width),
          y: Math.min(Math.max(p.y + 3, 4), frameH - 4 - block.height),
          w: block.width,
          h: block.height,
        },
      };
    }
    labels.push(best.r);
    edge.label = { text: best.block.text, x: best.r.x, y: best.r.y };
  }

  // 6. React Flow nodes and edges. Every edge runs frame → frame through two hidden handles: the
  // path is drawn from the routed points, so React Flow only supplies events and markers.
  const nodes = [
    {
      id: "frame",
      type: "frame",
      position: { x: 0, y: 0 },
      data: { codes },
      // Explicit width/height: React Flow then never hides a rebuilt node while it re-measures it.
      width: frameW,
      height: frameH,
      style: { width: frameW, height: frameH },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    },
    ...placed.map((p) => ({
      id: p.box.id,
      type: "box",
      position: { x: p.x, y: p.y },
      data: { box: p.box },
      width: p.width,
      height: p.height,
      style: { width: p.width, height: p.height },
      draggable: false,
    })),
  ];
  return {
    width: frameW,
    height: frameH,
    nodes,
    edges: edges.map((e) => ({
      id: e.id,
      type: "idef",
      source: "frame",
      sourceHandle: "s",
      target: "frame",
      targetHandle: "t",
      data: {
        arrow: e.arrow,
        kind: e.kind,
        points: e.points,
        label: e.label ?? null,
      },
    })),
  };
}

// ---------- React Flow node / edge renderers ----------

const CODE_OFFSET = {
  I: { transform: "translate(calc(-100% - 6px), -50%)" },
  O: { transform: "translate(6px, -50%)" },
  C: { transform: "translate(4px, calc(-100% - 2px))" },
  M: { transform: "translate(4px, 2px)" },
};

function FrameNode({ data }) {
  return html`<div class="frame">
    <${Handle}
      id="s"
      type="source"
      position=${Position.Left}
      isConnectable=${false}
    />
    <${Handle}
      id="t"
      type="target"
      position=${Position.Left}
      isConnectable=${false}
    />
    ${data.codes.map(
      (c) =>
        html`<span
          key=${c.key}
          class="code"
          style=${{ left: c.x, top: c.y, ...CODE_OFFSET[c.side] }}
        >
          ${c.code}
        </span>`,
    )}
  </div>`;
}

function BoxNode({ data }) {
  // Focus is drawn from data, not React Flow selection: selecting re-sorts nodes by z-index and
  // re-inserts the DOM node mid-click, which swallows the double-click that opens a child diagram.
  const { box, hasChild, onOpen, focused: selected } = data;
  const mechanisms = box.mechanisms ?? [];
  return html`<div
    class=${"box" + (selected ? " selected" : "")}
    title=${box.note ?? ""}
    onDoubleClick=${onOpen ?? undefined}
  >
    ${hasChild ? html`<span class="drill" title="Двойной щелчок — декомпозиция">▼</span>` : null}
    <div class="name">${box.name}</div>
    <div class="mech" title=${mechanisms.join("\n")}>
      ${mechanisms.join(" · ")}
    </div>
    <div class="num">${box.id}</div>
  </div>`;
}

function IdefEdge({ id, data, markerEnd }) {
  const points = data.points;
  if (!points.length) return null;
  const path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  const color = `var(--${data.kind.toLowerCase()})`;
  return html`<${React.Fragment}>
    <${BaseEdge}
      id=${id}
      path=${path}
      markerEnd=${markerEnd}
      style=${{ stroke: color, strokeWidth: 1 }}
      interactionWidth=${12}
    />
    ${
      data.label
        ? html`<${EdgeLabelRenderer}>
            <div
              class=${"arrow-label nodrag nopan" + (data.active ? " active" : "")}
              style=${{ transform: `translate(${data.label.x}px, ${data.label.y}px)`, borderLeft: `3px solid ${color}` }}
              onClick=${() => data.onSelect?.(data.arrow.id)}
              onMouseEnter=${() => data.onHover?.(data.arrow.id)}
              onMouseLeave=${() => data.onHover?.(null)}
            >
              ${data.label.text}
            </div>
          <//>`
        : null
    }
  <//>`;
}

const nodeTypes = { frame: FrameNode, box: BoxNode };
const edgeTypes = { idef: IdefEdge };

// ---------- Side panel ----------

/** Registry IDs as chips: the viewer reads only the model YAML, which carries IDs, not names. */
function Ids({ ids }) {
  if (!ids?.length) return html`<p class="muted">—</p>`;
  return html`<div class="ids">
    ${ids.map((id) => html`<span key=${id} class="id">${id}</span>`)}
  </div>`;
}

/** Draft effort of a leaf (model/FORMAT-ru.md «Лист и черновая трудоёмкость»). */
function Effort({ effort }) {
  const hours = Array.isArray(effort.hours_draft)
    ? effort.hours_draft.join("–")
    : effort.hours_draft;
  return html`<div>
    <h3>Трудоёмкость — черновик</h3>
    <ul>
      <li><b>Роль:</b> ${effort.role}</li>
      <li><b>Часы на ${effort.unit}:</b> ${hours}</li>
      ${effort.iterations ? html`<li><b>× итерации:</b> ${effort.iterations}</li>` : null}
      <li><b>Драйвер:</b> ${effort.driver}</li>
      <li class="muted">${effort.basis}</li>
    </ul>
  </div>`;
}

function Details({ diagram, focus, hasChild, onOpen }) {
  if (!focus) {
    return html`<div>
      <h2>${diagram.id} — ${diagram.title}</h2>
      ${diagram.purpose ? html`<p>${diagram.purpose}</p>` : null}
      ${diagram.viewpoint ? html`<p><b>Точка зрения:</b> ${diagram.viewpoint}</p>` : null}
      <p class="muted">
        Щелчок или наведение на блок или стрелку — её ID реестра. Двойной щелчок
        по блоку с ▼ — декомпозиция.
      </p>
      <div class="legend">
        <span><b style=${{ background: "var(--i)" }}></b>вход</span>
        <span><b style=${{ background: "var(--c)" }}></b>управление</span>
        <span><b style=${{ background: "var(--o)" }}></b>выход</span>
        <span><b style=${{ background: "var(--m)" }}></b>механизм</span>
      </div>
    </div>`;
  }
  if (focus.type === "box") {
    const box = diagram.boxes.find((b) => b.id === focus.id);
    if (!box) return null;
    return html`<div>
      <h2>${box.id} — ${box.name}</h2>
      ${hasChild(box.id) ? html`<p><button onClick=${() => onOpen(box.id)}>Открыть декомпозицию ${box.id}</button></p>` : null}
      ${box.note ? html`<p>${box.note}</p>` : null}
      ${box.effort ? html`<${Effort} effort=${box.effort} />` : null}
      <h3>Функции реестра (${(box.functions ?? []).length})</h3>
      <${Ids} ids=${box.functions} />
      <h3>Механизмы — роли</h3>
      <ul>
        ${(box.mechanisms ?? []).map((m) => html`<li key=${m}>${m}</li>`)}
      </ul>
    </div>`;
  }
  const arrow = diagram.arrows.find((a) => a.id === focus.id);
  if (!arrow) return null;
  const end = (e) =>
    e.boundary ? `граница ${e.boundary}` : `${e.box}.${e.side ?? "O"}`;
  return html`<div>
    <h2>${arrow.label}</h2>
    <p class="muted">
      ${arrow.id} · ${KIND_NAME[arrowKind(arrow)]} ·
      ${asList(arrow.from).map(end).join(", ")} →
      ${asList(arrow.to).map(end).join(", ")}
    </p>
    <h3>Объекты реестра (${(arrow.objects ?? []).length})</h3>
    <${Ids} ids=${arrow.objects} />
  </div>`;
}

// ---------- App ----------

function readHash(fallback) {
  return decodeURIComponent(location.hash.replace(/^#/, "")) || fallback;
}

function App({ model }) {
  const { index, diagrams } = model;
  const byId = useMemo(
    () => new Map(diagrams.map((d) => [d.id, d])),
    [diagrams],
  );
  const [current, setCurrent] = useState(() =>
    byId.has(readHash(index.root)) ? readHash(index.root) : index.root,
  );
  const [pinned, setPinned] = useState(null);
  const [hover, setHover] = useState(null);
  const diagram = byId.get(current);

  useEffect(() => {
    const onHash = () =>
      byId.has(readHash(index.root)) && setCurrent(readHash(index.root));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [byId, index.root]);
  const [layout, layoutError] = useMemo(() => {
    try {
      return [layoutDiagram(diagram), null];
    } catch (error) {
      return [null, String(error?.message ?? error)];
    }
  }, [diagram]);
  // Initial view: the whole diagram when that stays legible; otherwise LEGIBLE_ZOOM with the
  // diagram width on screen and the top edge visible — a tall staircase scrolls down.
  const fitWidth = useCallback(
    (instance) => {
      const canvas = document.querySelector(".canvas");
      if (!layout || !canvas) return;
      const outer = { w: layout.width + 80, h: layout.height + 60 };
      const zoom = Math.min(
        1.3,
        Math.max(
          LEGIBLE_ZOOM,
          Math.min(canvas.clientWidth / outer.w, canvas.clientHeight / outer.h),
        ),
      );
      instance.setViewport({
        x: Math.max(0, (canvas.clientWidth - outer.w * zoom) / 2) + 40 * zoom,
        y: Math.max(0, (canvas.clientHeight - outer.h * zoom) / 2) + 30 * zoom,
        zoom,
      });
    },
    [layout],
  );

  const open = useCallback(
    (id) => {
      if (!byId.has(id)) return;
      setPinned(null);
      setHover(null);
      location.hash = id;
      setCurrent(id);
    },
    [byId],
  );
  const hasChild = useCallback(
    (boxId) => byId.has(boxId) && byId.get(boxId).parent === current,
    [byId, current],
  );
  const focus = hover ?? pinned;
  const activeArrow = focus?.type === "arrow" ? focus.id : null;
  // Box nodes depend on the pinned box only: a hover that rebuilt the node list would re-render the
  // nodes under the pointer between the two clicks of a double-click.
  const pinnedBox = pinned?.type === "box" ? pinned.id : null;

  const nodes = useMemo(
    () =>
      (layout?.nodes ?? []).map((node) =>
        node.type === "box"
          ? {
              ...node,
              data: {
                ...node.data,
                focused: pinnedBox === node.id,
                hasChild: hasChild(node.id),
                onOpen: hasChild(node.id) ? () => open(node.id) : null,
              },
            }
          : node,
      ),
    [layout, pinnedBox, hasChild, open],
  );
  const edges = useMemo(
    () =>
      (layout?.edges ?? []).map((edge) => {
        const active = edge.data.arrow.id === activeArrow;
        const stroke = active
          ? "var(--hl)"
          : `var(--${edge.data.kind.toLowerCase()})`;
        return {
          ...edge,
          className: active ? "active" : "",
          // The focused arrow is drawn above the others so its whole route stays visible.
          zIndex: active ? 10 : 0,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "#2b2b2e",
          },
          style: { stroke },
          data: {
            ...edge.data,
            active,
            onSelect: (id) => setPinned({ type: "arrow", id }),
            onHover: (id) => setHover(id ? { type: "arrow", id } : null),
          },
        };
      }),
    [layout, activeArrow],
  );

  const chain = [];
  for (let d = diagram; d; d = d.parent ? byId.get(d.parent) : null)
    chain.unshift(d);

  return html`<div class="app">
    <header>
      <nav class="crumbs" aria-label="Уровни модели">
        ${chain.map(
          (d, i) =>
            html`<${React.Fragment} key=${d.id}>
              ${i ? " › " : ""}
              <button
                aria-current=${d.id === current ? "page" : undefined}
                onClick=${() => open(d.id)}
              >
                ${d.id}
              </button>
            <//>`,
        )}
        <span class="muted"> ${diagram.title}</span>
      </nav>
    </header>
    <main>
      <div class="canvas">
        ${
          layoutError
            ? html`<p class="err" style=${{ padding: 16 }}>
                Ошибка раскладки: ${layoutError}
              </p>`
            : html`<${ReactFlow}
                key=${current}
                nodes=${nodes}
                edges=${edges}
                nodeTypes=${nodeTypes}
                edgeTypes=${edgeTypes}
                onInit=${fitWidth}
                minZoom=${0.3}
                panOnScroll
                nodesDraggable=${false}
                elevateNodesOnSelect=${false}
                elevateEdgesOnSelect=${false}
                nodesConnectable=${false}
                zoomOnDoubleClick=${false}
                proOptions=${{ hideAttribution: true }}
                onNodeClick=${(_, node) => node.type === "box" && setPinned({ type: "box", id: node.id })}
                onNodeMouseEnter=${(_, node) => node.type === "box" && setHover({ type: "box", id: node.id })}
                onNodeMouseLeave=${() => setHover(null)}
                onEdgeClick=${(_, edge) => setPinned({ type: "arrow", id: edge.data.arrow.id })}
                onEdgeMouseEnter=${(_, edge) => setHover({ type: "arrow", id: edge.data.arrow.id })}
                onEdgeMouseLeave=${() => setHover(null)}
                onPaneClick=${() => setPinned(null)}
              >
                <${Background} gap=${24} size=${1} />
                <${Controls} showInteractive=${false} />
              <//>`
        }
      </div>
      <aside>
        <${Details}
          diagram=${diagram}
          focus=${focus}
          hasChild=${hasChild}
          onOpen=${open}
        />
      </aside>
    </main>
  </div>`;
}

async function loadModel() {
  const base = new URL("../model/", import.meta.url);
  const read = async (file) => {
    const response = await fetch(new URL(file, base));
    if (!response.ok)
      throw new Error(
        `файл model/${file} не получен — сервер ответил HTTP ${response.status}`,
      );
    return parseYaml(await response.text());
  };
  const index = await read("index.yaml");
  const diagrams = [];
  for (const entry of index.diagrams) {
    diagrams.push({
      ...(await read(entry.file)),
      id: entry.id,
      parent: entry.parent,
    });
  }
  return { index, diagrams };
}

const root = createRoot(document.getElementById("root"));
loadModel()
  .then((model) =>
    root.render(html`<${ReactFlowProvider}><${App} model=${model} /><//>`),
  )
  .catch((error) =>
    root.render(
      html`<p class="err" style=${{ padding: 16 }}>
        Не удалось загрузить модель: ${String(error?.message ?? error)}
      </p>`,
    ),
  );
