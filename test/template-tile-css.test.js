import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const BENCHMARK = [0, 1, 1];

test("template tile color beats .bp3-dark button", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const matches = [];
  for (const rule of parseRules(stripComments(css))) {
    if (!declaresColor(rule.body)) continue;
    for (const selector of splitSelectors(rule.selector)) {
      if (selector.includes(".plexus-portal") && selector.includes(".plexus-template-tile")) {
        matches.push(selector);
      }
    }
  }
  assert.ok(
    matches.length > 0,
    "no color rule whose selector contains both .plexus-portal and .plexus-template-tile",
  );
  for (const selector of matches) {
    const spec = specificity(selector);
    assert.ok(
      compareSpec(spec, BENCHMARK) > 0,
      `${selector} specificity (${spec.join(",")}) is not greater than (0,1,1)`,
    );
  }
});

function stripComments(css) {
  let out = "";
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += css[i + 1] ?? "";
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i++;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

function parseRules(css) {
  const rules = [];
  function scan(from, to) {
    let i = from;
    while (i < to) {
      while (i < to && /\s/.test(css[i])) i++;
      if (i >= to) break;
      const selStart = i;
      let quote = null;
      while (i < to) {
        const c = css[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = null;
          i++;
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          i++;
          continue;
        }
        if (c === "{" || c === "}") break;
        i++;
      }
      if (i >= to || css[i] !== "{") break;
      const prelude = css.slice(selStart, i).trim();
      i++;
      const bodyStart = i;
      let depth = 1;
      quote = null;
      while (i < to && depth > 0) {
        const c = css[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = null;
          i++;
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          i++;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth > 0) i++;
      }
      const bodyEnd = i;
      const body = css.slice(bodyStart, bodyEnd);
      if (i < to && css[i] === "}") i++;
      if (!prelude) continue;
      if (prelude.startsWith("@")) {
        if (body.includes("{")) scan(bodyStart, bodyEnd);
        continue;
      }
      rules.push({ selector: prelude, body });
      if (body.includes("{")) scan(bodyStart, bodyEnd);
    }
  }
  scan(0, css.length);
  return rules;
}

function declaresColor(body) {
  return splitTopLevel(body, ";").some((decl) => propertyName(decl) === "color");
}

function propertyName(decl) {
  let quote = null;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let i = 0; i < decl.length; i++) {
    const c = decl[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ":" && paren === 0 && bracket === 0 && brace === 0) {
      return decl.slice(0, i).trim().toLowerCase();
    }
  }
  return "";
}

function splitSelectors(selector) {
  return splitTopLevel(selector, ",").map((part) => part.trim()).filter(Boolean);
}

function splitTopLevel(text, sep) {
  const parts = [];
  let start = 0;
  let quote = null;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === sep && paren === 0 && bracket === 0 && brace === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function compareSpec(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function specificity(selector) {
  return specificityComplex(selector.trim());
}

function specificityComplex(selector) {
  const spec = [0, 0, 0];
  let i = 0;
  while (i < selector.length) {
    i = skipWs(selector, i);
    if (i >= selector.length) break;
    const c = selector[i];
    if (c === ">" || c === "+" || c === "~") {
      i++;
      continue;
    }
    if (c === "|" && selector[i + 1] === "|") {
      i += 2;
      continue;
    }
    if (c === ",") break;
    const compound = parseCompound(selector, i);
    addSpec(spec, compound.spec);
    i = compound.i > i ? compound.i : i + 1;
  }
  return spec;
}

function maxSpecificity(selectorList) {
  let best = [0, 0, 0];
  for (const part of splitSelectors(selectorList)) {
    const spec = specificityComplex(part);
    if (compareSpec(spec, best) > 0) best = spec;
  }
  return best;
}

function parseCompound(selector, i) {
  const spec = [0, 0, 0];
  const start = i;
  while (i < selector.length) {
    const c = selector[i];
    if (/\s/.test(c) || c === ">" || c === "+" || c === "~" || c === ",") break;
    if (c === "|" && selector[i + 1] === "|") break;
    const at = i;
    if (c === "*") {
      i++;
    } else if (c === "#") {
      spec[0]++;
      i = consumeIdent(selector, i + 1);
    } else if (c === ".") {
      spec[1]++;
      i = consumeIdent(selector, i + 1);
    } else if (c === "[") {
      spec[1]++;
      i = consumeBracket(selector, i);
    } else if (c === "&") {
      i++;
    } else if (c === ":") {
      const pseudo = parsePseudo(selector, i);
      addSpec(spec, pseudo.spec);
      i = pseudo.i;
    } else {
      const type = parseType(selector, i);
      addSpec(spec, type.spec);
      i = type.i;
    }
    if (i <= at) i = at + 1;
  }
  if (i === start) i++;
  return { spec, i };
}

function parsePseudo(selector, i) {
  i++;
  let element = false;
  if (selector[i] === ":") {
    element = true;
    i++;
  }
  const nameStart = i;
  i = consumeIdent(selector, i);
  const name = selector.slice(nameStart, i).toLowerCase();
  if (!element && (name === "before" || name === "after" || name === "first-line" || name === "first-letter")) {
    element = true;
  }
  if (selector[i] !== "(") return { spec: element ? [0, 0, 1] : [0, 1, 0], i };
  const close = matchingParen(selector, i);
  const arg = selector.slice(i + 1, close);
  i = close + 1;
  if (element) {
    if (name === "slotted") return { spec: addSpec([0, 0, 1], maxSpecificity(arg)), i };
    return { spec: [0, 0, 1], i };
  }
  if (name === "where") return { spec: [0, 0, 0], i };
  if (name === "is" || name === "not" || name === "has" || name === "matches") {
    return { spec: maxSpecificity(arg), i };
  }
  if (name === "nth-child" || name === "nth-last-child") {
    const ofAt = arg.search(/\bof\b/i);
    const extra = ofAt >= 0 ? maxSpecificity(arg.slice(ofAt + 2)) : [0, 0, 0];
    return { spec: addSpec([0, 1, 0], extra), i };
  }
  if ((name === "host" || name === "host-context") && arg.trim()) {
    return { spec: addSpec([0, 1, 0], maxSpecificity(arg)), i };
  }
  return { spec: [0, 1, 0], i };
}

function parseType(selector, i) {
  if (selector[i] === "|") {
    i++;
    if (selector[i] === "*") return { spec: [0, 0, 0], i: i + 1 };
    return { spec: [0, 0, 1], i: consumeIdent(selector, i) };
  }
  const start = i;
  i = consumeIdent(selector, i);
  if (i === start) return { spec: [0, 0, 0], i: i + 1 };
  if (selector[i] === "|") {
    i++;
    if (selector[i] === "*") return { spec: [0, 0, 0], i: i + 1 };
    return { spec: [0, 0, 1], i: consumeIdent(selector, i) };
  }
  return { spec: [0, 0, 1], i };
}

function consumeIdent(selector, i) {
  if (selector[i] === "-") i++;
  while (i < selector.length) {
    const c = selector[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (/[A-Za-z0-9_\u0080-\uFFFF-]/.test(c)) i++;
    else break;
  }
  return i;
}

function consumeBracket(selector, i) {
  let quote = null;
  for (i++; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "]") return i + 1;
  }
  return i;
}

function matchingParen(selector, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return selector.length;
}

function skipWs(selector, i) {
  while (i < selector.length && /\s/.test(selector[i])) i++;
  return i;
}

function addSpec(target, extra) {
  target[0] += extra[0];
  target[1] += extra[1];
  target[2] += extra[2];
  return target;
}
