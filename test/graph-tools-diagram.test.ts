import { expect, test } from "bun:test";
import { renderMermaid } from "../src/lib/graph-tools/index.ts";
import { object, ref, relation } from "./graph-tools-fixture.ts";

test("Mermaid is byte-stable and escapes hostile text, unicode, ids and titles", () => {
  const objects = [
    object("b", {
      header: { title: 'Quote " ` 雪 <script>\nflowchart LR' },
      references: [relation("a")],
    }),
    object("a"),
  ];
  const text = renderMermaid(objects, { title: 'Title "\n```' });
  expect(renderMermaid([...objects].reverse(), { title: 'Title "\n```' })).toBe(text);
  expect(renderMermaid(objects, { title: 'Title "\n```' })).toBe(text);
  expect(text).toContain("[#quot;feature#quot;,#quot;a#quot;]");
  expect(text).toContain("Quote #quot; #96; 雪 #60;script#62;#10;flowchart LR");
  expect(text).not.toContain("<script>");
  expect(text).not.toContain("```");
});

test("diagram intersects type/kind filters and weak root component, omitting dangling edges", () => {
  const objects = [
    object("a"),
    object("b", { references: [relation("a")] }),
    object("c", { type: "test", references: [relation("b", "uses")] }),
    object("z"),
    object("dangling", { references: [relation("missing")] }),
  ];
  const scoped = renderMermaid(objects, { ref: ref("a"), kinds: ["depends"], types: ["feature"] });
  expect(scoped).toContain("dependencies: depends");
  expect(scoped).not.toContain("uses");
  expect(scoped).not.toContain("z#quot;");
  expect(scoped).not.toContain("missing");
  expect(renderMermaid(objects, { ref: ref("missing") })).toBe("flowchart TD\n");
  expect(renderMermaid(objects, { types: [] })).toBe("flowchart TD\n");
  expect(() => renderMermaid([object("a"), object("a")])).toThrow(TypeError);
});

test("diagram uses injective syntax-safe identifiers and quoted escaped reference labels", () => {
  const objects = [object('a" --> evil', { header: { name: "雪 `name`" } }), object("a_22")];
  const text = renderMermaid(objects);
  expect(text).toContain("雪 #96;name#96;");
  expect(text).not.toContain('a" --> evil');
  const nodeLines = text.split("\n").filter((line) => line.includes('["'));
  expect(nodeLines).toHaveLength(2);
  for (const line of nodeLines) expect(line).toMatch(/^ {2}n[0-9a-f]+\[".*"\]$/);
  expect(nodeLines[0]?.split("[")[0]).not.toBe(nodeLines[1]?.split("[")[0]);
});
