"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * `<QrCode>` — the scannable half of the 011 enrollment offer (EARS-5, EARS-12).
 *
 * **Adopted, not bespoke** (`build-ui-from-design-system` gate): the renderer is
 * the Kibo UI `qr-code` component's approach — encode with `uqr`, paint the
 * modules as SVG rects on a `viewBox` sized to the matrix, no canvas and no
 * runtime image — kept because it is dependency-light, MIT, and renders crisply
 * at any size without rasterizing. `@ds/design-system` owns no QR primitive and
 * none of the approved registries offers one that is not a wrapper over the same
 * encoder.
 *
 * Kibo UI's MIT licence, reproduced verbatim from upstream `license.md`
 * (https://github.com/shadcnblocks/kibo):
 *
 * ```
 * Copyright (c) 2023 — Present shadcnblocks
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ```
 *
 * **The a11y wrapper is ours, and it is not optional.** A QR is a picture of a
 * string: a screen-reader user cannot scan it, and neither can an operator whose
 * authenticator app has no camera. So the `<svg>` carries `role="img"` plus a
 * caller-supplied RU `aria-label`, and the enrollment screen renders the same
 * secret as selectable text beside it (EARS-12 — never image-only). The colors
 * are ADR-0013 tokens (`currentColor` over a token background), so the code keeps
 * its contrast in either theme rather than baking in black-on-white.
 */
export function QrCode({
  value,
  label,
  className,
  "data-testid": testId,
}: {
  /** The payload to encode — here the `otpauth://totp/…` provisioning URI. */
  value: string;
  /** Text alternative (RU, from the message catalog). Required — see the docblock. */
  label: string;
  className?: string;
  "data-testid"?: string;
}) {
  // The matrix is pure a function of the payload; re-encoding on every render of
  // a screen that also re-renders per keystroke would be wasted work.
  const matrix = useMemo(() => encode(value), [value]);

  // One quiet-zone module on each side — below ~4 modules some scanners refuse to
  // lock on, and the surrounding card already supplies visual padding.
  const quiet = 4;
  const span = matrix.size + quiet * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      className={className}
      data-testid={testId}
    >
      {/* The light modules are the background, painted once rather than as
          thousands of rects. */}
      <rect width={span} height={span} className="fill-card" />
      {matrix.data.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${x}-${y}`}
              x={x + quiet}
              y={y + quiet}
              width={1}
              height={1}
              className="fill-foreground"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
