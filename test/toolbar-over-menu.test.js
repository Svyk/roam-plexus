import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("editor toolbar yields to an open Excalidraw context menu", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const match = css.match(/body\.plexus-excal-popover \.plexus-portal\.plexus-toolbar\s*\{([^}]*)\}/);
  assert.ok(match, "missing rule that hides .plexus-toolbar while an Excalidraw popover is open");
  assert.match(match[1], /visibility:\s*hidden/);
  assert.match(match[1], /pointer-events:\s*none/);
  assert.doesNotMatch(css, /body:has\(/);
});

test("a tall Excalidraw context menu scrolls inside the viewport", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const match = css.match(/\.excalidraw \.popover:has\(> ul\.context-menu\)\s*\{([^}]*)\}/);
  assert.ok(match, "missing scroll rule for the canvas context menu");
  assert.match(match[1], /max-height:\s*calc\(100vh - 16px\)/);
  assert.match(match[1], /overflow-y:\s*auto/);
});
