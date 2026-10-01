import assert from "node:assert/strict";
import test from "node:test";

import { GALLERY_CLASS, applyRegionGalleries } from "../src/view/gallery.js";

function classes(initial = "") {
  const set = new Set(initial.split(/\s+/).filter(Boolean));
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
  };
}

function make({ id = "", className = "", children = [] } = {}) {
  const el = { id, children, classList: classes(className), parent: null };
  for (const child of children) child.parent = el;
  el.closest = (sel) => {
    let n = el;
    while (n) {
      if (sel === ".rm-block" && n.classList.contains("rm-block")) return n;
      n = n.parent;
    }
    return null;
  };
  el.contains = (node) => {
    const walk = (n) => n.children.some((child) => child === node || walk(child));
    return walk(el);
  };
  el.querySelector = (sel) => {
    const all = el.querySelectorAll(sel);
    return all[0] ?? null;
  };
  el.querySelectorAll = (sel) => {
    const out = [];
    const walk = (n) => {
      for (const child of n.children) {
        if (sel === ".rm-block-children" && child.classList.contains("rm-block-children")) out.push(child);
        if (sel === '[id^="block-input-"]' && child.id.startsWith("block-input-")) out.push(child);
        walk(child);
      }
    };
    walk(el);
    return out;
  };
  return el;
}

function block(uid, { gallery = false } = {}) {
  const input = make({ id: `block-input-${uid}` });
  const children = make({ className: gallery ? `rm-block-children ${GALLERY_CLASS}` : "rm-block-children" });
  const root = make({ className: "rm-block", children: [input, children] });
  return { root, children };
}

test("applyRegionGalleries marks a known container and clears the class when the list is empty", () => {
  const known = block("known0001");
  const other = block("other0001");
  const nodes = [known.root, other.root];
  let selects = 0;
  const doc = {
    querySelector(sel) {
      selects += 1;
      const uid = /\[id\$="-([^"]+)"\]/.exec(sel)?.[1];
      const walk = (n) => {
        if (n.id?.startsWith?.("block-input-") && n.id.endsWith(`-${uid}`)) return n;
        for (const child of n.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      for (const n of nodes) {
        const found = walk(n);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll() {
      const out = [];
      const walk = (n) => {
        if (n.classList?.contains("rm-block-children") && n.classList.contains(GALLERY_CLASS)) out.push(n);
        for (const child of n.children || []) walk(child);
      };
      for (const n of nodes) walk(n);
      return out;
    },
  };
  applyRegionGalleries(doc, ["known0001"]);
  assert.equal(known.children.classList.contains(GALLERY_CLASS), true);
  assert.equal(other.children.classList.contains(GALLERY_CLASS), false);
  const before = selects;
  applyRegionGalleries(doc, []);
  assert.equal(selects, before);
  assert.equal(known.children.classList.contains(GALLERY_CLASS), false);
  assert.doesNotThrow(() => applyRegionGalleries({}, ["known0001"]));
});

test("a nested block input inside the children list does not clear the gallery class", () => {
  const nested = make({ id: "block-input-child0001" });
  const children = make({ className: "rm-block-children", children: [nested] });
  const input = make({ id: "block-input-known0001" });
  const root = make({ className: "rm-block", children: [children, input] });
  const doc = {
    querySelector(sel) {
      const uid = /\[id\$="-([^"]+)"\]/.exec(sel)?.[1];
      const walk = (n) => {
        if (n.id?.endsWith?.(`-${uid}`)) return n;
        for (const child of n.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(root);
    },
    querySelectorAll() {
      return children.classList.contains(GALLERY_CLASS) ? [children] : [];
    },
  };
  applyRegionGalleries(doc, ["known0001"]);
  assert.equal(children.classList.contains(GALLERY_CLASS), true);
});