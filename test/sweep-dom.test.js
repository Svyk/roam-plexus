import assert from "node:assert/strict";
import test from "node:test";
import { sweepExtensionDom } from "../src/lifecycle.js";

function makeDoc() {
  const all = [];
  const make = (className, parent) => {
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    const node = {
      className,
      children: [],
      removed: false,
      classList: {
        contains: (name) => classes.has(name),
        remove(...names) {
          for (const name of names) classes.delete(name);
          node.className = [...classes].join(" ");
        },
      },
      remove() {
        node.removed = true;
        if (parent) parent.children = parent.children.filter((child) => child !== node);
      },
      querySelectorAll(selector) {
        const wants = selector.split(",").map((part) => part.trim().split(".").filter(Boolean));
        const out = [];
        const walk = (n) => {
          if (wants.some((need) => need.length && need.every((name) => n.classList.contains(name)))) out.push(n);
          for (const child of [...n.children]) walk(child);
        };
        for (const child of [...node.children]) walk(child);
        return out;
      },
    };
    all.push(node);
    if (parent) parent.children.push(node);
    return node;
  };
  const body = make("");
  return { doc: { body }, make: (className) => make(className, body), all };
}

test("unload sweep removes portals and restores a region ref button", () => {
  const { doc, make } = makeDoc();
  make("plexus-portal plexus-toolbar");
  make("plexus-portal plexus-backlinks");
  make("plexus-root plexus-regionref");
  make("plexus-offscreen");
  const ref = make("rm-block-ref plexus-ref-card plexus-mode-image plexus-hidden");
  doc.body.classList = doc.body.classList;
  doc.body.className = "plexus-dock-open plexus-excal-popover";
  doc.body.classList.remove = (...names) => {
    const classes = new Set(doc.body.className.split(/\s+/).filter(Boolean));
    for (const name of names) classes.delete(name);
    doc.body.className = [...classes].join(" ");
  };
  sweepExtensionDom(doc);
  assert.equal(doc.body.querySelectorAll(".plexus-portal, .plexus-root, .plexus-offscreen").length, 0);
  assert.equal(ref.removed, false);
  assert.equal(ref.classList.contains("rm-block-ref"), true);
  assert.equal(ref.classList.contains("plexus-mode-image"), false);
  assert.equal(ref.classList.contains("plexus-hidden"), false);
  assert.equal(doc.body.className, "");
});
