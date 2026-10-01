// Breadcrumb, unplaced tray, and comment thread. Display only. The actions own every write.

const MIN_Z = 100003;

function stop(e) {
  e.preventDefault?.();
  e.stopPropagation?.();
}

function mountRoot(doc, className, zIndex) {
  const root = doc.createElement("div");
  root.className = className;
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  root.addEventListener?.("pointerdown", stop);
  root.addEventListener?.("mousedown", stop);
  return root;
}

export function mountBreadcrumb({ doc, container, rows = [], onOpen } = {}) {
  if (!doc?.createElement || !rows.length) return { close() {} };
  const root = mountRoot(doc, "plexus-portal plexus-crumbs", 0);
  rows.forEach((row, index) => {
    if (index) {
      const sep = doc.createElement("span");
      sep.className = "plexus-crumb-sep";
      sep.textContent = "/";
      root.append(sep);
    }
    const last = index === rows.length - 1;
    const el = doc.createElement(last ? "span" : "button");
    el.className = last ? "plexus-crumb plexus-crumb-current" : "plexus-crumb";
    el.textContent = row.label;
    if (!last) {
      el.type = "button";
      el.addEventListener?.("click", (event) => {
        stop(event);
        try { onOpen?.(row); } catch (error) { console.warn("[plexus] breadcrumb open failed", error); }
      });
    }
    root.append(el);
  });
  try { (container || doc.body)?.append?.(root); }
  catch (error) { console.warn("[plexus] breadcrumb failed", error); }
  return { root, close() { try { root.remove?.(); } catch { /* already gone */ } } };
}

export function openTray({ doc, rows = [], onPick, zIndex = 0 } = {}) {
  if (!doc?.createElement) return { close() {} };
  const root = mountRoot(doc, "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-tray", zIndex);
  const title = doc.createElement("div");
  title.className = "plexus-picker-header";
  title.textContent = "Unplaced";
  const list = doc.createElement("div");
  list.className = "rm-autocomplete__results-scroll";
  for (const row of rows) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "plexus-tray-row";
    button.textContent = row.label;
    button.setAttribute?.("data-uid", row.uid);
    button.addEventListener?.("click", (event) => {
      stop(event);
      try { onPick?.(row.uid); } catch (error) { console.warn("[plexus] inbox place failed", error); }
    });
    list.append(button);
  }
  root.append(title, list);
  try { doc.body?.append?.(root); }
  catch (error) { console.warn("[plexus] inbox failed", error); }
  return { root, close() { try { root.remove?.(); } catch { /* already gone */ } } };
}

export function openThread({ doc, thread, onReply, zIndex = 0 } = {}) {
  if (!doc?.createElement || !thread) return { close() {} };
  let dead = false;
  const root = mountRoot(doc, "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-thread", zIndex);
  const title = doc.createElement("div");
  title.className = "plexus-picker-header";
  title.textContent = "Comment";
  const list = doc.createElement("div");
  list.className = "rm-autocomplete__results-scroll";
  const paint = (current) => {
    if (typeof list.replaceChildren === "function") list.replaceChildren();
    else list.children = [];
    const head = doc.createElement("div");
    head.className = "plexus-thread-head";
    head.textContent = current?.text || "";
    list.append(head);
    for (const reply of current?.replies || []) {
      const line = doc.createElement("div");
      line.className = "plexus-thread-reply";
      line.textContent = reply.text;
      list.append(line);
    }
  };
  paint(thread);
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "plexus-name-input";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "plexus-toolbar-button";
  button.textContent = "Reply";
  const send = () => {
    const text = String(input.value ?? "").trim();
    if (!text || dead) return;
    Promise.resolve(onReply?.(text)).then((next) => {
      input.value = "";
      if (next && Array.isArray(next.replies)) paint(next);
    }).catch((error) => {
      console.warn("[plexus] comment reply failed", error);
    });
  };
  button.addEventListener?.("click", (event) => { stop(event); send(); });
  input.addEventListener?.("keydown", (event) => {
    event.stopPropagation?.();
    if (event.key === "Enter") { event.preventDefault?.(); send(); }
  });
  root.append(title, list, input, button);
  try { doc.body?.append?.(root); }
  catch (error) { console.warn("[plexus] comment thread failed", error); }
  return {
    root,
    close() {
      dead = true;
      try { root.remove?.(); } catch { /* already gone */ }
    },
  };
}
