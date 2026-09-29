import { createLifecycle } from "./lifecycle.js";
import { createSettingsPanel, initializeSettings } from "./settings.js";

let activeLifecycle = null;

const COMMANDS = [
  "Plexus: Create region from selection",
  "Plexus: Create image region",
  "Plexus: Refresh crops for open drawing",
  "Plexus: Clear crop cache",
];

export async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    for (const label of COMMANDS) {
      await lifecycle.command(extensionAPI.ui.commandPalette, {
        label,
        callback: () => console.warn("[plexus] not implemented:", label),
      });
    }
    console.info(`[plexus] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }

  // Roam invokes this cleanup immediately before onunload.
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}

export async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus] Unloaded");
}

export default { onload, onunload };
