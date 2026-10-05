// IDEF0 viewer for the DS content-production model (../model/index.yaml + diagram YAMLs; format: ../model/FORMAT-ru.md).
/* global document, location, addEventListener, removeEventListener -- a browser module, served as is */
// React Flow renders, ELK lays out: boxes with ICOM ports on fixed sides
// (I = west, C = north, O = east, M = south), orthogonal routing, the diagram frame
// as an ELK parent node whose ports are the boundary arrows (I1, C2, O1, M1 …).
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
import ELK from "elkjs";
import htm from "htm";
import { parse as parseYaml } from "yaml";

const html = htm.bind(React.createElement);
const { useEffect, useMemo, useState, useCallback } = React;
const elk = new ELK();
const params = new URLSearchParams(location.search);

const ELK_SIDE = { I: "WEST", C: "NORTH", O: "EAST", M: "SOUTH" };
const RF_SIDE = {
  WEST: Position.Left,
  NORTH: Position.Top,
  EAST: Position.Right,
  SOUTH: Position.Bottom,
};
const KIND_NAME = { I: "вход", C: "управление", O: "выход", M: "механизм" };
const BOX_W = 210;
const BOX_H = 112;

const asList = (end) => (Array.isArray(end) ? end : end ? [end] : []);

function wrap(text, width = 26) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Arrow kind for colouring: the ICOM role at its target (boundary outputs are O). */
function arrowKind(arrow) {
  const target = asList(arrow.to)[0] ?? {};
  if (target.boundary) return "O";
  return target.side ?? "I";
}

// ---------- ELK graph ----------

function buildElkGraph(diagram, placement) {
  const boxPorts = new Map((diagram.boxes ?? []).map((b) => [b.id, []]));
  const framePorts = new Map();
  const edges = [];
  const edgeArrow = new Map();

  const framePort = (code) => {
    const id = `frame|${code}`;
    if (!framePorts.has(code))
      framePorts.set(code, {
        id,
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": ELK_SIDE[code[0]] },
        code,
      });
    return id;
  };
  const boxPort = (box, side, arrowId) => {
    const id = `${box}|${side}|${arrowId}`;
    const ports = boxPorts.get(box);
    if (!ports) throw new Error(`arrow ${arrowId}: unknown box ${box}`);
    if (!ports.some((p) => p.id === id))
      ports.push({
        id,
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": ELK_SIDE[side] },
      });
    return id;
  };

  // C/M boundary arrows are not routed by ELK: external north/south ports of a layered
  // graph all land beside the first layer and drag long detours across the sheet. They are
  // drawn after layout as straight drops from the frame edge to the box port (IDEF0 style).
  const drops = [];
  for (const arrow of diagram.arrows ?? []) {
    const fromList = asList(arrow.from);
    if (fromList.length === 1 && /^[CM]/.test(fromList[0].boundary ?? "")) {
      for (const end of asList(arrow.to))
        drops.push({
          arrow,
          code: fromList[0].boundary,
          port: boxPort(end.box, end.side, arrow.id),
        });
      continue;
    }
    const sources = fromList.map((end) =>
      end.boundary
        ? framePort(end.boundary)
        : boxPort(end.box, end.side ?? "O", arrow.id),
    );
    const targets = asList(arrow.to).map((end) =>
      end.boundary
        ? framePort(end.boundary)
        : boxPort(end.box, end.side, arrow.id),
    );
    const lines = wrap(arrow.label ?? arrow.id);
    let k = 0;
    for (const source of sources) {
      for (const target of targets) {
        const id = `${arrow.id}#${k}`;
        const labels =
          k === 0
            ? [
                {
                  id: `${id}:label`,
                  text: lines.join("\n"),
                  width: Math.max(...lines.map((l) => l.length)) * 6.3 + 10,
                  height: lines.length * 13 + 4,
                },
              ]
            : [];
        edges.push({ id, sources: [source], targets: [target], labels });
        edgeArrow.set(id, arrow);
        k += 1;
      }
    }
  }

  const single = (diagram.boxes ?? []).length === 1;
  const children = (diagram.boxes ?? []).map((box) => ({
    id: box.id,
    width: single ? 300 : BOX_W,
    height: single ? 170 : BOX_H,
    ports: boxPorts.get(box.id),
    layoutOptions: {
      "elk.portConstraints": "FIXED_SIDE",
      "elk.spacing.portPort": "18",
    },
  }));

  const frame = {
    id: "frame",
    ports: [...framePorts.values()],
    children,
    edges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.portConstraints": "FIXED_SIDE",
      "elk.padding": "[top=150,left=60,bottom=130,right=60]",
      "elk.spacing.nodeNode": "70",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.edgeEdge": "14",
      "elk.spacing.edgeNode": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeLabel": "4",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
      "elk.layered.mergeEdges": "true",
      "elk.layered.nodePlacement.strategy": placement,
    },
  };
  return {
    graph: {
      id: "root",
      layoutOptions: { "elk.algorithm": "layered" },
      children: [frame],
      edges: [],
    },
    edgeArrow,
    drops,
  };
}

