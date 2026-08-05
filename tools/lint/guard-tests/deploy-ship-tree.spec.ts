import { describe, expect, it } from "vitest";

import { shipTreeCommand } from "../../deploy/prod.mjs";

describe("prod deploy tree shipping (#1182)", () => {
  it("stages a clean tree, carries forward only api-prod compose .env, then swaps", () => {
    const command = shipTreeCommand();
    const extractAt = command.indexOf(
      'tar xzf - --strip-components=1 -C "$stage"',
    );
    const preserveAt = command.indexOf(
      'cp -p "$live/$preserved_rel" "$stage/$preserved_rel"',
    );
    const markSwapAt = command.indexOf("swapping=1");
    const moveLiveAsideAt = command.indexOf('mv "$live" "$previous"');
    const swapAt = command.indexOf('mv "$stage" "$live"');
    const clearSwapAt = command.indexOf("swapping=0", markSwapAt);

    expect(command).toContain(
      'work=$(mktemp -d "$HOME/ds-platform.ship.XXXXXX")',
    );
    expect(command).toContain('stage="$work/stage"');
    expect(command).toContain('previous="$work/previous"');
    expect(command).toContain(
      'preserved_rel="infra/deploy/compose/api-prod/.env"',
    );
    expect(command).toContain(
      '[ "$swapping" -eq 1 ] && [ ! -e "$live" ] && [ -e "$previous" ]',
    );
    expect(command).toContain('mv "$previous" "$live" || true');
    expect(extractAt).toBeGreaterThan(-1);
    expect(preserveAt).toBeGreaterThan(extractAt);
    expect(markSwapAt).toBeGreaterThan(preserveAt);
    expect(moveLiveAsideAt).toBeGreaterThan(markSwapAt);
    expect(swapAt).toBeGreaterThan(moveLiveAsideAt);
    expect(clearSwapAt).toBeGreaterThan(swapAt);
    expect(command.match(/cp -p/g)).toHaveLength(1);
    expect(command.match(/rm -rf "\$work"/g)).toHaveLength(2);
    expect(command).not.toContain("$$");
    expect(command).not.toContain('rm -rf "$live"');
  });
});
