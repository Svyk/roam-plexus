const NAME_CAP = 8;
const NAME_LEN = 40;

// `Name:: value` on one line. A name that contains a ref or a component is not an attribute.
export function parseAttr(string) {
  if (typeof string !== "string") return null;
  const at = string.indexOf("::");
  if (at <= 0) return null;
  const name = string.slice(0, at).trim();
  if (!name || /[[\]{}#`]/.test(name)) return null;
  return { name, value: string.slice(at + 2).trim(), bt: name.startsWith("BT_attr") };
}

// Comma-separated names the user typed. Drops blanks, duplicates, and anything that is not a plain name.
export function chosenAttrs(text) {
  const out = [];
  for (const part of String(text ?? "").split(",")) {
    const name = part.trim();
    if (!name || name.length > NAME_LEN) continue;
    if (/[[\]{}#`]/.test(name) || name.includes("::")) continue;
    if (out.includes(name)) continue;
    out.push(name);
    if (out.length >= NAME_CAP) break;
  }
  return out;
}

// One row per chosen name. A missing attribute is an empty editable row. Better Tasks attributes are never editable.
export function attrRows(children, names) {
  const list = Array.isArray(children) ? children : [];
  const rows = [];
  for (const name of names || []) {
    if (typeof name !== "string" || !name) continue;
    const hit = list.find((child) => parseAttr(child?.string)?.name === name) || null;
    const parsed = hit ? parseAttr(hit.string) : null;
    const bt = name.startsWith("BT_attr") || !!parsed?.bt;
    rows.push({
      name,
      value: parsed?.value || "",
      uid: typeof hit?.uid === "string" ? hit.uid : null,
      editable: !bt,
    });
  }
  return rows;
}

// The block string to write. Better Tasks attributes are refused. An empty value deletes the block.
export function attrWrite(name, value) {
  if (typeof name !== "string" || !name || name.startsWith("BT_attr")) return { action: "none" };
  const next = String(value ?? "").trim();
  if (!next) return { action: "delete" };
  return { action: "write", string: `${name}:: ${next}` };
}
