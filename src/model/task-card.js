import { taskParts } from "./mindmap.js";

const MACRO_LEN = "{{[[TODO]]}}".length;

// The visible label, without the macro. Null when the block is not a task.
export function taskLabel(string) {
  const parts = taskParts(string);
  if (!parts.state) return null;
  const rest = parts.rest.trim();
  return rest || "Task";
}

// Swap TODO and DONE. The characters after the macro, including one space, stay. Null when it is not a task.
export function toggleTaskString(string) {
  const parts = taskParts(string);
  if (!parts.state || typeof string !== "string") return null;
  const next = parts.state === "TODO" ? "DONE" : "TODO";
  return `{{[[${next}]]}}${string.slice(MACRO_LEN)}`;
}
