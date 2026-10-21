import { describe, expect, it } from "vitest";

import { dynamic, GET } from "./route";

describe("the image health probe", () => {
  it("answers 200 with no body state, no cookie and no caching", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(dynamic).toBe("force-dynamic");
  });
});
