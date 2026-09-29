// Dev tool (not bundled): node tools/live-load.mjs "<target title substring>" [--unload]
// Loads the built extension.js/extension.css into a running Roam Desktop over CDP.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.CDP_PORT || 9223;
const [, , match, flag] = process.argv;
if (!match) {
  console.error('usage: node tools/live-load.mjs "<target title substring>" [--unload]');
  process.exit(2);
}
const unload = flag === "--unload";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = targets.find((t) => t.type === "page" && t.title.includes(match));
if (!target) {
  console.error("no target matching", match);
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

let expression;
if (unload) {
  expression = `(async () => {
    await window.__plexusDev?.cleanup?.();
    window.__plexusDev = undefined;
    return String(window.__ROAM_PLEXUS_VERSION);
  })()`;
} else {
  const [js, css] = await Promise.all([
    readFile(resolve(root, "extension.js"), "utf8"),
    readFile(resolve(root, "extension.css"), "utf8"),
  ]);
  expression = `(async () => {
    await window.__plexusDev?.cleanup?.();
    window.__plexusDev = undefined;
    const style = document.createElement("style");
    style.id = "plexus-dev-css";
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
    const palette = window.roamAlphaAPI.ui.commandPalette;
    const registered = [];
    const store = () => JSON.parse(localStorage.getItem("plexus-dev-settings") || "{}");
    const devApi = {
      settings: {
        canSet: true,
        get: (key) => store()[key] ?? null,
        set: async (key, value) => { const s = store(); s[key] = value; localStorage.setItem("plexus-dev-settings", JSON.stringify(s)); return null; },
        panel: { create: async () => null },
      },
      ui: {
        commandPalette: {
          addCommand: (cmd) => { registered.push(cmd.label); return palette.addCommand(cmd); },
          removeCommand: (cmd) => palette.removeCommand(cmd),
        },
      },
    };
    const url = URL.createObjectURL(new Blob([${JSON.stringify(js)}], { type: "text/javascript" }));
    let mod;
    try {
      mod = await import(url);
      await mod.default.onload({ extensionAPI: devApi, extension: { version: "dev" } });
    } catch (error) {
      style.remove();
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
    window.__plexusDev = {
      cleanup: async () => {
        await mod.default.onunload();
        style.remove();
        for (const label of registered) { try { palette.removeCommand({ label }); } catch {} }
      },
    };
    return String(window.__ROAM_PLEXUS_VERSION);
  })()`;
}

const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
ws.close();
if (res.result?.exceptionDetails) {
  console.error("live-load failed:", res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
  process.exit(1);
}
console.log("__ROAM_PLEXUS_VERSION =", res.result?.result?.value);
