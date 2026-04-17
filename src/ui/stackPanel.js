import { EFFECT_CATALOG } from '../effects/registry.js';
import { getStack, addEffect, removeEffect, moveEffect } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';

let _onRebuild = null;

export function initStackPanel(onRebuild) {
    _onRebuild = onRebuild;
    document.getElementById('addEffectBtn').addEventListener('click', togglePicker);
    document.getElementById('effectPickerClose').addEventListener('click', closePicker);
    renderCatalog();
}

function togglePicker() {
    const picker = document.getElementById('effectPicker');
    picker.classList.toggle('hidden');
}

function closePicker() {
    document.getElementById('effectPicker').classList.add('hidden');
}

function renderCatalog() {
    const list = document.getElementById('effectCatalogList');
    list.innerHTML = '';
    for (const entry of EFFECT_CATALOG) {
        const item = document.createElement('button');
        item.className = 'catalog-item';
        item.innerHTML = `<span class="catalog-item-label">${entry.label}</span><span class="catalog-item-desc">${entry.description}</span>`;
        item.addEventListener('click', () => {
            saveState();
            addEffect(entry.name);
            closePicker();
            renderStackList();
            if (_onRebuild) _onRebuild();
        });
        list.appendChild(item);
    }
}

export function renderStackList() {
    const container = document.getElementById('effectStackList');
    container.innerHTML = '';
    const stack = getStack();

    if (stack.length === 0) {
        container.innerHTML = '<div class="stack-empty">No effects added yet.<br>Click + Add Effect to start.</div>';
        return;
    }

    // Count occurrences for duplicate labeling
    const counts = {};
    const seen = {};
    for (const inst of stack) {
        counts[inst.effectName] = (counts[inst.effectName] || 0) + 1;
    }

    for (let i = 0; i < stack.length; i++) {
        const inst = stack[i];
        seen[inst.effectName] = (seen[inst.effectName] || 0) + 1;

        const entry = EFFECT_CATALOG.find(e => e.name === inst.effectName);
        const baseLabel = entry ? entry.label : inst.effectName;
        const label = counts[inst.effectName] > 1
            ? `${baseLabel} (${seen[inst.effectName]})`
            : baseLabel;

        const item = document.createElement('div');
        item.className = 'stack-item';
        item.dataset.id = inst.id;
        item.dataset.index = i;
        item.draggable = true;

        item.innerHTML = `
            <span class="stack-drag-handle" title="Drag to reorder">&#8801;</span>
            <span class="stack-item-label">${label}</span>
            <div class="stack-item-actions">
                <button class="stack-move-btn" data-dir="up" title="Move up">&#8593;</button>
                <button class="stack-move-btn" data-dir="down" title="Move down">&#8595;</button>
                <button class="stack-delete-btn" title="Remove">&#10005;</button>
            </div>
        `;

        // Move up/down buttons
        item.querySelectorAll('.stack-move-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                saveState();
                const dir = btn.dataset.dir;
                const idx = parseInt(item.dataset.index);
                moveEffect(inst.id, dir === 'up' ? idx - 1 : idx + 1);
                renderStackList();
                if (_onRebuild) _onRebuild();
            });
        });

        // Delete button
        item.querySelector('.stack-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            saveState();
            removeEffect(inst.id);
            renderStackList();
            if (_onRebuild) _onRebuild();
        });

        // Drag-and-drop reordering
        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover', onDragOver);
        item.addEventListener('drop', onDrop);
        item.addEventListener('dragend', onDragEnd);

        container.appendChild(item);
    }
}

// --- Drag-and-drop ---

let _dragId = null;

function onDragStart(e) {
    _dragId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function onDrop(e) {
    e.preventDefault();
    const targetId = e.currentTarget.dataset.id;
    e.currentTarget.classList.remove('drag-over');
    if (!_dragId || _dragId === targetId) return;

    const stack = getStack();
    const targetIndex = stack.findIndex(inst => inst.id === targetId);
    saveState();
    moveEffect(_dragId, targetIndex);
    renderStackList();
    if (_onRebuild) _onRebuild();
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.stack-item').forEach(el => el.classList.remove('drag-over'));
    _dragId = null;
}
