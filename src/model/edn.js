// Minimal EDN reader for legacy ExcalDATA blocks. Iterative (explicit stack), depth-bounded.
const MAX_DEPTH = 512;
const NUMBER_RE = /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const NUMERIC_START_RE = /^[+-]?\d/;
const HEX4_RE = /^[0-9a-fA-F]{4}$/;
const CLOSERS = { "[": "]", "(": ")", "{": "}", "#{": "}" };

function fail(message, position) {
  const e = new SyntaxError(`${message} at ${position}`);
  e.position = position;
  return e;
}

function isWs(c) {
  return c === 32 || c === 44 || c === 10 || c === 9 || c === 13 || c === 12 || c === 11;
}

function isDelim(c) {
  // whitespace, comma, ( ) [ ] { } " ;
  return isWs(c) || c === 40 || c === 41 || c === 91 || c === 93 || c === 123 || c === 125 || c === 34 || c === 59;
}

function skipWs(text, pos) {
  const n = text.length;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (isWs(c)) pos++;
    else if (c === 59) {
      while (pos < n && text.charCodeAt(pos) !== 10) pos++;
    } else break;
  }
  return pos;
}

function readToken(text, pos) {
  let end = pos;
  while (end < text.length && !isDelim(text.charCodeAt(end))) end++;
  return end;
}

function readString(text, start) {
  const n = text.length;
  let pos = start + 1;
  let out = "";
  let chunk = pos;
  while (pos < n) {
    const c = text[pos];
    if (c === '"') return { value: out + text.slice(chunk, pos), end: pos + 1 };
    if (c === "\\") {
      out += text.slice(chunk, pos);
      const e = text[pos + 1];
      switch (e) {
        case '"': out += '"'; break;
        case "\\": out += "\\"; break;
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "u": {
          const hex = text.slice(pos + 2, pos + 6);
          if (!HEX4_RE.test(hex)) throw fail("Bad \\u escape", pos);
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
          break;
        }
        default:
          throw fail("Bad escape", pos);
      }
      pos += 2;
      chunk = pos;
      continue;
    }
    pos++;
  }
  throw fail("Unterminated string", start);
}

function atom(token, start) {
  if (token === "nil") return null;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token.charCodeAt(0) === 58) {
    if (token.length === 1) throw fail("Empty keyword", start);
    return token.slice(1);
  }
  if (NUMBER_RE.test(token)) return Number(token);
  if (NUMERIC_START_RE.test(token)) throw fail(`Invalid number "${token}"`, start);
  if (token === "NaN") return NaN;
  if (token === "Infinity") return Infinity;
  if (token === "-Infinity") return -Infinity;
  return token;
}

function finishMap(items, opener) {
  if (items.length % 2 !== 0) throw fail("Odd number of forms in map", opener);
  const obj = {};
  for (let i = 0; i < items.length; i += 2) {
    const k = items[i];
    if (k !== null && typeof k === "object") throw fail("Collection used as map key", opener);
    Object.defineProperty(obj, String(k), { value: items[i + 1], enumerable: true, writable: true, configurable: true });
  }
  return obj;
}

// Reads exactly one form starting at `start`. Returns { value, end }.
export function readEdn(text, start = 0) {
  if (typeof text !== "string") throw fail("EDN input must be a string", 0);
  const n = text.length;
  const stack = [];
  let pos = start;

  const push = (frame) => {
    if (stack.length >= MAX_DEPTH) throw fail("Nesting too deep", frame.opener);
    stack.push(frame);
  };

  // Delivers a completed value to the enclosing frame. Returns true when the top-level form is done.
  const deliver = (value) => {
    for (;;) {
      const top = stack[stack.length - 1];
      if (!top) { result = value; return true; }
      if (top.kind === "discard") { stack.pop(); return false; }
      if (top.kind === "tag") { stack.pop(); continue; }
      top.items.push(value);
      return false;
    }
  };
  let result;

  for (;;) {
    pos = skipWs(text, pos);
    if (pos >= n) {
      const top = stack[stack.length - 1];
      if (!top) throw fail("Unexpected end of input", pos);
      throw fail(top.kind === "discard" ? "Discard without a form"
        : top.kind === "tag" ? "Tag without a form"
        : top.kind === "map" ? "Unterminated map"
        : top.kind === "set" ? "Unterminated set"
        : "Unterminated collection", top.opener);
    }
    const ch = text[pos];

    if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack[stack.length - 1];
      if (!top || top.close !== ch) throw fail(`Unexpected "${ch}"`, pos);
      stack.pop();
      pos++;
      const value = top.kind === "map" ? finishMap(top.items, top.opener) : top.items;
      if (deliver(value)) return { value: result, end: pos };
      continue;
    }
    if (ch === "[" || ch === "(") {
      push({ kind: "vec", close: CLOSERS[ch], items: [], opener: pos });
      pos++;
      continue;
    }
    if (ch === "{") {
      push({ kind: "map", close: "}", items: [], opener: pos });
      pos++;
      continue;
    }
    if (ch === '"') {
      const s = readString(text, pos);
      pos = s.end;
      if (deliver(s.value)) return { value: result, end: pos };
      continue;
    }
    if (ch === "#") {
      const next = text[pos + 1];
      if (next === "{") {
        push({ kind: "set", close: "}", items: [], opener: pos });
        pos += 2;
        continue;
      }
      if (next === "_") {
        push({ kind: "discard", opener: pos });
        pos += 2;
        continue;
      }
      if (next === "#") {
        const end = readToken(text, pos + 2);
        const name = text.slice(pos + 2, end);
        const v = name === "NaN" ? NaN : name === "Inf" ? Infinity : name === "-Inf" ? -Infinity : undefined;
        if (v === undefined) throw fail(`Unknown special value "##${name}"`, pos);
        pos = end;
        if (deliver(v)) return { value: result, end: pos };
        continue;
      }
      const end = readToken(text, pos + 1);
      const name = text.slice(pos + 1, end);
      if (!/^[A-Za-z][^\s]*$/.test(name)) throw fail("Invalid # dispatch", pos);
      push({ kind: "tag", opener: pos });
      pos = end;
      continue;
    }
    const end = readToken(text, pos);
    const v = atom(text.slice(pos, end), pos);
    pos = end;
    if (deliver(v)) return { value: result, end: pos };
  }
}

export function parseEdn(text) {
  const { value, end } = readEdn(text, 0);
  let pos = end;
  for (;;) {
    pos = skipWs(text, pos);
    if (pos >= text.length) return value;
    if (text[pos] === "#" && text[pos + 1] === "_") {
      const from = skipWs(text, pos + 2);
      if (from >= text.length) throw fail("Discard without a form", pos);
      pos = readEdn(text, from).end;
      continue;
    }
    throw fail("Unexpected content after form", pos);
  }
}
