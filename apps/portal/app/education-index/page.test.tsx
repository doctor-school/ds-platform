import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EducationIndexPage from "./page";

describe("/education-index partner entry", () => {
  it("029 EARS-8: «Стать партнёром — как это работает» leads to /investors, like every partner entry of the Academy home", () => {
    render(<EducationIndexPage />);

    expect(
      screen
        .getByRole("link", { name: "Стать партнёром — как это работает" })
        .getAttribute("href"),
    ).toBe("/investors");
  });
});
