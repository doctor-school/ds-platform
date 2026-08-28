import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

async function background(locator: Locator): Promise<string> {
  return locator.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const isDark = await page
    .locator("html")
    .evaluate((element) => element.classList.contains("dark"));
  if ((theme === "dark") !== isDark) {
    await page
      .getByRole("button", {
        name:
          theme === "dark" ? "Switch to dark theme" : "Switch to light theme",
      })
      .click();
  }
  await expect(page.locator("html")).toHaveClass(
    theme === "dark" ? /dark/ : /^(?!.*dark)/,
  );
}

async function resolvedTokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test.describe("#1578 adopted clickable DataTable row press state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/candidates");
    await expect(page.getByTestId("row-press-stage-a-group")).toBeVisible();
  });

  test("packages the recorded opt1 as adopted and removes stale choices", async ({
    page,
  }) => {
    const group = page.getByTestId("row-press-stage-a-group");
    await expect(group.getByText("Adopted", { exact: true })).toHaveCount(1);
    await expect(group.getByText(/^Candidate/)).toHaveCount(0);
    await expect(group.locator('[data-option-id="opt1"]')).toHaveCount(1);
    await expect(group.locator('[data-option-id="opt2"]')).toHaveCount(0);
    await expect(group.locator('[data-option-id="opt3"]')).toHaveCount(0);
    await expect(group.locator('[data-decision="adopted"]')).toBeVisible();
  });

  test("shows desktop and mobile rest, hover, and pressed specimens", async ({
    page,
  }) => {
    const adopted = page.locator('[data-option-id="opt1"]');
    for (const surface of ["desktop", "mobile"]) {
      for (const state of ["rest", "hover", "pressed"]) {
        await expect(
          adopted.locator(
            `[data-row-press-surface="${surface}"][data-row-press-state="${state}"]`,
          ),
        ).toBeVisible();
      }
    }

    const desktopHeights: number[] = [];
    for (const state of ["rest", "hover", "pressed"] as const) {
      const specimen = adopted.locator(
        `[data-row-press-surface="desktop"][data-row-press-state="${state}"]`,
      );
      const table = specimen.getByRole("table");
      await expect(table.getByRole("columnheader")).toHaveCount(3);
      await expect(
        table.getByText("Кардиология", { exact: true }),
      ).toBeVisible();
      await expect(
        table.getByText("Терапевтические направления", { exact: true }),
      ).toBeVisible();
      const box = await table.boundingBox();
      expect(box).not.toBeNull();
      desktopHeights.push(box?.height ?? 0);
    }
    expect(new Set(desktopHeights).size).toBe(1);
  });

  test("uses the owner-picked semantic backgrounds in both themes", async ({
    page,
  }) => {
    const expected = {
      light: { hover: "rgb(211, 232, 253)", pressed: "rgb(174, 212, 251)" },
      dark: { hover: "rgb(13, 58, 119)", pressed: "rgb(17, 77, 158)" },
    } as const;

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      const adopted = page.locator('[data-option-id="opt1"]');
      const hover = adopted.locator(
        '[data-row-press-surface="desktop"][data-row-press-state="hover"] tr[data-clickable="true"]',
      );
      const pressed = adopted.locator(
        '[data-row-press-surface="desktop"][data-row-press-state="pressed"] tr[data-clickable="true"]',
      );

      await expect.poll(() => background(hover)).toBe(expected[theme].hover);
      await expect
        .poll(() => background(pressed))
        .toBe(expected[theme].pressed);
      await expect(pressed).toHaveCSS("box-shadow", "none");
      if (theme === "dark") {
        const foreground = await resolvedTokenColor(page, "--color-foreground");
        await expect
          .poll(() =>
            pressed
              .locator(".text-muted-foreground")
              .evaluate((element) => getComputedStyle(element).color),
          )
          .toBe(foreground);
      }
    }
  });

  test("the real row and card react while their activation target is :active", async ({
    page,
  }) => {
    const pressed = {
      light: "rgb(174, 212, 251)",
      dark: "rgb(17, 77, 158)",
    } as const;

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      for (const surface of ["desktop", "mobile"] as const) {
        const specimen = page.locator(`[data-row-press-live="${surface}"]`);
        const clickable = specimen.locator(
          surface === "desktop"
            ? 'tr[data-clickable="true"]'
            : 'div[data-clickable="true"]',
        );
        const activation = clickable.getByRole("link");

        await activation.hover();
        await page.mouse.down();
        await expect.poll(() => background(clickable)).toBe(pressed[theme]);
        if (theme === "dark") {
          const foreground = await resolvedTokenColor(
            page,
            "--color-foreground",
          );
          await expect
            .poll(() =>
              clickable
                .locator("span.mt-1.text-muted-foreground")
                .evaluate((element) => getComputedStyle(element).color),
            )
            .toBe(foreground);
        }
        await page.mouse.up();
      }
    }
  });

  test("captures the adopted desktop/mobile state matrix in both themes", async ({
    page,
  }) => {
    const artifactDir = process.env.STAGEA_CAPTURE_DIR;
    test.skip(
      !artifactDir,
      "Set STAGEA_CAPTURE_DIR for an explicit artifact run",
    );

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      for (const surface of ["desktop", "mobile"] as const) {
        await page.setViewportSize(
          surface === "desktop"
            ? { width: 1440, height: 1000 }
            : { width: 390, height: 844 },
        );
        const artifact = page.locator(
          `[data-row-press-artifact="adopted-${surface}"]`,
        );
        await artifact.scrollIntoViewIfNeeded();
        await artifact.screenshot({
          path: path.join(artifactDir!, `adopted-${surface}-${theme}.png`),
        });
      }
    }
  });
});
