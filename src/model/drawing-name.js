const NAME_RE = /^Name::\s*(\S(?:.*\S)?)\s*$/;

// The first Name child, in the order given. Other attributes are ignored.
export function drawingName(children) {
  const list = Array.isArray(children) ? children : [];
  for (const child of list) {
    const match = NAME_RE.exec(String(child?.string ?? ""));
    if (!match) continue;
    return { uid: child.uid, value: match[1] };
  }
  return null;
}

// How to store one Name child. Never describes a props write.
export function namePlan(children, value) {
  const current = drawingName(children);
  const next = String(value ?? "").trim();
  if (!next) return current ? { action: "delete", uid: current.uid } : { action: "none" };
  const string = `Name:: ${next}`;
  if (current && current.value === next) return { action: "none" };
  if (current) return { action: "update", uid: current.uid, string };
  return { action: "create", string };
}
