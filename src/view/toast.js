export function createToaster({ doc }) {
  let el = null;
  let timer = null;
  let disposed = false;

  const hide = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    el?.remove();
    el = null;
  };

  return {
    show(message, { kind = "info", ms = 2600 } = {}) {
      if (disposed) return;
      if (timer != null) clearTimeout(timer);
      if (!el) {
        el = doc.createElement("div");
        el.setAttribute("role", "status");
        doc.body.append(el);
      }
      el.className = `plexus-portal plexus-toast plexus-toast-${kind}`;
      el.textContent = message;
      timer = setTimeout(hide, ms);
    },
    dispose() {
      disposed = true;
      hide();
    },
  };
}
