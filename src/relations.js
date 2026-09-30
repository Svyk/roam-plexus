const DEFAULT_LABEL = "relates to";

export function relationPlan({ sourceUid, destUid, label = DEFAULT_LABEL, strings } = {}) {
  if (typeof sourceUid !== "string" || sourceUid === "" || typeof destUid !== "string" || destUid === "" || sourceUid === destUid) return null;
  const name = typeof label === "string" && label !== "" ? label : DEFAULT_LABEL;
  const child = `((${destUid}))`;
  if (Array.isArray(strings) && strings.some((entry) => typeof entry === "string" && entry.includes(child))) return null;
  return { parentUid: sourceUid, attribute: `${name}::`, child };
}
