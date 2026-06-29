"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { TokenEntry, TokenGroup } from "../lib/token-groups";

/**
 * Client renderer for the Tokens section (spec §3.1). It reads every token's
 * VALUE from the compiled CSS custom properties at mount
 * (`getComputedStyle(:root)`), so the displayed value is exactly what the token
 * build emitted — never a literal typed here. Breakpoints carry a `staticValue`
 * (they are not `:root` vars; see `token-groups.ts`) and skip the lookup.
 *
 * The visual specimens use `var(<token>)` directly, so they paint the real token
 * even before the value-read effect runs (and the no-token-redefinition lint only
 * forbids *defining* a token var, not reading one).
 */
export function TokensView({ groups }: { groups: TokenGroup[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [darkValues, setDarkValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const group of groups) {
      for (const token of group.tokens) {
        next[token.name] =
          token.staticValue ?? cs.getPropertyValue(token.name).trim();
      }
    }
    setValues(next);

    // Semantic colours diverge by theme — read their `.dark` values from an
    // offscreen probe carrying the `.dark` class (the same cascade the app uses),
    // so the catalogue can show light + dark side by side. Still read from the
    // compiled CSS, never hardcoded.
    const darkNames = groups
      .filter((g) => g.showDark)
      .flatMap((g) => g.tokens.map((t) => t.name));
    if (darkNames.length > 0) {
      const probe = document.createElement("div");
      probe.className = "dark";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      document.body.appendChild(probe);
      const dcs = getComputedStyle(probe);
      const dark: Record<string, string> = {};
      for (const name of darkNames) dark[name] = dcs.getPropertyValue(name).trim();
      document.body.removeChild(probe);
      setDarkValues(dark);
    }
  }, [groups]);

  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {group.title}
            </h2>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>
          {group.kind === "textRole" ? (
            <TextRoleGrid tokens={group.tokens} values={values} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.tokens.map((token) =>
                group.showDark ? (
                  <SemanticColorRow
                    key={token.name}
                    token={token}
                    light={values[token.name]}
                    dark={darkValues[token.name]}
                  />
                ) : (
                  <li
                    key={token.name}
                    className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
                  >
                    <Specimen kind={group.kind} token={token} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {token.label}
                      </span>
                      <code className="truncate font-mono text-xs text-muted-foreground">
                        {token.name}
                      </code>
                      <code className="truncate font-mono text-xs text-muted-foreground">
                        {values[token.name] || "…"}
                      </code>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** Fixed-size frame so every specimen lines up regardless of its content. */
function SpecimenFrame({
  children,
  style,
  className = "",
}: {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

function Specimen({ kind, token }: { kind: string; token: TokenEntry }) {
  const v = (prop: string): CSSProperties =>
    ({ [prop]: `var(${token.name})` }) as CSSProperties;

  switch (kind) {
    case "color":
      return (
        <SpecimenFrame className="border border-border" style={v("background")} />
      );
    case "opacity":
      return (
        <SpecimenFrame className="border border-border">
          <div
            className="h-full w-full bg-primary"
            style={v("opacity")}
          />
        </SpecimenFrame>
      );
    case "fontFamily":
      return (
        <SpecimenFrame className="border border-border text-lg text-foreground">
          <span style={v("fontFamily")}>Ag</span>
        </SpecimenFrame>
      );
    case "fontSize":
      return (
        <SpecimenFrame className="border border-border text-foreground">
          <span style={v("fontSize")}>Aa</span>
        </SpecimenFrame>
      );
    case "fontWeight":
      return (
        <SpecimenFrame className="border border-border text-base text-foreground">
          <span style={v("fontWeight")}>Aa</span>
        </SpecimenFrame>
      );
    case "lineHeight":
      return (
        <SpecimenFrame className="border border-border text-foreground">
          <span className="text-xs leading-none" style={v("lineHeight")}>
            ab
            <br />
            cd
          </span>
        </SpecimenFrame>
      );
    case "letterSpacing":
      return (
        <SpecimenFrame className="border border-border text-xs text-foreground">
          <span style={v("letterSpacing")}>AV</span>
        </SpecimenFrame>
      );
    case "space":
      return (
        <SpecimenFrame className="border border-border bg-muted">
          <div className="h-2 bg-primary" style={v("width")} />
        </SpecimenFrame>
      );
    case "radius":
      return (
        <SpecimenFrame
          className="border-2 border-primary bg-muted"
          style={v("borderRadius")}
        />
      );
    case "size":
      return (
        <SpecimenFrame className="border border-border bg-muted">
          <div
            className="border border-primary bg-primary/20"
            style={
              {
                width: `var(${token.name})`,
                height: `var(${token.name})`,
                maxWidth: "100%",
                maxHeight: "100%",
              } as CSSProperties
            }
          />
        </SpecimenFrame>
      );
    case "border":
      return (
        <SpecimenFrame className="bg-muted">
          <div
            className="h-8 w-8 rounded-sm border-solid border-primary bg-card"
            style={v("borderWidth")}
          />
        </SpecimenFrame>
      );
    case "shadow":
      return (
        <SpecimenFrame>
          <div
            className="h-8 w-8 rounded-md bg-card"
            style={v("boxShadow")}
          />
        </SpecimenFrame>
      );
    case "duration":
      return (
        <SpecimenFrame className="group border border-border bg-muted">
          <div className="relative h-1 w-9 rounded-full bg-border">
            <span
              className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary transition-transform group-hover:translate-x-6"
              style={
                {
                  transitionDuration: `var(${token.name})`,
                  transitionTimingFunction: "var(--motion-easing-standard)",
                } as CSSProperties
              }
            />
          </div>
        </SpecimenFrame>
      );
    case "easing":
      return (
        <SpecimenFrame className="group border border-border bg-muted">
          <div className="relative h-1 w-9 rounded-full bg-border">
            <span
              className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary transition-transform duration-700 group-hover:translate-x-6"
              style={v("transitionTimingFunction")}
            />
          </div>
        </SpecimenFrame>
      );
    case "zIndex":
      return (
        <SpecimenFrame className="border border-border bg-muted font-mono text-xs text-muted-foreground">
          z
        </SpecimenFrame>
      );
    case "breakpoint":
      return (
        <SpecimenFrame className="border border-border bg-muted font-mono text-xs text-muted-foreground">
          ↔
        </SpecimenFrame>
      );
    default:
      return <SpecimenFrame className="border border-border bg-muted" />;
  }
}

/**
 * A semantic colour row — a split swatch (light | dark) plus both resolved
 * values. The dark half is the SAME `var(<token>)` rendered inside a `.dark`
 * context, so it resolves through the real theme cascade (no literal colour).
 * This makes the primitive→semantic layering legible: a role that looks like a
 * duplicate of a palette swatch in light mode reveals its distinct purpose when
 * the dark value diverges.
 */
function SemanticColorRow({
  token,
  light,
  dark,
}: {
  token: TokenEntry;
  light?: string;
  dark?: string;
}) {
  const diverges = !!light && !!dark && light !== dark;
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-card p-3">
      <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
        <div className="h-12 w-6" style={{ background: `var(${token.name})` }} />
        <div className="dark">
          <div
            className="h-12 w-6"
            style={{ background: `var(${token.name})` }}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {token.label}
          {diverges ? (
            <span className="ml-2 font-normal text-muted-foreground">
              · diverges in dark
            </span>
          ) : null}
        </span>
        <code className="truncate font-mono text-xs text-muted-foreground">
          {token.name}
        </code>
        <code className="truncate font-mono text-xs text-muted-foreground">
          light {light || "…"}
        </code>
        <code className="truncate font-mono text-xs text-muted-foreground">
          dark {dark || "…"}
        </code>
      </div>
    </li>
  );
}

/**
 * Composite text-role specimens (body / heading / label). Each role is a real
 * paragraph styled with its three role tokens (size + leading + weight), so the
 * sample reads at the actual role proportions.
 */
function TextRoleGrid({
  tokens,
  values,
}: {
  tokens: TokenEntry[];
  values: Record<string, string>;
}) {
  const roles = Array.from(
    new Set(tokens.map((t) => t.label.split("-")[0]!)),
  );
  return (
    <ul className="flex flex-col gap-3">
      {roles.map((role) => {
        const size = `--text-${role}-font-size`;
        const leading = `--text-${role}-line-height`;
        const weight = `--text-${role}-font-weight`;
        return (
          <li
            key={role}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4"
          >
            <span
              className="text-foreground"
              style={
                {
                  fontSize: `var(${size})`,
                  lineHeight: `var(${leading})`,
                  fontWeight: `var(${weight})`,
                } as CSSProperties
              }
            >
              {role.charAt(0).toUpperCase() + role.slice(1)} — the quick brown fox
            </span>
            <code className="font-mono text-xs text-muted-foreground">
              {role}: {values[size] || "…"} / {values[leading] || "…"} /{" "}
              {values[weight] || "…"}
            </code>
          </li>
        );
      })}
    </ul>
  );
}
