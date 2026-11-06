import { expect } from "@playwright/test";
import ts from "typescript";

export function assertBookFieldProvenance(path: string, source: string) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const forbidden =
    /\b(slug|weight|address)\b|адрес страницы|производн.{0,15}адрес|^вес$/i;
  const rendered: string[] = [];
  const printer = ts.createPrinter({removeComments:true});
  const text = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified,node,file);
  function inspect(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      ["href", "id", "key", "data-testid"].includes(node.name.getText(file))
    )
      return;
    if (ts.isJsxText(node)) rendered.push(node.text.trim());
    if (ts.isJsxExpression(node) && node.expression)
      rendered.push(text(node.expression));
    if (
      ts.isJsxAttribute(node) &&
      !["href", "id", "key", "data-testid"].includes(node.name.getText(file))
    )
      rendered.push(node.initializer ? text(node.initializer) : "");
    if (
      ts.isPropertyAssignment(node) &&
      ["header", "label"].includes(node.name.getText(file))
    )
      rendered.push(text(node.initializer));
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  expect(
    rendered.filter((text) => forbidden.test(text)),
    `${path}: rendered field/column/note`,
  ).toEqual([]);
  if (path.endsWith("/page.tsx") && !path.includes("/create/")) {
    const imports = file.statements
      .filter(ts.isImportDeclaration)
      .filter(
        (node) =>
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === "@/components/status-chip",
      );
    expect(imports).toHaveLength(1);
    const bindings = imports[0]!.importClause?.namedBindings;
    expect(
      bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          (item) =>
            !item.isTypeOnly &&
            (item.propertyName ?? item.name).text === "StatusChip",
        ),
    ).toBe(true);
    const uses: string[] = [];
    function jsx(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
        uses.push(node.tagName.getText(file));
      ts.forEachChild(node, jsx);
    }
    jsx(file);
    expect(uses).toContain("StatusChip");
  }
}
