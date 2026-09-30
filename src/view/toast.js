export function createToaster({ doc }) {
  let el = null;
  let timer = null;
  let disposed = false;
  let action = null;
  let onHide = null;
  let held = null;

  const hide = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    el?.remove();
    el = null;
    action = null;
    const cb = onHide;
    onHide = null;
    try { cb?.(); } catch (error) { console.warn("[plexus] toast hide callback failed", error); }
    const next = held;
    held = null;
    if (next && !disposed) show(next.message, next.opts);
  };

  function show(message, { kind = "info", ms, action: act, onHide: hideCb } = {}) {
    if (disposed) return;
    const hasAction = !!act && typeof act.run === "function";
    if (action && !hasAction) {
      held = { message, opts: { kind, ms } };
      return;
    }
    held = null;
    if (timer != null) clearTimeout(timer);
    const prevHide = onHide;
    onHide = null;
    try { prevHide?.(); } catch (error) { console.warn("[plexus] toast hide callback failed", error); }
    if (!el) {
      el = doc.createElement("div");
      el.setAttribute("role", "status");
      doc.body.append(el);
    }
    el.className = `plexus-portal plexus-toast plexus-toast-${kind}`;
    el.textContent = message;
    action = null;
    onHide = typeof hideCb === "function" ? hideCb : null;
    if (hasAction) {
      const run = act.run;
      const button = doc.createElement("button");
      button.className = "plexus-toast-action";
      button.type = "button";
      button.textContent = act.label ?? "Undo";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      let used = false;
      button.addEventListener("click", () => {
        if (used) return;
        used = true;
        hide();
        try { run(); } catch (error) { console.warn("[plexus] toast action failed", error); }
      });
      el.append(button);
      action = { run };
    }
    timer = setTimeout(hide, ms ?? (hasAction ? 10000 : 2600));
  }

  return {
    show,
    dispose() {
      disposed = true;
      held = null;
      onHide = null;
      hide();
    },
  };
}
