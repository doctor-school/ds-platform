import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 048 EARS-12 (#3514) — the Academy reading page `/materials/{slug}`. The page
 * reads `GET /v1/public/materials/{slug}` (#3513) and renders the shared
 * `MaterialArticle`; a `404` read aborts with `notFound()` (the Academy
 * not-found page — the real status is pinned in the Playwright tier); any other
 * failure throws into the segment's `error.tsx`, the error state with
 * «Повторить».
 */

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  useRouter: () => ({ refresh }),
}));

const { default: MaterialPage, generateMetadata } = await import("./page");
const { default: MaterialError } = await import("./error");
const { default: MaterialLoading } = await import("./loading");

const material = {
  slug: "ortobiologiya-v-rossii",
  kind: "column",
  title: "Ортобиология в России: чего не хватает практике",
  publishedAt: "2026-08-19T09:00:00.000Z",
  cover: null,
  author: { name: "Страхов Михаил Андреевич" },
  partner: { name: "Партнёр А" },
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "PubMed",
            marks: [
              {
                type: "link",
                attrs: { href: "https://pubmed.ncbi.nlm.nih.gov/" },
              },
            ],
          },
        ],
      },
    ],
  },
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("048 Academy reading page", () => {
  it("EARS-12: renders the public material read through MaterialArticle with the partner mark and a way back", async () => {
    fetchMock.mockResolvedValue(answer(200, material));
    render(await MaterialPage(params("ortobiologiya-v-rossii")));

    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /\/v1\/public\/materials\/ortobiologiya-v-rossii$/,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      material.title,
    );
    expect(screen.getByText("Колонка эксперта")).toBeInTheDocument();
    expect(screen.getByTestId("material-byline")).toHaveTextContent(
      "Страхов Михаил Андреевич · 19 августа",
    );
    expect(screen.getByTestId("material-partner-mark")).toHaveTextContent(
      "Партнёрский материал · Партнёр А",
    );
    const external = screen.getByRole("link", { name: "PubMed" });
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("link", { name: "← Новости, блог и видео" }),
    ).toHaveAttribute("href", "/#feed-h");
  });

  it("EARS-12: the material's title is the document title", async () => {
    fetchMock.mockResolvedValue(answer(200, material));
    const metadata = await generateMetadata(params("ortobiologiya-v-rossii"));
    expect(metadata.title).toBe(material.title);
  });

  it("EARS-12: a draft, unknown or non-public material (the read's 404) is the Academy not-found page", async () => {
    fetchMock.mockResolvedValue(answer(404, { status: 404 }));
    await expect(MaterialPage(params("chernovik-novosti"))).rejects.toThrow(
      NOT_FOUND,
    );
  });

  it("EARS-12: a failed read throws into the error state instead of rendering a page", async () => {
    fetchMock.mockResolvedValue(answer(503, { status: 503 }));
    await expect(MaterialPage(params("otkryt-nabor-centrov"))).rejects.toThrow(
      /material read failed/,
    );
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      MaterialPage(params("otkryt-nabor-centrov")),
    ).rejects.toThrow();
  });

  it("EARS-12: the error state offers «Повторить», which re-runs the read", () => {
    const reset = vi.fn();
    render(<MaterialError error={new Error("x")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось загрузить материал.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("EARS-12: the loading state is the canvas skeleton", () => {
    render(<MaterialLoading />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
