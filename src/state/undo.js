import { snapshotParams, restoreParams } from './params.js';
import { snapshotStack, restoreStack } from './effectStack.js';

let _undoStack = [];
let _redoStack = [];

function _snapshot() {
    return { params: snapshotParams(), stack: snapshotStack() };
}

function _restore(snapshot, syncDOM, rebuildStack) {
    restoreParams(snapshot.params);
    restoreStack(snapshot.stack);
    syncDOM();
    rebuildStack();
}

/**
 * Save current state (params + effect stack) onto the undo stack.
 */
export function saveState() {
    _undoStack.push(_snapshot());
    if (_undoStack.length > 50) _undoStack.shift();
    _redoStack = [];
    updateUndoButtons();
}

export function undo(syncDOM, rebuildStack) {
    if (_undoStack.length === 0) return;
    _redoStack.push(_snapshot());
    _restore(_undoStack.pop(), syncDOM, rebuildStack);
    updateUndoButtons();
}

export function redo(syncDOM, rebuildStack) {
    if (_redoStack.length === 0) return;
    _undoStack.push(_snapshot());
    _restore(_redoStack.pop(), syncDOM, rebuildStack);
    updateUndoButtons();
}

export function updateUndoButtons() {
    document.getElementById('undoBtn').disabled = _undoStack.length === 0;
    document.getElementById('redoBtn').disabled = _redoStack.length === 0;
    document.getElementById('undoBtnMobile').disabled = _undoStack.length === 0;
    document.getElementById('redoBtnMobile').disabled = _redoStack.length === 0;
}
