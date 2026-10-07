import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AuthLayout from "./layout";

describe("#2664: the (auth) group shell owns the page's one main landmark", () => {
  it("#2664: the auth route renders inside exactly one main the group layout opens", () => {
    const html = renderToStaticMarkup(
      <AuthLayout>
        <p data-testid="auth-page">door</p>
      </AuthLayout>,
    );
    expect(html).toBe('<main><p data-testid="auth-page">door</p></main>');
  });
});
