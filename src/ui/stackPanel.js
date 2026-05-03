import { EFFECT_CATALOG, getEffect } from '../effects/registry.js';
import { getStack, addEffect, removeEffect, moveEffect, duplicateEffect, setInstanceParam } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { buildEffectBody } from './stackControls.js';
import { showFadeOverlay, hideFadeOverlay, showBlurOverlay, hideBlurOverlay, showCropOverlay, hideCropOverlay, showViewportOverlay, hideViewportOverlay, showMatrixRainOverlay, hideMatrixRainOverlay, showLineDragOverlay, hideLineDragOverlay, showChromaOverlay, hideChromaOverlay, showVignetteOverlay, hideVignetteOverlay, showCorruptedOverlay, hideCorruptedOverlay, showCRTCurvatureOverlay, hideCRTCurvatureOverlay, showTextOverlay, hideTextOverlay, showDoubleExposureOverlay, hideDoubleExposureOverlay, showShapeStickerOverlay, hideShapeStickerOverlay } from './canvasPicker.js';

let _expandedId = null;

export function initStackPanel() {
    renderCatalog();
}

function renderCatalog() {
    const list = document.getElementById('effectCatalogList');
    list.innerHTML = '';
    for (const entry of EFFECT_CATALOG) {
        const item = document.createElement('div');
        item.className = 'catalog-item';
        item.innerHTML = `
            <div class="catalog-item-info">
                <span class="catalog-item-label">${entry.label}</span>
                <span class="catalog-item-desc">${entry.description}</span>
            </div>
            <button class="catalog-item-add" title="Add ${entry.label}">+</button>
        `;
        item.querySelector('.catalog-item-add').addEventListener('click', () => {
            saveState();
            const inst = addEffect(entry.name);
            if (inst) _expandedId = inst.id;
            renderStackList();
        });
        list.appendChild(item);
    }
}