async function layoutDiagram(diagram, placement) {
  const { graph, edgeArrow, drops } = buildElkGraph(diagram, placement);
  const result = await elk.layout(graph);
  const frame = result.children[0];
  const fx = frame.x;
  const fy = frame.y;
  const boxesById = new Map((diagram.boxes ?? []).map((b) => [b.id, b]));
  // Port ids: `frame|<ICOM code>` or `<box>|<side letter>|<arrow>` — the side follows from the id.
  const portData = (p) => {
    const code = p.id.split("|")[1];
    return {
      id: p.id,
      x: p.x + (p.width ?? 0) / 2,
      y: p.y + (p.height ?? 0) / 2,
      side: ELK_SIDE[code[0]],
      code,
    };
  };

  const nodes = [
    {
      id: "frame",
      type: "frame",
      position: { x: fx, y: fy },
      data: {
        ports: (frame.ports ?? []).map(portData),
        width: frame.width,
        height: frame.height,
        title: `${diagram.id} · ${diagram.title ?? ""}`,
      },
      // Explicit width/height: React Flow then never hides a rebuilt node while it re-measures it.
      width: frame.width,
      height: frame.height,
      style: { width: frame.width, height: frame.height },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    },
    ...frame.children.map((child) => ({
      id: child.id,
      type: "box",
      position: { x: fx + child.x, y: fy + child.y },
      data: {
        box: boxesById.get(child.id),
        ports: (child.ports ?? []).map(portData),
      },
      width: child.width,
      height: child.height,
      style: { width: child.width, height: child.height },
      draggable: false,
    })),
  ];

  const edges = [];
  for (const edge of frame.edges ?? []) {
    const arrow = edgeArrow.get(edge.id);
    const points = [];
    for (const section of edge.sections ?? []) {
      points.push(
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      );
    }
    const label = edge.labels?.[0];
    // IDEF0 feedback (a box output back to its own input, e.g. A0 a04): ELK hugs the box with
    // self-loops, so the loop is drawn the IDEF0 way — out east, under the box and its mechanism
    // stubs, back in west — with its label under the loop.
    let loopLabel = null;
    const ownBox = edge.sources[0].split("|")[0];
    if (
      !edge.sources[0].startsWith("frame|") &&
      ownBox === edge.targets[0].split("|")[0] &&
      points.length
    ) {
      const child = frame.children.find((c) => c.id === ownBox);
      const start = points[0];
      const end = points[points.length - 1];
      const below = child.y + child.height + 56;
      points.splice(
        0,
        points.length,
        start,
        { x: start.x + 28, y: start.y },
        { x: start.x + 28, y: below },
        { x: end.x - 28, y: below },
        { x: end.x - 28, y: end.y },
        end,
      );
      const label = edge.labels?.[0];
      if (label)
        loopLabel = {
          text: label.text,
          x: fx + child.x,
          y: fy + below + 6,
          width: label.width,
          height: label.height,
        };
    }
    edges.push({
      id: edge.id,
      type: "idef",
      source: edge.sources[0].startsWith("frame|")
        ? "frame"
        : edge.sources[0].split("|")[0],
      sourceHandle: edge.sources[0],
      target: edge.targets[0].startsWith("frame|")
        ? "frame"
        : edge.targets[0].split("|")[0],
      targetHandle: edge.targets[0],
      data: {
        arrow,
        kind: arrowKind(arrow),
        points: points.map((p) => ({ x: fx + p.x, y: fy + p.y })),
        label:
          loopLabel ??
          (label
            ? {
                text: label.text,
                x: fx + label.x,
                y: fy + label.y,
                width: label.width,
                height: label.height,
              }
            : null),
      },
    });
  }
  // Straight C/M drops: frame edge → box port.
  const portAbs = new Map();
  for (const child of frame.children)
    for (const p of child.ports ?? [])
      portAbs.set(p.id, {
        x: fx + child.x + p.x + (p.width ?? 0) / 2,
        y: fy + child.y + p.y + (p.height ?? 0) / 2,
      });
  const framePortsExtra = [];
  const sorted = [...drops].sort(
    (a, b) => portAbs.get(a.port).x - portAbs.get(b.port).x,
  );
  // A branching boundary arrow is labelled once, at its leftmost drop; the other drops carry only
  // the ICOM code at the frame edge. Labels are packed into rows so neighbours never overlap.
  const labelled = new Set();
  const rows = { C: [], M: [] };
  const ROW_H = 44;
  for (const drop of sorted) {
    const end = portAbs.get(drop.port);
    const isC = drop.code[0] === "C";
    const edgeY = isC ? fy : fy + frame.height;
    const handleId = `frame|${drop.code}|${drop.arrow.id}|${drop.port}`;
    framePortsExtra.push({
      id: handleId,
      x: end.x - fx,
      y: edgeY - fy,
      side: isC ? "NORTH" : "SOUTH",
      code: drop.code,
    });
    let label = null;
    if (!labelled.has(drop.arrow.id)) {
      labelled.add(drop.arrow.id);
      const lines = wrap(drop.arrow.label ?? drop.arrow.id, 22);
      const width = Math.max(...lines.map((l) => l.length)) * 6.3 + 12;
      const height = lines.length * 13 + 4;
      const side = rows[drop.code[0]];
      let row = side.findIndex((right) => right < end.x);
      if (row < 0) row = side.push(0) - 1;
      side[row] = end.x + width;
      label = {
        text: lines.join("\n"),
        x: end.x + 4,
        y: isC ? edgeY + 8 + row * ROW_H : edgeY - 8 - height - row * ROW_H,
        height,
      };
    }
    edges.push({
      id: `${drop.arrow.id}#${drop.port}`,
      type: "idef",
      source: "frame",
      sourceHandle: handleId,
      target: drop.port.split("|")[0],
      targetHandle: drop.port,
      data: {
        arrow: drop.arrow,
        kind: drop.code[0],
        points: [
          { x: end.x, y: edgeY },
          { x: end.x, y: end.y },
        ],
        label,
      },
    });
  }
  nodes[0].data.ports = [...nodes[0].data.ports, ...framePortsExtra];
  return { nodes, edges };
}

