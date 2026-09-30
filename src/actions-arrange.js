import { ARRANGE_OPS, MAP_MESSAGE, arrange, arrangeUnits } from "./model/arrange.js";

// The canvas menu's "Plexus: Arrange" operations. native: activeEditor/selectedElementIds; beforeBulk(app, uid, label).
export function createArrangeActions({ doc, native, toaster, guardedWrite, beforeBulk } = {}) {
  const toast = (message, opts) => { try { toaster?.show?.(message, opts); } catch { /* ignore */ } };

  function context() {
    const editor = native?.activeEditor?.(doc);
    if (!editor?.app) return null;
    const elements = editor.app.getSceneElementsIncludingDeleted?.() ?? [];
    return { editor, elements, ids: native.selectedElementIds(editor.app) };
  }

  function canRun(op) {
    try {
      const def = ARRANGE_OPS.find((o) => o.op === op);
      const ctx = def && context();
      if (!ctx) return false;
      return !!def.enabled(arrangeUnits(ctx.elements, ctx.ids).units, ctx.elements);
    } catch (error) {
      console.warn("[plexus] arrange canRun failed", error);
      return false;
    }
  }

  function run(op) {
    try {
      const ctx = context();
      if (!ctx) return false;
      const result = arrange(ctx.elements, ctx.ids, op);
      if (!result.next) {
        if (result.message) toast(result.message);
        return false;
      }
      const { app, drawingUid } = ctx.editor;
      try { beforeBulk?.(app, drawingUid, "before Arrange"); } catch (error) { console.warn("[plexus] beforeBulk failed", error); }
      const ok = guardedWrite(app, { drawingUid, label: "Arrange", captureUpdate: "IMMEDIATELY", next: result.next });
      if (!ok) return false;
      if (result.bent) toast(`${result.bent} bent or elbow arrows kept their shape`);
      if (result.mapSkipped) toast(MAP_MESSAGE);
      return true;
    } catch (error) {
      console.warn("[plexus] arrange failed", error);
      toast("Could not arrange the selection", { kind: "error" });
      return false;
    }
  }

  return { canRun, run };
}