export function renderStackList() {
    const container = document.getElementById('effectStackList');
    container.innerHTML = '';
    const stack = getStack();

    // All On toolbar
    const toolbar = document.getElementById('stackToolbar');
    toolbar.innerHTML = '';
    if (stack.length > 0) {
        const enabledEntries = stack
            .map(inst => ({ inst, key: Object.keys(getEffect(inst.effectName)?.params ?? {}).find(k => k.endsWith('Enabled')) }))
            .filter(e => e.key !== undefined);
        const allOn = enabledEntries.length > 0 && enabledEntries.every(e => e.inst.params[e.key]);

        const allOnLabel = document.createElement('label');
        allOnLabel.className = 'checkbox-label';
        const allOnCheck = document.createElement('input');
        allOnCheck.type = 'checkbox';
        allOnCheck.checked = allOn;
        allOnCheck.addEventListener('change', () => {
            saveState();
            enabledEntries.forEach(({ inst, key }) => setInstanceParam(inst.id, key, allOnCheck.checked));
        });
        allOnLabel.appendChild(allOnCheck);
        allOnLabel.appendChild(document.createTextNode(' All On'));
        toolbar.appendChild(allOnLabel);
    }

    if (stack.length === 0) {
        container.innerHTML = '<div class="stack-empty">No effects added yet.<br>Use the list below to add one.</div>';
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

        const isExpanded = inst.id === _expandedId;

        const item = document.createElement('div');
        item.className = 'stack-item';
        item.dataset.id = inst.id;
        item.dataset.index = i;
        // --- Header row ---
        const header = document.createElement('div');
        header.className = 'stack-item-header';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'stack-drag-handle';
        dragHandle.title = 'Drag to reorder';
        dragHandle.innerHTML = '&#8801;';
        dragHandle.addEventListener('pointerdown', () => { item.draggable = true; });
        header.appendChild(dragHandle);

        const labelEl = document.createElement('span');
        labelEl.className = 'stack-item-label';
        labelEl.textContent = label;
        header.appendChild(labelEl);

        // On/Off checkbox
        const effect = getEffect(inst.effectName);
        const enabledKey = effect && Object.keys(effect.params).find(k =>
            k.endsWith('Enabled') && typeof effect.params[k].default === 'boolean'
        );
        if (enabledKey !== undefined) {
            const enableLabel = document.createElement('label');
            enableLabel.className = 'stack-enable-label';
            enableLabel.addEventListener('click', e => e.stopPropagation());
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = inst.params[enabledKey];
            checkbox.addEventListener('change', () => {
                saveState();
                setInstanceParam(inst.id, enabledKey, checkbox.checked);
            });
            enableLabel.appendChild(checkbox);
            header.appendChild(enableLabel);
        }

        // Expand arrow
        const expandArrow = document.createElement('span');
        expandArrow.className = 'stack-item-expand' + (isExpanded ? ' open' : '');
        expandArrow.innerHTML = '&#9656;';
        header.appendChild(expandArrow);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'stack-item-actions';
        actions.innerHTML = `
            <button class="stack-move-btn" data-dir="up" title="Move up">&#8593;</button>
            <button class="stack-move-btn" data-dir="down" title="Move down">&#8595;</button>
            <button class="stack-dup-btn" title="Duplicate">&#10697;</button>
            <button class="stack-delete-btn" title="Remove">&#10005;</button>
        `;
        header.appendChild(actions);

        // --- Collapsible body (controls) ---
        const body = document.createElement('div');
        body.className = 'stack-item-body';
        if (!isExpanded) body.hidden = true;
        if (isExpanded) {
            body.appendChild(buildEffectBody(inst, renderStackList));
        }

        // Toggle expand on header click (not on action buttons, checkbox, or drag handle)
        header.addEventListener('click', (e) => {
            if (e.target.closest('.stack-item-actions, .stack-enable-label, .stack-drag-handle')) return;
            _expandedId = (_expandedId === inst.id) ? null : inst.id;
            renderStackList();
        });

        // Move buttons
        actions.querySelectorAll('.stack-move-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                saveState();
                const dir = btn.dataset.dir;
                const idx = parseInt(item.dataset.index);
                moveEffect(inst.id, dir === 'up' ? idx - 1 : idx + 1);
                renderStackList();
            });
        });

        // Duplicate button
        actions.querySelector('.stack-dup-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            saveState();
            duplicateEffect(inst.id);
            renderStackList();
        });

        // Delete button
        actions.querySelector('.stack-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            saveState();
            if (_expandedId === inst.id) _expandedId = null;
            removeEffect(inst.id);
            renderStackList();
        });

        item.appendChild(header);
        item.appendChild(body);

        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover', onDragOver);
        item.addEventListener('drop', onDrop);
        item.addEventListener('dragend', onDragEnd);

        container.appendChild(item);
    }

    // Show/hide canvas overlays based on which effect is expanded.
    // IMPORTANT: hide functions must run BEFORE show functions — each showXxx calls
    // _activate() which overwrites _mode, making the hide guards fire too late.
    const expandedInst = stack.find(i => i.id === _expandedId);
    const newEffect = expandedInst?.effectName;

    if (newEffect !== 'text')       hideTextOverlay();
    if (newEffect !== 'fade')       hideFadeOverlay();
    if (newEffect !== 'blur')       hideBlurOverlay();
    if (newEffect !== 'crop')       hideCropOverlay();
    if (newEffect !== 'viewport')   hideViewportOverlay();
    if (newEffect !== 'matrixRain') hideMatrixRainOverlay();
    if (newEffect !== 'lineDrag')   hideLineDragOverlay();
    if (newEffect !== 'chroma')     hideChromaOverlay();
    if (newEffect !== 'vignette')   hideVignetteOverlay();
    if (newEffect !== 'crtCurvature') hideCRTCurvatureOverlay();
    if (newEffect !== 'corrupted')     hideCorruptedOverlay();
    if (newEffect !== 'doubleExposure') hideDoubleExposureOverlay();
    if (newEffect !== 'shapeSticker') hideShapeStickerOverlay();

    if      (newEffect === 'text')     showTextOverlay(expandedInst);
    else if (newEffect === 'basic')    showFadeOverlay(expandedInst);
    else if (newEffect === 'blur')     showBlurOverlay(expandedInst);
    else if (newEffect === 'crop')     showCropOverlay(expandedInst);
    else if (newEffect === 'viewport')    showViewportOverlay(expandedInst);
    else if (newEffect === 'matrixRain') showMatrixRainOverlay(expandedInst);
    else if (newEffect === 'lineDrag') showLineDragOverlay(expandedInst);
    else if (newEffect === 'chroma') {
        if (expandedInst.params.chromaMode === 'outline')
            showChromaOverlay(expandedInst);
        else {
            hideChromaOverlay();
            showFadeOverlay(expandedInst, 'chromaFadeX', 'chromaFadeY', 'chromaFadeShape', 'chromaFadeW', 'chromaFadeH', 'chromaFadeAngle', 'chromaFadeEnabled');
        }
    }
    else if (newEffect === 'glow')
        showFadeOverlay(expandedInst, 'glowFadeX', 'glowFadeY', 'glowFadeShape', 'glowFadeW', 'glowFadeH', 'glowFadeAngle', 'glowFadeEnabled');
    else if (newEffect === 'doubleExposure')
        showDoubleExposureOverlay(expandedInst);
    else if (newEffect === 'vignette')  showVignetteOverlay(expandedInst);
    else if (newEffect === 'crtCurvature') showCRTCurvatureOverlay(expandedInst);
    else if (newEffect === 'corrupted') showCorruptedOverlay(expandedInst);
    else if (newEffect === 'shapeSticker') showShapeStickerOverlay(expandedInst);
}

// --- Drag-and-drop ---

let _dragId = null;
let _dropPosition = 'before';

function onDragStart(e) {
    _dragId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    _dropPosition = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    document.querySelectorAll('.stack-item').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    e.currentTarget.classList.add(_dropPosition === 'before' ? 'drop-above' : 'drop-below');
}

function onDrop(e) {
    e.preventDefault();
    const targetId = e.currentTarget.dataset.id;
    e.currentTarget.classList.remove('drop-above', 'drop-below');
    if (!_dragId || _dragId === targetId) return;

    const stack = getStack();
    const targetIndex = stack.findIndex(inst => inst.id === targetId);
    const insertIndex = _dropPosition === 'after' ? targetIndex + 1 : targetIndex;
    saveState();
    moveEffect(_dragId, insertIndex);
    renderStackList();
}

function onDragEnd(e) {
    e.currentTarget.draggable = false;
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.stack-item').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    _dragId = null;
}
