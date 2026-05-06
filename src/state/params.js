// --- Preset storage -----------------------------------------------------

export let presets = JSON.parse(localStorage.getItem('retroPresets') || '{}');

export function savePresetsToStorage() {
    localStorage.setItem('retroPresets', JSON.stringify(presets));
}

// --- Undo/redo param snapshots ------------------------------------------
// Global params are no longer the source of truth (effect state lives in
// effectStack.js), but these stubs keep undo.js working without breakage.

export function snapshotParams() {
    return {};
}

export function restoreParams(_snapshot) {
    // no-op: nothing to restore
}