// ---------- React Flow node / edge renderers ----------

function handleStyle(port) {
  return { left: port.x, top: port.y, transform: "translate(-50%, -50%)" };
}

function FrameNode({ data }) {
  return html`<div class="frame">
    ${data.ports.map((port) => {
      const isOut = port.code.startsWith("O");
      const offset = {
        WEST: { left: port.x - 26, top: port.y - 16 },
        EAST: { left: port.x + 6, top: port.y - 16 },
        NORTH: { left: port.x + 4, top: port.y - 18 },
        SOUTH: { left: port.x + 4, top: port.y + 4 },
      }[port.side];
      return html`<${React.Fragment} key=${port.id}>
        <${Handle}
          id=${port.id}
          type=${isOut ? "target" : "source"}
          position=${RF_SIDE[port.side]}
          style=${handleStyle(port)}
          isConnectable=${false}
        />
        <span class="code" style=${offset}>${port.code}</span>
      <//>`;
    })}
  </div>`;
}

function BoxNode({ data }) {
  // Focus is drawn from data, not React Flow selection: selecting re-sorts nodes by z-index and
  // re-inserts the DOM node mid-click, which swallows the double-click that opens a child diagram.
  const { box, ports, hasChild, onOpen, focused: selected } = data;
  const mechanisms = box.mechanisms ?? [];
  return html`<div
    class=${"box" + (selected ? " selected" : "")}
    title=${box.note ?? ""}
    onDoubleClick=${onOpen ?? undefined}
  >
    ${ports.map((port) => {
      const side = port.id.split("|")[1];
      return html`<${Handle}
        key=${port.id}
        id=${port.id}
        type=${side === "O" ? "source" : "target"}
        position=${RF_SIDE[port.side]}
        style=${handleStyle(port)}
        isConnectable=${false}
      />`;
    })}
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
      style=${{ stroke: color, strokeWidth: 1.6 }}
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
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [hover, setHover] = useState(null);
  const diagram = byId.get(current);
  // BRANDES_KOEPF gave the fewest bends on A0; ?placement=NETWORK_SIMPLEX | LINEAR_SEGMENTS compares.
  const placement = params.get("placement") ?? "BRANDES_KOEPF";

  useEffect(() => {
    const onHash = () =>
      byId.has(readHash(index.root)) && setCurrent(readHash(index.root));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [byId, index.root]);
  useEffect(() => {
    let alive = true;
    setLayout(null);
    setLayoutError(null);
    layoutDiagram(diagram, placement)
      .then((result) => alive && setLayout(result))
      .catch(
        (error) => alive && setLayoutError(String(error?.message ?? error)),
      );
    return () => {
      alive = false;
    };
  }, [diagram, placement]);

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
            : layout
              ? html`<${ReactFlow}
                  key=${current}
                  nodes=${nodes}
                  edges=${edges}
                  nodeTypes=${nodeTypes}
                  edgeTypes=${edgeTypes}
                  fitView
                  fitViewOptions=${{ padding: 0.06 }}
                  minZoom=${0.1}
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
              : html`<p style=${{ padding: 16 }}>Раскладка…</p>`
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
  const index = parseYaml(
    await (await fetch(new URL("index.yaml", base))).text(),
  );
  const diagrams = [];
  for (const entry of index.diagrams) {
    const response = await fetch(new URL(entry.file, base));
    if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
    diagrams.push({
      ...parseYaml(await response.text()),
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
