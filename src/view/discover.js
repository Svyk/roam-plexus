import { REGION_BUTTON_CLASS } from "../model/region.js";

const SKIP_SELECTOR = ".plexus-offscreen, .plexus-root";
const EDITOR_OUTER = ".excalidraw-outer-container.full-screen";

function skipped(node) {
  return !!node.closest?.(SKIP_SELECTOR);
}

function underFullScreen(el) {
  return !!el.closest?.(EDITOR_OUTER);
}

// Cheap per-added-node classification: class checks only, no layout reads.
export function classifyAddedNode(node) {
  const out = { regionButtons: [], editors: [] };
  if (!node || node.nodeType !== 1 || skipped(node)) return out;

  if (node.classList?.contains(REGION_BUTTON_CLASS)) out.regionButtons.push(node);
  const buttons = node.getElementsByClassName?.(REGION_BUTTON_CLASS);
  if (buttons) for (let i = 0; i < buttons.length; i++) out.regionButtons.push(buttons[i]);

  if (node.classList?.contains("excalidraw")) {
    if (underFullScreen(node)) out.editors.push(node);
  } else {
    const editors = node.getElementsByClassName?.("excalidraw");
    if (editors) {
      for (let i = 0; i < editors.length; i++) {
        if (underFullScreen(editors[i])) out.editors.push(editors[i]);
      }
    }
  }
  return out;
}

export function createDiscovery({ root, onRegionButton, onEditorMount, onEditorUnmount, MutationObserverImpl = globalThis.MutationObserver }) {
  let trackedEditor = null;
  let disposed = false;

  const safe = (fn, arg) => {
    try {
      fn?.(arg);
    } catch (error) {
      console.warn("[plexus] discovery handler failed", error);
    }
  };

  const mountEditor = (el) => {
    if (trackedEditor === el) return;
    trackedEditor = el;
    safe(onEditorMount, el);
  };

  const handle = ({ regionButtons, editors }) => {
    for (const btn of regionButtons) safe(onRegionButton, btn);
    for (const el of editors) mountEditor(el);
  };

  const observer = new MutationObserverImpl((records) => {
    if (disposed) return;
    try {
      for (const record of records) {
        for (const node of record.addedNodes) handle(classifyAddedNode(node));
        if (trackedEditor && record.removedNodes.length && !trackedEditor.isConnected) {
          const gone = trackedEditor;
          trackedEditor = null;
          safe(onEditorUnmount, gone);
        }
      }
    } catch (error) {
      console.warn("[plexus] discovery failed", error);
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  return {
    scanExisting() {
      try {
        const regionButtons = Array.from(root.querySelectorAll(`.${REGION_BUTTON_CLASS}`)).filter((el) => !skipped(el));
        const editors = Array.from(root.querySelectorAll(`${EDITOR_OUTER} .excalidraw`)).filter((el) => !skipped(el));
        handle({ regionButtons, editors });
      } catch (error) {
        console.warn("[plexus] scanExisting failed", error);
      }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      trackedEditor = null;
    },
  };
}
