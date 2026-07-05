import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

afterEach(cleanup);

/**
 * Neo-brutalist segment-control contract (#512): the tab list is a single hard
 * 2px-bordered track and each trigger is a flush segment (square, bold, divided
 * by a 2px rule); the ACTIVE segment fills with the primary action colour (a
 * solid ink-framed segment), not the pre-511 floating rounded chip.
 */
describe("Tabs segment-control contract", () => {
  it("list is a hard-bordered square track", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList data-testid="list">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel</TabsContent>
      </Tabs>,
    );
    const list = screen.getByTestId("list");
    expect(list).toHaveClass("rounded-none", "border-2", "border-border");
  });

  it("active trigger fills with the primary action colour; inactive is quiet + hoverable", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" data-testid="active">
            A
          </TabsTrigger>
          <TabsTrigger value="b" data-testid="inactive">
            B
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel</TabsContent>
      </Tabs>,
    );
    const active = screen.getByTestId("active");
    expect(active).toHaveClass("rounded-none", "font-bold");
    expect(active).toHaveClass("data-[state=active]:bg-primary-action");
    expect(active).toHaveClass("data-[state=active]:text-primary-foreground");
    expect(active).toHaveClass("data-[state=inactive]:text-muted-foreground");
    expect(active).toHaveClass("data-[state=inactive]:hover:bg-accent");
  });
});
