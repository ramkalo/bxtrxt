import { getEffect } from '../effects/registry.js';
import { setInstanceParam, getStack, insertEffect, removeEffect } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { getCustomFonts } from '../state/customFonts.js';
import { getPixelsBeforeInstance } from '../renderer/webgl.js';
import { blendMapImage, glassMapImage, canvas } from '../renderer/glstate.js';
import { toggleBlendMapOverlay, hideBlendMapOverlay } from './canvasPicker.js';
import { buildPaletteSwatchControl, resolveColorKey, getActivePaletteFor } from './controls/paletteColor.js';
import { buildHueGridControl } from './controls/hueGrid.js';

let activeSliderGroup = null;
let _paletteDragSrc = null; // { instId, index } while a palette swatch is being dragged

// Stores a loaded reference image per palette instance (not serialized)
const _paletteImages = new Map();

// Overlay elements for the "Target" from-image mode, keyed by inst.id
const _targetOverlays = new Map();

function _showTargetOverlay(inst) {
    _hideTargetOverlay(inst.id);

    const mainCanvas = document.getElementById('mainCanvas');
    if (!mainCanvas) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;box-sizing:border-box;';
    document.body.appendChild(overlay);

    const box = document.createElement('div');
    box.style.cssText = [
        'position:absolute',
        'pointer-events:all',
        'box-sizing:border-box',
        'border:2px dashed #fff',
        'background:rgba(255,255,255,0.08)',
        'cursor:move',
    ].join(';');
    overlay.appendChild(box);

    const HANDLE_SIZE = 10;
    const corners = ['nw', 'ne', 'sw', 'se'];
    const handles = {};
    for (const c of corners) {
        const h = document.createElement('div');
        h.style.cssText = [
            'position:absolute',
            `width:${HANDLE_SIZE}px`,
            `height:${HANDLE_SIZE}px`,
            'background:#fff',
            'border:1px solid #333',
            'box-sizing:border-box',
            'pointer-events:all',
        ].join(';');
        h.dataset.corner = c;
        if (c === 'nw') { h.style.left = '0'; h.style.top = '0'; h.style.cursor = 'nwse-resize'; h.style.transform = 'translate(-50%,-50%)'; }
        if (c === 'ne') { h.style.right = '0'; h.style.top = '0'; h.style.cursor = 'nesw-resize'; h.style.transform = 'translate(50%,-50%)'; }
        if (c === 'sw') { h.style.left = '0'; h.style.bottom = '0'; h.style.cursor = 'nesw-resize'; h.style.transform = 'translate(-50%,50%)'; }
        if (c === 'se') { h.style.right = '0'; h.style.bottom = '0'; h.style.cursor = 'nwse-resize'; h.style.transform = 'translate(50%,50%)'; }
        box.appendChild(h);
        handles[c] = h;
    }

    // Normalized box state driven by inst params
    let nx = inst.params.paletteTargetX ?? 0.3;
    let ny = inst.params.paletteTargetY ?? 0.3;
    let nw = inst.params.paletteTargetW ?? 0.4;
    let nh = inst.params.paletteTargetH ?? 0.4;

    function syncOverlayPosition() {
        const r = mainCanvas.getBoundingClientRect();
        overlay.style.left   = r.left + 'px';
        overlay.style.top    = r.top  + 'px';
        overlay.style.width  = r.width  + 'px';
        overlay.style.height = r.height + 'px';

        box.style.left   = (nx * r.width)  + 'px';
        box.style.top    = (ny * r.height) + 'px';
        box.style.width  = (nw * r.width)  + 'px';
        box.style.height = (nh * r.height) + 'px';
    }
    syncOverlayPosition();

    function saveBoxParams() {
        setInstanceParam(inst.id, 'paletteTargetX', nx);
        setInstanceParam(inst.id, 'paletteTargetY', ny);
        setInstanceParam(inst.id, 'paletteTargetW', nw);
        setInstanceParam(inst.id, 'paletteTargetH', nh);
    }

    // Drag to move box
    box.addEventListener('mousedown', (e) => {
        if (e.target !== box) return; // don't interfere with handles
        e.preventDefault();
        const r = overlay.getBoundingClientRect();
        const startMx = e.clientX, startMy = e.clientY;
        const startNx = nx, startNy = ny;
        function onMove(ev) {
            const dx = (ev.clientX - startMx) / r.width;
            const dy = (ev.clientY - startMy) / r.height;
            nx = Math.max(0, Math.min(1 - nw, startNx + dx));
            ny = Math.max(0, Math.min(1 - nh, startNy + dy));
            syncOverlayPosition();
        }
        function onUp() {
            saveBoxParams();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Resize handles
    for (const c of corners) {
        handles[c].addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const r = overlay.getBoundingClientRect();
            const startMx = e.clientX, startMy = e.clientY;
            const startNx = nx, startNy = ny, startNw = nw, startNh = nh;
            function onMove(ev) {
                const dx = (ev.clientX - startMx) / r.width;
                const dy = (ev.clientY - startMy) / r.height;
                if (c === 'nw') {
                    nx = Math.max(0, Math.min(startNx + startNw - 0.02, startNx + dx));
                    ny = Math.max(0, Math.min(startNy + startNh - 0.02, startNy + dy));
                    nw = startNw - (nx - startNx);
                    nh = startNh - (ny - startNy);
                } else if (c === 'ne') {
                    ny = Math.max(0, Math.min(startNy + startNh - 0.02, startNy + dy));
                    nw = Math.max(0.02, Math.min(1 - startNx, startNw + dx));
                    nh = startNh - (ny - startNy);
                } else if (c === 'sw') {
                    nx = Math.max(0, Math.min(startNx + startNw - 0.02, startNx + dx));
                    nw = startNw - (nx - startNx);
                    nh = Math.max(0.02, Math.min(1 - startNy, startNh + dy));
                } else if (c === 'se') {
                    nw = Math.max(0.02, Math.min(1 - startNx, startNw + dx));
                    nh = Math.max(0.02, Math.min(1 - startNy, startNh + dy));
                }
                syncOverlayPosition();
            }
            function onUp() {
                saveBoxParams();
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    }

    // Keep overlay aligned when canvas moves/resizes
    const resizeObs = new ResizeObserver(syncOverlayPosition);
    resizeObs.observe(mainCanvas);
    window.addEventListener('resize', syncOverlayPosition);
    window.addEventListener('scroll', syncOverlayPosition, true);

    const token = Symbol();
    _targetOverlays.set(inst.id, { el: overlay, resizeObs, syncOverlayPosition, token });
    return token;
}

function _hideTargetOverlay(instId) {
    const entry = _targetOverlays.get(instId);
    if (!entry) return;
    const { el, resizeObs, syncOverlayPosition } = entry;
    resizeObs.disconnect();
    window.removeEventListener('resize', syncOverlayPosition);
    window.removeEventListener('scroll', syncOverlayPosition, true);
    el.remove();
    _targetOverlays.delete(instId);
}

// Greedy farthest-point sampling: picks `count` maximally distinct colors from a samples array.
function _pickDiverseColors(samples, count = 8) {
    if (!samples.length) return Array.from({ length: count }, () => '#808080');

    const picked = [samples[0]];
    while (picked.length < count) {
        let bestIdx = 0, bestDist = -1;
        for (let i = 0; i < samples.length; i++) {
            const [r, g, b] = samples[i];
            let minDist = Infinity;
            for (const [pr, pg, pb] of picked) {
                const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
                if (d < minDist) minDist = d;
            }
            if (minDist > bestDist) { bestDist = minDist; bestIdx = i; }
        }
        picked.push(samples[bestIdx]);
    }

    return picked.map(([r, g, b]) =>
        '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    );
}

// Collect up to 600 random pixel samples from the region defined by mode.
function _collectSamples(pixels, width, height, mode, targetBox) {
    const samples = [];
    const tries = 1200;
    let accept;

    if (mode === 'perimeter') {
        const border = Math.max(1, Math.floor(width * 0.01));
        accept = (x, y) =>
            x < border || x >= width - border || y < border || y >= height - border;
    } else if (mode === 'center') {
        const half = Math.max(1, Math.floor(width * 0.05));
        const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
        accept = (x, y) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
    } else if (mode === 'target' && targetBox) {
        const tx = Math.round(targetBox.x * width);
        const th = Math.max(1, Math.round(targetBox.h * height));
        const tw = Math.max(1, Math.round(targetBox.w * width));
        // WebGL readPixels has Y=0 at bottom; overlay CSS has Y=0 at top — flip Y
        const ty = Math.round((1 - targetBox.y - targetBox.h) * height);
        accept = (x, y) => x >= tx && x < tx + tw && y >= ty && y < ty + th;
    } else {
        accept = () => true;
    }

    for (let i = 0; i < tries && samples.length < 600; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        if (!accept(x, y)) continue;
        const off = (y * width + x) * 4;
        if (pixels[off + 3] < 128) continue;
        samples.push([pixels[off], pixels[off + 1], pixels[off + 2]]);
    }
    return samples;
}

function _placeRandomNodes(inst) {
    const count = Math.min(24, inst.params.smearTwistRandomCount ?? 8);
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = 100 / cols;
    const cellH = 100 / rows;
    let placed = 0;
    for (let r = 0; r < rows && placed < count; r++) {
        for (let c = 0; c < cols && placed < count; c++) {
            const jx = Math.random() * 0.8 + 0.1;
            const jy = Math.random() * 0.8 + 0.1;
            setInstanceParam(inst.id, `smearTwistNx${placed}`, Math.min(99, Math.round(c * cellW + jx * cellW)));
            setInstanceParam(inst.id, `smearTwistNy${placed}`, Math.min(99, Math.round(r * cellH + jy * cellH)));
            placed++;
        }
    }
    setInstanceParam(inst.id, 'smearTwistNodeCount', placed);
}

// Build all parameter controls for one effect instance into a container div.
export function buildEffectBody(inst, onRebuild) {
    const effect = getEffect(inst.effectName);
    if (!effect) return document.createElement('div');

    const enabledKey = Object.keys(effect.params).find(k =>
        k.endsWith('Enabled') &&
        (effect.params[k].default === true || effect.params[k].default === false)
    );

    const content = document.createElement('div');
    content.className = 'tool-content';

    const rawGroups = typeof effect.uiGroups === 'function' ? effect.uiGroups(inst.params) : effect.uiGroups;
    const groups = rawGroups
        ? rawGroups
        : [{ keys: Object.keys(effect.params).filter(k => k !== enabledKey && k !== 'rotate180' && k !== 'rotate270') }];

    for (const group of groups) {
        if (group.label) {
            const header = document.createElement('div');
            header.className = 'control-section-header';
            header.textContent = group.label;
            content.appendChild(header);
        }

        const condKey = group.conditionKey;
        let subWrapper = null;
        if (condKey) {
            subWrapper = document.createElement('div');
            subWrapper.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
            if (!inst.params[condKey]) subWrapper.style.display = 'none';
        }

        for (const key of group.keys) {
            if (key === enabledKey) continue;
            if (key === 'rotate180' || key === 'rotate270') continue;
            if (effect.handleParams?.includes(key)) continue;
            const schema = effect.params[key];
            if (!schema) continue;
            const controlEl = buildControl(inst, key, schema, onRebuild, group.labels?.[key]);
            if (!controlEl) continue;

            if (condKey && key !== condKey) {
                subWrapper.appendChild(controlEl);
            } else {
                content.appendChild(controlEl);
                if (condKey && key === condKey) {
                    const chk = controlEl.querySelector('input[type="checkbox"]');
                    if (chk) chk.addEventListener('change', () => {
                        subWrapper.style.display = chk.checked ? 'flex' : 'none';
                    });
                    content.appendChild(subWrapper);
                }
            }
        }
    }



    // Generic blend map UI: wires show/hide and image picker for any effect using buildBlendControl
    const blendModeSelects = content.querySelectorAll('[data-inst-param$="BlendMode"]');
    for (const sel of blendModeSelects) {
        const prefix = sel.dataset.instParam.replace('BlendMode', '');
        const mapParams   = ['BlendMapAmount', 'BlendMapScale', 'BlendMapRadius', 'BlendMapInvert'];
        const noMapParams = ['Opacity', 'Threshold', 'ThresholdTarget', 'ThresholdReverse', 'ThresholdOnDest'];

        const pickerRow = document.createElement('div');
        pickerRow.className = 'control-group blend-map-picker';
        pickerRow.innerHTML = `<div class="control-row" style="gap:8px;">
            <button class="btn blend-map-load-btn">Load Blend Map</button>
            <button class="btn blend-map-pos-btn">Position</button>
            <span class="blend-map-image-name" style="font-size:0.75rem;color:var(--text-dim);">${blendMapImage ? blendMapImage.src.split('/').pop().split('?')[0] : 'No image'}</span>
        </div>`;
        pickerRow.querySelector('.blend-map-load-btn').addEventListener('click', () => {
            document.getElementById('blendMapFileInput').click();
        });
        pickerRow.querySelector('.blend-map-pos-btn').addEventListener('click', toggleBlendMapOverlay);

        const firstMapEl = content.querySelector(`[data-inst-param="${prefix}BlendMapAmount"]`)?.closest('.control-group');
        if (firstMapEl) firstMapEl.parentNode.insertBefore(pickerRow, firstMapEl);
        else content.appendChild(pickerRow);

        function updateBlendMapUI() {
            const isMap = sel.value === 'blend_map';
            if (!isMap) hideBlendMapOverlay();
            pickerRow.style.display = isMap ? '' : 'none';
            for (const k of mapParams) {
                const el = content.querySelector(`[data-inst-param="${prefix}${k}"]`)?.closest('.control-group, .checkbox-label');
                if (el) el.style.display = isMap ? '' : 'none';
            }
            for (const k of noMapParams) {
                const el = content.querySelector(`[data-inst-param="${prefix}${k}"]`)?.closest('.control-group, .checkbox-label');
                if (el) el.style.display = isMap ? 'none' : '';
            }
        }

        sel.addEventListener('change', updateBlendMapUI);
        updateBlendMapUI();
    }

    if (inst.effectName === 'glassBlob') {
        const pickerRow = document.createElement('div');
        pickerRow.className = 'control-group glassblob-sky-picker';
        pickerRow.innerHTML = `<div class="control-row" style="gap:8px;">
            <button class="btn glassblob-sky-load-btn">Load Reflection Image</button>
            <span class="glass-map-image-name" style="font-size:0.75rem;color:var(--text-dim);">${glassMapImage ? glassMapImage.src.split('/').pop().split('?')[0] : 'No image'}</span>
        </div>`;
        pickerRow.querySelector('.glassblob-sky-load-btn').addEventListener('click', () => {
            document.getElementById('glassMapFileInput').click();
        });
        content.appendChild(pickerRow);

        const modeSel = content.querySelector('[data-inst-param="glassBlobMode"]');
        function updateSkyUI() {
            const mode = modeSel?.value ?? inst.params.glassBlobMode ?? 'glass';
            pickerRow.style.display = (mode === 'metal') ? '' : 'none';
        }
        modeSel?.addEventListener('change', updateSkyUI);
        updateSkyUI();
    }

    if (inst.effectName === 'hueShift') {
        const SIZE = 160;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;justify-content:center;padding:8px 0 4px;';
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        wrapper.appendChild(canvas);

        function drawHueWheel() {
            const hueRotate = inst.params.hueRotate ?? 0;
            const hueCenter = inst.params.hueCenter ?? 0;
            const hueWidth  = inst.params.hueWidth  ?? 360;

            const ctx = canvas.getContext('2d');
            const cx = SIZE / 2;
            const cy = SIZE / 2;
            const outerR = SIZE * 0.46;
            const innerR = SIZE * 0.20;

            ctx.clearRect(0, 0, SIZE, SIZE);

            // Hue ring (donut)
            for (let h = 0; h < 360; h++) {
                const a1 = ((h - 90) * Math.PI) / 180;
                const a2 = ((h - 89) * Math.PI) / 180;
                ctx.beginPath();
                ctx.moveTo(cx + innerR * Math.cos(a1), cy + innerR * Math.sin(a1));
                ctx.arc(cx, cy, outerR, a1, a2);
                ctx.arc(cx, cy, innerR, a2, a1, true);
                ctx.closePath();
                ctx.fillStyle = `hsl(${h},100%,50%)`;
                ctx.fill();
            }

            // cap at 179 so arc math never degenerates to a full circle
            const halfW = Math.min(hueWidth / 2, 179);
            const toRad = (deg) => ((deg - 90) * Math.PI) / 180;

            // Source slice — yellow tint: "these hues are selected"
            const srcA1 = toRad(hueCenter - halfW);
            const srcA2 = toRad(hueCenter + halfW);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, outerR, srcA1, srcA2);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,220,0,0.38)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,235,80,0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Destination radial line — points outward at the shifted hue
            const dstCenter = ((hueCenter + hueRotate) % 360 + 360) % 360;
            const dstAngle = toRad(dstCenter);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + outerR * Math.cos(dstAngle), cy + outerR * Math.sin(dstAngle));
            ctx.strokeStyle = 'rgba(130,210,255,0.95)';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        content.addEventListener('input', drawHueWheel);
        drawHueWheel();
        content.insertBefore(wrapper, content.firstChild);
    }

    if (inst.effectName === 'doubleExposure') {
        const currentMode = inst.params.doubleExposureMode ?? 'external';

        // Mode selector
        const modeGroup = document.createElement('div');
        modeGroup.className = 'control-group';
        const modeRow = document.createElement('div');
        modeRow.className = 'control-row';
        const modeLabelEl = document.createElement('span');
        modeLabelEl.className = 'control-label';
        modeLabelEl.textContent = 'Image Source';
        const modeSelect = document.createElement('select');
        modeSelect.className = 'select-input';
        modeSelect.style.flex = '1';
        [['external', 'External Image'], ['internal', 'Internal Image']].forEach(([val, text]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = text;
            if (val === currentMode) opt.selected = true;
            modeSelect.appendChild(opt);
        });
        modeRow.appendChild(modeLabelEl);
        modeRow.appendChild(modeSelect);
        modeGroup.appendChild(modeRow);
        content.insertBefore(modeGroup, content.firstChild);

        // External image section (visible only in external mode)
        const extSection = document.createElement('div');
        extSection.style.display = currentMode === 'internal' ? 'none' : '';

        const loadRow = document.createElement('div');
        loadRow.className = 'control-group';
        const loadInner = document.createElement('div');
        loadInner.className = 'control-row';
        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn';
        loadBtn.id = `loadSecondImageBtnStack_${inst.id}`;
        loadBtn.textContent = 'Load 2nd Image';
        loadBtn.addEventListener('click', () => document.getElementById('secondFileInput').click());
        const nameSpan = document.createElement('span');
        nameSpan.id = 'secondImageName';
        nameSpan.style.cssText = 'font-size:0.75rem;color:var(--text-dim);margin-left:8px;';
        nameSpan.textContent = 'No image';
        loadInner.appendChild(loadBtn);
        loadInner.appendChild(nameSpan);
        loadRow.appendChild(loadInner);
        extSection.appendChild(loadRow);

        // Image Opacity slider under the load button
        const origOpacitySchema = getEffect('doubleExposure')?.params?.doubleExposureOrigOpacity;
        if (origOpacitySchema) {
            const opacityEl = buildControl(inst, 'doubleExposureOrigOpacity', origOpacitySchema, onRebuild);
            if (opacityEl) extSection.appendChild(opacityEl);
        }

        content.insertBefore(extSection, modeGroup.nextSibling);

        modeSelect.addEventListener('change', () => {
            const newMode = modeSelect.value;
            saveState();
            setInstanceParam(inst.id, 'doubleExposureMode', newMode);
            extSection.style.display = newMode === 'internal' ? 'none' : '';

            if (newMode === 'internal') {
                if (!inst.params.doubleExposureEntryId) {
                    const entryInst = insertEffect('doubleExposureEntry', inst.id);
                    setInstanceParam(inst.id, 'doubleExposureEntryId', entryInst.id);
                }
            } else {
                const entryId = inst.params.doubleExposureEntryId;
                if (entryId) {
                    removeEffect(entryId);
                    setInstanceParam(inst.id, 'doubleExposureEntryId', null);
                }
            }

            if (onRebuild) onRebuild();
        });
    }

    if (inst.effectName === 'colorRemap') {
        const mode = inst.params.invertMode ?? 'luminance';

        const modeSelect = content.querySelector('[data-inst-param="invertMode"]');
        modeSelect?.addEventListener('change', () => { if (onRebuild) onRebuild(); });

        // Hue Remap: 2D grid color-region picker (replaces the old linear stops).
        if (mode === 'hue') {
            const gridCtl = buildHueGridControl(inst, { onRebuild });
            const outputGroup = content.querySelector('[data-inst-param="invertGridOutput"]')?.closest('.control-group');
            if (outputGroup) outputGroup.after(gridCtl);
            else content.appendChild(gridCtl);
            return content;
        }

        const colorBGroup = content.querySelector('.control-group[data-inst-param="invertColorB"]');
        // The five color swatch-strip groups, in stop order. Their ✕ ("None")
        // swatch toggles optional stops C/D/E on/off (no separate checkbox).
        const colorGroups = ['invertColorA','invertColorC','invertColorD','invertColorE','invertColorB']
            .map(k => content.querySelector(`.control-group[data-inst-param="${k}"]`));
        const refreshStrips = () => { for (const g of colorGroups) g?._refreshSwatches?.(); };

        const contrastColor = (hex) => {
            const r = parseInt(hex.slice(1,3),16);
            const g = parseInt(hex.slice(3,5),16);
            const b = parseInt(hex.slice(5,7),16);
            return (0.299*r + 0.587*g + 0.114*b) > 128 ? '#000000' : '#ffffff';
        };
        const resolveInvertHex = (key) => resolveColorKey(key, getActivePaletteFor(inst.id));

        if (mode !== 'simple') {

            // --- stop-positions slider ---
            const STOP_DEFS = [
                { posKey: 'invertPosA', colorKey: 'invertColorA', label: '1', defaultPos: 0    },
                { posKey: 'invertPosC', colorKey: 'invertColorC', label: '2', defaultPos: 0.25 },
                { posKey: 'invertPosD', colorKey: 'invertColorD', label: '3', defaultPos: 0.5  },
                { posKey: 'invertPosE', colorKey: 'invertColorE', label: '4', defaultPos: 0.75 },
                { posKey: 'invertPosB', colorKey: 'invertColorB', label: '5', defaultPos: 1    },
            ];
            const getStopPos   = (i) => inst.params[STOP_DEFS[i].posKey] ?? STOP_DEFS[i].defaultPos;
            const isStopActive = (i) => i === 0 || i === 4 || inst.params[STOP_DEFS[i].colorKey] !== 'none';

            const sliderGroup = document.createElement('div');
            sliderGroup.className = 'control-group';
            const sliderRow = document.createElement('div');
            sliderRow.className = 'control-row';
            sliderRow.style.cssText = 'flex-direction:column;align-items:stretch;gap:2px;';

            const sliderLabel = document.createElement('span');
            sliderLabel.className = 'control-label';
            sliderLabel.textContent = 'Stop Positions';

            const trackWrap = document.createElement('div');
            trackWrap.style.cssText = 'position:relative;height:20px;margin:4px 6px;';

            const trackBg = document.createElement('div');
            trackBg.style.cssText = 'position:absolute;inset:0;border-radius:4px;border:1px solid var(--border);pointer-events:none;';
            trackWrap.appendChild(trackBg);

            const handles = STOP_DEFS.map((def, i) => {
                const h = document.createElement('div');
                h.style.cssText = 'position:absolute;top:-2px;width:12px;height:24px;transform:translateX(-50%);border-radius:3px;border:2px solid rgba(255,255,255,0.5);cursor:ew-resize;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;user-select:none;box-sizing:border-box;';
                h.textContent = def.label;
                trackWrap.appendChild(h);
                return h;
            });

            const updateSlider = () => {
                const gradParts = [];
                for (let i = 0; i < 5; i++) {
                    if (!isStopActive(i)) continue;
                    const hex = resolveInvertHex(inst.params[STOP_DEFS[i].colorKey]) ?? '#808080';
                    gradParts.push(`${hex} ${(getStopPos(i) * 100).toFixed(1)}%`);
                }
                trackBg.style.background = gradParts.length > 1
                    ? `linear-gradient(to right, ${gradParts.join(', ')})`
                    : 'var(--bg-2)';

                for (let i = 0; i < 5; i++) {
                    const active = isStopActive(i);
                    handles[i].style.display = active ? 'flex' : 'none';
                    if (!active) continue;
                    handles[i].style.left = `${getStopPos(i) * 100}%`;
                    const hex = resolveInvertHex(inst.params[STOP_DEFS[i].colorKey]) ?? '#808080';
                    const fg  = contrastColor(hex);
                    handles[i].style.backgroundColor = hex;
                    handles[i].style.color = fg;
                    handles[i].style.borderColor = fg === '#000000' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)';
                }
            };

            // drag-past swap: shared drag state so color identity follows the cursor across handles
            const dragState = { active: false, idx: -1 };

            for (let i = 0; i < 5; i++) {
                handles[i].addEventListener('pointerdown', (e) => {
                    if (!isStopActive(i)) return;
                    e.preventDefault();
                    handles[i].setPointerCapture(e.pointerId);
                    saveState();
                    dragState.active = true;
                    dragState.idx = i;
                });
                handles[i].addEventListener('pointermove', (e) => {
                    if (!dragState.active) return;
                    const rect = trackWrap.getBoundingClientRect();
                    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

                    // swap colors when crossing an adjacent active stop; loop handles fast drags
                    let swapped = true;
                    while (swapped) {
                        swapped = false;
                        const di = dragState.idx;
                        for (let j = di + 1; j < 5; j++) {
                            if (!isStopActive(j)) continue;
                            if (newPos >= getStopPos(j)) {
                                const ca = inst.params[STOP_DEFS[di].colorKey];
                                const cb = inst.params[STOP_DEFS[j].colorKey];
                                setInstanceParam(inst.id, STOP_DEFS[di].colorKey, cb);
                                setInstanceParam(inst.id, STOP_DEFS[j].colorKey, ca);
                                dragState.idx = j;
                                swapped = true;
                            }
                            break;
                        }
                        const di2 = dragState.idx;
                        for (let j = di2 - 1; j >= 0; j--) {
                            if (!isStopActive(j)) continue;
                            if (newPos <= getStopPos(j)) {
                                const ca = inst.params[STOP_DEFS[di2].colorKey];
                                const cb = inst.params[STOP_DEFS[j].colorKey];
                                setInstanceParam(inst.id, STOP_DEFS[di2].colorKey, cb);
                                setInstanceParam(inst.id, STOP_DEFS[j].colorKey, ca);
                                dragState.idx = j;
                                swapped = true;
                            }
                            break;
                        }
                    }

                    setInstanceParam(inst.id, STOP_DEFS[dragState.idx].posKey, Math.round(newPos * 1000) / 1000);
                    updateSlider();
                    refreshStrips();
                });
                handles[i].addEventListener('pointerup',          () => { dragState.active = false; dragState.idx = -1; });
                handles[i].addEventListener('lostpointercapture', () => { dragState.active = false; dragState.idx = -1; });
            }

            sliderRow.appendChild(sliderLabel);
            sliderRow.appendChild(trackWrap);

            const gradBar = document.createElement('div');
            gradBar.style.cssText = 'height:6px;border-radius:3px;border:1px solid var(--border);margin:2px 6px 4px;pointer-events:none;';
            gradBar.style.background = mode === 'hue'
                ? 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
                : 'linear-gradient(to right, #000, #fff)';
            sliderRow.appendChild(gradBar);

            sliderGroup.appendChild(sliderRow);

            if (colorBGroup) colorBGroup.after(sliderGroup);
            else content.appendChild(sliderGroup);

            updateSlider();

            // --- randomize + palette sort buttons ---
            const randomizeRow = document.createElement('div');
            randomizeRow.className = 'control-group';
            randomizeRow.innerHTML = `<div class="control-row" style="gap:6px;"><button class="btn">⚄ Shuffle Palette</button><button class="btn">Palette Sort</button></div>`;
            const randomizeBtn = randomizeRow.querySelector('button');
            randomizeBtn.addEventListener('click', () => {
                const palette = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
                for (let i = palette.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [palette[i], palette[j]] = [palette[j], palette[i]];
                }
                saveState();
                setInstanceParam(inst.id, 'invertColorA', palette[0]);
                setInstanceParam(inst.id, 'invertColorB', palette[1]);
                setInstanceParam(inst.id, 'invertColorC', Math.random() < 0.88 ? palette[2] : 'none');
                setInstanceParam(inst.id, 'invertColorD', Math.random() < 0.88 ? palette[3] : 'none');
                setInstanceParam(inst.id, 'invertColorE', Math.random() < 0.88 ? palette[4] : 'none');
                if (onRebuild) onRebuild();
            });
            const paletteSortBtn = randomizeRow.querySelectorAll('button')[1];
            paletteSortBtn.addEventListener('click', () => {
                saveState();
                setInstanceParam(inst.id, 'invertColorA', 'p7');
                setInstanceParam(inst.id, 'invertColorC', 'p5');
                setInstanceParam(inst.id, 'invertColorD', 'p3');
                setInstanceParam(inst.id, 'invertColorE', 'p1');
                setInstanceParam(inst.id, 'invertColorB', 'p0');
                if (onRebuild) onRebuild();
            });
            sliderGroup.after(randomizeRow);

            // Color swatch clicks rebuild the panel (via onRebuild), refreshing the
            // slider. Palette edits only fire paletteupdate — the strips self-refresh;
            // keep the slider gradient in sync here too.
            document.addEventListener('paletteupdate', function onPU() {
                if (!document.contains(trackWrap)) { document.removeEventListener('paletteupdate', onPU); return; }
                updateSlider();
            });
        }
    }

    if (inst.effectName === 'text') {
        // textColor is now a swatch strip; picking a swatch rebuilds the panel
        // (onRebuild), so reflect the noise-randomize button from the param value.
        const randomizeGroup  = content.querySelector('[data-key="textNoiseRandomize"]');
        const noiseValues     = new Set(['greyNoise', 'colorNoise', 'paletteNoise']);
        if (randomizeGroup) {
            randomizeGroup.style.display = noiseValues.has(inst.params.textColor) ? '' : 'none';
        }
    }

    // Mesh and Tunnel color selectors are now palette-aware swatch strips
    // (type: 'paletteSelect'); the strip control handles live palette updates
    // and the ✕ ("None") swatch for tunnel's optional stops, so no per-effect
    // styling code is needed here anymore.

    if (inst.effectName === 'smearTwist') {
        const placementGroup = content.querySelector('[data-inst-param="smearTwistNodeMode"]')?.closest('.control-group');
        let insertAfter = placementGroup;

        const inject = (el) => {
            if (insertAfter) {
                insertAfter.insertAdjacentElement('afterend', el);
            } else {
                const fadeHeader = content.querySelector('.control-section-header');
                fadeHeader ? content.insertBefore(el, fadeHeader) : content.appendChild(el);
            }
            insertAfter = el;
        };

        if ((inst.params.smearTwistNodeMode ?? 'manual') === 'random') {
            const randomPanel = document.createElement('div');
            randomPanel.className = 'control-group';
            const randomBtn = document.createElement('button');
            randomBtn.className = 'action-btn';
            randomBtn.textContent = 'Randomize Nodes';
            randomBtn.addEventListener('click', () => {
                saveState();
                _placeRandomNodes(inst);
                onRebuild?.();
            });
            randomPanel.appendChild(randomBtn);
            inject(randomPanel);
        }

        const panel = document.createElement('div');
        panel.className = 'control-group';
        const clearBtn = document.createElement('button');
        clearBtn.className = 'action-btn';
        clearBtn.textContent = 'Clear All Nodes';
        clearBtn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, 'smearTwistNodeCount', 0);
            onRebuild?.();
        });
        panel.appendChild(clearBtn);
        const countLabel = document.createElement('span');
        countLabel.style.cssText = 'font-size:0.75rem;color:var(--text-dim);display:block;margin-top:4px;';
        countLabel.textContent = `Nodes placed: ${inst.params.smearTwistNodeCount ?? 0}`;
        panel.appendChild(countLabel);
        inject(panel);
    }

    if (inst.effectName === 'filmSoup') {
        const soups  = getStack().filter(s => s.effectName === 'filmSoup');
        const others = soups.filter(s => s.id !== inst.id);

        const panel = document.createElement('div');
        panel.className = 'control-group';

        const header = document.createElement('div');
        header.className = 'control-section-header';
        header.textContent = 'Match Bubbles To';
        panel.appendChild(header);

        const row = document.createElement('div');
        row.className = 'control-row';
        row.style.gap = '6px';

        const sel = document.createElement('select');
        sel.className = 'select-input';
        for (const o of others) {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = `Film Soup ${soups.indexOf(o) + 1}`;
            sel.appendChild(opt);
        }

        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = 'Match';

        if (others.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = '(no other Film Soup)';
            sel.appendChild(opt);
            sel.disabled = true;
            btn.disabled = true;
        }

        // Copy layout-only params (position + size); leave edge/vignette/melt/blend independent.
        const LAYOUT_KEYS = [
            'filmSoupSeed', 'filmSoupPlace', 'filmSoupBubbles', 'filmSoupSize', 'filmSoupSizeDev',
            'filmSoupNum', 'filmSoupDistribution', 'filmSoupCenterX', 'filmSoupCenterY', 'filmSoupElongate',
        ];
        btn.addEventListener('click', () => {
            const target = getStack().find(s => s.id === sel.value);
            if (!target) return;
            saveState();
            for (const key of LAYOUT_KEYS) setInstanceParam(inst.id, key, target.params[key]);
            onRebuild?.();
        });

        row.appendChild(sel);
        row.appendChild(btn);
        panel.appendChild(row);
        content.appendChild(panel);
    }

    return content;
}

function buildControl(inst, key, schema, onRebuild, labelOverride) {
    if (schema.hidden) return null;
    const label = labelOverride ?? schema.label ?? key;
    const currentVal = inst.params[key];

    // Palette action buttons row — Randomize + region selector + From Image
    if (key === 'paletteRandomize') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'paletteRandomize';

        const row = document.createElement('div');
        row.className = 'control-row';
        row.style.gap = '6px';

        const isCustom = inst.params.palettePreset === 'custom';

        const randomBtn = document.createElement('button');
        randomBtn.className = 'btn';
        randomBtn.textContent = label;
        randomBtn.disabled = !isCustom;
        randomBtn.addEventListener('click', () => {
            saveState();
            for (let i = 0; i < 8; i++) {
                const hex = '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
                setInstanceParam(inst.id, `palette${i}`, hex);
            }
            if (onRebuild) onRebuild();
        });

        const modeRow = document.createElement('div');
        modeRow.className = 'control-row';
        modeRow.style.gap = '6px';

        const modeSel = document.createElement('select');
        modeSel.className = 'select-input';
        modeSel.style.flex = '1';
        [['whole', 'Whole Image'], ['perimeter', 'Perimeter'], ['center', 'Center'], ['target', 'Target']].forEach(([val, lbl]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = lbl;
            modeSel.appendChild(opt);
        });
        modeSel.value = inst.params.paletteFromImageMode ?? 'whole';
        modeSel.addEventListener('change', () => {
            setInstanceParam(inst.id, 'paletteFromImageMode', modeSel.value);
            if (modeSel.value === 'target') {
                overlayToken = _showTargetOverlay(inst);
            } else {
                overlayToken = null;
                _hideTargetOverlay(inst.id);
            }
        });

        const fromImageBtn = document.createElement('button');
        fromImageBtn.className = 'btn';
        fromImageBtn.textContent = 'From Image';
        fromImageBtn.addEventListener('click', () => {
            const result = getPixelsBeforeInstance(getStack(), inst.id);
            if (!result) return;
            const mode = inst.params.paletteFromImageMode ?? 'whole';
            const targetBox = {
                x: inst.params.paletteTargetX ?? 0.3,
                y: inst.params.paletteTargetY ?? 0.3,
                w: inst.params.paletteTargetW ?? 0.4,
                h: inst.params.paletteTargetH ?? 0.4,
            };
            const samples = _collectSamples(result.pixels, result.width, result.height, mode, targetBox);
            const colors = _pickDiverseColors(samples);
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, colors[i]);
            }
            if (onRebuild) onRebuild();
        });

        modeRow.appendChild(fromImageBtn);
        modeRow.appendChild(modeSel);
        row.appendChild(randomBtn);
        group.appendChild(row);
        group.appendChild(modeRow);

        // Show overlay if already in target mode when control is built
        let overlayToken = null;
        if ((inst.params.paletteFromImageMode ?? 'whole') === 'target') {
            overlayToken = _showTargetOverlay(inst);
        }

        // Remove overlay when this control group leaves the DOM for good.
        // Use a token to avoid killing a newer overlay created by a concurrent rebuild.
        const observer = new MutationObserver(() => {
            if (!document.contains(group)) {
                const entry = _targetOverlays.get(inst.id);
                if (entry?.token === overlayToken) _hideTargetOverlay(inst.id);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        return group;
    }

    // Sort palette colors brightest → darkest by relative luminance
    if (key === 'paletteSortByLuminance') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'paletteSortByLuminance';
        const row = document.createElement('div');
        row.className = 'control-row';
        const sortBtn = document.createElement('button');
        sortBtn.className = 'btn';
        sortBtn.textContent = label;
        sortBtn.addEventListener('click', () => {
            const colors = Array.from({ length: 8 }, (_, i) => inst.params[`palette${i}`] ?? '#000000');
            const luminance = (hex) => {
                const r = parseInt(hex.slice(1, 3), 16) / 255;
                const g = parseInt(hex.slice(3, 5), 16) / 255;
                const b = parseInt(hex.slice(5, 7), 16) / 255;
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const sorted = [...colors].sort((a, b) => luminance(b) - luminance(a));
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, sorted[i]);
            }
            if (onRebuild) onRebuild();
        });

        const reverseBtn = document.createElement('button');
        reverseBtn.className = 'btn';
        reverseBtn.textContent = 'Reverse Order';
        reverseBtn.addEventListener('click', () => {
            const colors = Array.from({ length: 8 }, (_, i) => inst.params[`palette${i}`] ?? '#000000');
            const reversed = [...colors].reverse();
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, reversed[i]);
            }
            if (onRebuild) onRebuild();
        });

        const shuffleBtn = document.createElement('button');
        shuffleBtn.className = 'btn';
        shuffleBtn.textContent = 'Shuffle Order';
        shuffleBtn.addEventListener('click', () => {
            const colors = Array.from({ length: 8 }, (_, i) => inst.params[`palette${i}`] ?? '#000000');
            for (let i = colors.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [colors[i], colors[j]] = [colors[j], colors[i]];
            }
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, colors[i]);
            }
            if (onRebuild) onRebuild();
        });

        row.appendChild(sortBtn);
        row.appendChild(reverseBtn);
        row.appendChild(shuffleBtn);
        group.appendChild(row);
        return group;
    }

    // Copy Hex button — appears below the 8 color pickers
    if (key === 'paletteCopyHex') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'paletteCopyHex';
        const row = document.createElement('div');
        row.className = 'control-row';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn';
        copyBtn.textContent = 'Copy Hex';
        copyBtn.addEventListener('click', () => {
            const hex = Array.from({ length: 8 }, (_, i) => inst.params[`palette${i}`] ?? '').join(' ');
            navigator.clipboard.writeText(hex);
        });
        row.appendChild(copyBtn);
        group.appendChild(row);
        return group;
    }

    // Paste hex codes → update palette
    if (key === 'palettePaste') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'palettePaste';
        const row = document.createElement('div');
        row.className = 'control-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'enter up to 8 hex codes (e.g. #ff0000)';
        input.style.flex = '1';
        input.addEventListener('input', () => {
            const matches = (input.value.match(/#[0-9a-fA-F]{3,6}/g) ?? [])
                .map(h => h.length === 4
                    ? '#' + h[1]+h[1]+h[2]+h[2]+h[3]+h[3]
                    : h.length === 7 ? h : null)
                .filter(Boolean);
            if (matches.length < 1) return;
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < Math.min(matches.length, 8); i++) {
                setInstanceParam(inst.id, `palette${i}`, matches[i]);
                // Update color swatch + hex label in the DOM without rebuilding
                const swatch = group.parentElement?.querySelector(`input[data-inst-param="palette${i}"]`);
                if (swatch) {
                    swatch.value = matches[i];
                    const span = swatch.nextElementSibling;
                    if (span) span.textContent = matches[i];
                }
            }
        });
        row.appendChild(input);
        group.appendChild(row);
        return group;
    }

    // Load a reference image for palette sampling
    if (key === 'paletteLoadImage') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'paletteLoadImage';
        const row = document.createElement('div');
        row.className = 'control-row';
        row.style.gap = '6px';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn';
        loadBtn.textContent = label;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'font-size:0.7rem;font-family:monospace;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        const stored = _paletteImages.get(inst.id);
        nameSpan.textContent = stored ? (stored._filename ?? 'loaded') : '';

        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            createImageBitmap(file).then(bitmap => {
                const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
                offscreen.getContext('2d').drawImage(bitmap, 0, 0);
                offscreen._filename = file.name;
                _paletteImages.set(inst.id, offscreen);
                nameSpan.textContent = file.name;
                bitmap.close();
            });
        });

        loadBtn.addEventListener('click', () => fileInput.click());
        row.appendChild(fileInput);
        row.appendChild(loadBtn);
        row.appendChild(nameSpan);
        group.appendChild(row);
        return group;
    }

    // Sample palette colors from the loaded reference image
    if (key === 'palettePullFromImage') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'palettePullFromImage';
        const row = document.createElement('div');
        row.className = 'control-row';
        const pullBtn = document.createElement('button');
        pullBtn.className = 'btn';
        pullBtn.textContent = label;
        pullBtn.addEventListener('click', () => {
            const offscreen = _paletteImages.get(inst.id);
            if (!offscreen) return;
            const ctx2d = offscreen.getContext('2d');
            const imgData = ctx2d.getImageData(0, 0, offscreen.width, offscreen.height);
            const colors = _pickDiverseColors(_collectSamples(imgData.data, offscreen.width, offscreen.height, 'whole', null));
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, colors[i]);
            }
            if (onRebuild) onRebuild();
        });
        row.appendChild(pullBtn);
        group.appendChild(row);
        return group;
    }

    // Action button — schema.button names the param to randomize when clicked
    if (schema.button) {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, schema.button, Math.floor(Math.random() * 999) + 1);
        });
        row.appendChild(btn);
        group.appendChild(row);
        return group;
    }

    // Reset Box button for mesh effect
    if (key === 'meshResetBox') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, 'meshTLx', 10);
            setInstanceParam(inst.id, 'meshTLy', 10);
            setInstanceParam(inst.id, 'meshTRx', 90);
            setInstanceParam(inst.id, 'meshTRy', 10);
            setInstanceParam(inst.id, 'meshBRx', 90);
            setInstanceParam(inst.id, 'meshBRy', 90);
            setInstanceParam(inst.id, 'meshBLx', 10);
            setInstanceParam(inst.id, 'meshBLy', 90);
            setInstanceParam(inst.id, 'meshScale', 1);
            setInstanceParam(inst.id, 'meshRotate', 0);
            if (onRebuild) onRebuild();
        });
        row.appendChild(btn);
        group.appendChild(row);
        return group;
    }

    // Reset Box button for text effect
    if (key === 'textBoxReset') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, 'textTLx', 10);
            setInstanceParam(inst.id, 'textTLy', 65);
            setInstanceParam(inst.id, 'textTRx', 90);
            setInstanceParam(inst.id, 'textTRy', 65);
            setInstanceParam(inst.id, 'textBRx', 90);
            setInstanceParam(inst.id, 'textBRy', 95);
            setInstanceParam(inst.id, 'textBLx', 10);
            setInstanceParam(inst.id, 'textBLy', 95);
        });
        row.appendChild(btn);
        group.appendChild(row);
        return group;
    }

    // Noise randomize button for text effect
    if (key === 'textNoiseRandomize') {
        const group = document.createElement('div');
        group.className = 'control-group';
        group.dataset.key = 'textNoiseRandomize';
        const row = document.createElement('div');
        row.className = 'control-row';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, 'textNoiseSeed', Math.floor(Math.random() * 999999) + 1);
        });
        row.appendChild(btn);
        group.appendChild(row);
        return group;
    }

    // Rotate checkboxes (radio-like - only one can be checked)
    if (key === 'rotate90') {
        const group = document.createElement('div');
        group.className = 'control-group';
        
        const row = document.createElement('div');
        row.className = 'control-row';
        
        const rotations = [
            { key: 'rotate90', label: '90°' },
            { key: 'rotate180', label: '180°' },
            { key: 'rotate270', label: '270°' },
        ];
        
        for (const r of rotations) {
            const wrapper = document.createElement('label');
            wrapper.className = 'checkbox-label';
            wrapper.style.marginRight = '12px';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = inst.params[r.key];
            checkbox.addEventListener('change', () => {
                saveState();
                if (checkbox.checked) {
                    for (const r2 of rotations) {
                        setInstanceParam(inst.id, r2.key, r2.key === r.key);
                    }
                } else {
                    for (const r2 of rotations) {
                        setInstanceParam(inst.id, r2.key, false);
                    }
                }
                if (onRebuild) onRebuild();
            });
            
            wrapper.appendChild(checkbox);
            wrapper.appendChild(document.createTextNode(' ' + r.label));
            row.appendChild(wrapper);
        }
        
        group.appendChild(row);
        return group;
    }

    // Boolean → checkbox
    if (schema.default === false || schema.default === true) {
        const wrapper = document.createElement('label');
        wrapper.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = currentVal;
        checkbox.dataset.instParam = key;
        checkbox.addEventListener('change', () => {
            saveState();
            setInstanceParam(inst.id, key, checkbox.checked);
        });
        wrapper.appendChild(checkbox);
        wrapper.appendChild(document.createTextNode(' ' + label));
        return wrapper;
    }

    // Palette-aware swatch strip → shared control
    if (schema.type === 'paletteSelect') {
        return buildPaletteSwatchControl(inst, key, schema, { onRebuild });
    }

    // Enum → select
    if (schema.options) {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const select = document.createElement('select');
        select.dataset.instParam = key;
        for (const [val, text] of schema.options) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = text;
            if (val === currentVal) opt.selected = true;
            select.appendChild(opt);
        }
        if (schema.fontSelector) {
            const customs = getCustomFonts();
            if (customs.length) {
                const divider = document.createElement('option');
                divider.disabled = true;
                divider.textContent = '── Custom Fonts ──';
                select.appendChild(divider);
                for (const { name, label: fontLabel } of customs) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = fontLabel;
                    if (name === currentVal) opt.selected = true;
                    select.appendChild(opt);
                }
            }
        }
        select.addEventListener('change', () => {
            saveState();
            const prevValue = inst.params[key];
            setInstanceParam(inst.id, key, select.value);
            const actionEffect = getEffect(inst.effectName);
            const action = actionEffect?.paramActions?.[key];
            if (action) {
                const updates = action(select.value, inst.params, prevValue);
                for (const [k, v] of Object.entries(updates)) {
                    setInstanceParam(inst.id, k, v);
                }
            }
            if (onRebuild) onRebuild();
        });
        row.appendChild(labelEl);
        row.appendChild(select);
        group.appendChild(row);
        return group;
    }

    // Textarea for multi-line text entry
    if (key === 'matrixRainText' || key === 'text') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const labelEl = document.createElement('div');
        labelEl.className = 'control-section-header';
        labelEl.style.cssText = 'font-size:0.75rem;margin-bottom:2px;';
        labelEl.textContent = label;
        const textarea = document.createElement('textarea');
        textarea.value = currentVal;
        textarea.rows = 4;
        textarea.dataset.instParam = key;
        textarea.style.cssText = 'width:100%;resize:vertical;box-sizing:border-box;font-size:0.8rem;';
        if (key === 'text') textarea.maxLength = 5000;
        textarea.addEventListener('input', () => {
            setInstanceParam(inst.id, key, textarea.value);
        });
        group.appendChild(labelEl);
        group.appendChild(textarea);
        if (key === 'text') {
            const tsBtn = document.createElement('button');
            tsBtn.className = 'btn';
            tsBtn.textContent = 'Timestamp';
            tsBtn.style.cssText = 'padding:2px 8px;font-size:0.7rem;margin-top:4px;width:fit-content;';
            tsBtn.addEventListener('click', () => {
                const now = new Date();
                const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                const ts = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2,'0')} ${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                setInstanceParam(inst.id, key, ts);
                textarea.value = ts;
            });
            group.appendChild(tsBtn);
        }
        return group;
    }

    // Seed → Randomize button
    if (key === 'lineGlitchTrackingSeed' || key === 'corruptedSeed' || key === 'corruptedZoneSeed'
        || key === 'matrixRainInjectSeed') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = 'Randomize';
        btn.addEventListener('click', () => {
            saveState();
            setInstanceParam(inst.id, key, Math.floor(Math.random() * 99998) + 1);
        });
        row.appendChild(labelEl);
        row.appendChild(btn);
        group.appendChild(row);
        return group;
    }

    // Color picker → <input type="color"> with inline hex label
    if (schema.type === 'color') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const input = document.createElement('input');
        input.type = 'color';
        input.value = currentVal;
        input.dataset.instParam = key;
        const hexSpan = document.createElement('span');
        hexSpan.textContent = currentVal;
        hexSpan.style.cssText = 'font-size:0.7rem;font-family:monospace;color:var(--text-dim);min-width:4.5ch;';
        input.addEventListener('input', () => {
            setInstanceParam(inst.id, key, input.value);
            hexSpan.textContent = input.value;
            // If this effect has a preset selector, reset it to 'custom' on manual edits
            const colorEffect = getEffect(inst.effectName);
            if (colorEffect?.params?.palettePreset && inst.params.palettePreset !== 'custom') {
                setInstanceParam(inst.id, 'palettePreset', 'custom');
                const container = input.closest('.tool-content');
                const presetSelect = container?.querySelector('[data-inst-param="palettePreset"]');
                if (presetSelect) presetSelect.value = 'custom';
            }
            if (inst.effectName === 'colorPalette') {
                document.dispatchEvent(new CustomEvent('paletteupdate'));
            }
        });
        row.appendChild(labelEl);
        row.appendChild(input);
        row.appendChild(hexSpan);
        group.appendChild(row);

        // Drag-to-swap for palette color slots
        if (/^palette[0-7]$/.test(key)) {
            const paletteIndex = parseInt(key.slice(-1));

            const randBtn = document.createElement('button');
            randBtn.className = 'btn btn-sm';
            randBtn.textContent = '?';
            randBtn.title = 'Randomize this color';
            randBtn.style.cssText = 'padding:2px 6px;font-size:0.7rem;flex-shrink:0;';
            randBtn.addEventListener('click', () => {
                const hex = '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
                saveState();
                setInstanceParam(inst.id, 'palettePreset', 'custom');
                setInstanceParam(inst.id, key, hex);
                input.value = hex;
                hexSpan.textContent = hex;
                if (inst.effectName === 'colorPalette') {
                    document.dispatchEvent(new CustomEvent('paletteupdate'));
                }
            });
            row.appendChild(randBtn);

            // Eyedropper — pick a color from the image (native EyeDropper API).
            if ('EyeDropper' in window) {
                const pickBtn = document.createElement('button');
                pickBtn.className = 'btn btn-sm';
                pickBtn.title = 'Pick color from image';
                pickBtn.style.cssText = 'padding:2px 6px;font-size:0.7rem;flex-shrink:0;display:inline-flex;align-items:center;';
                pickBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
                pickBtn.addEventListener('click', async () => {
                    let result;
                    try {
                        result = await new window.EyeDropper().open();
                    } catch { return; } // user cancelled (Esc)
                    const hex = result?.sRGBHex;
                    if (!hex) return;
                    saveState();
                    setInstanceParam(inst.id, 'palettePreset', 'custom');
                    setInstanceParam(inst.id, key, hex);
                    input.value = hex;
                    hexSpan.textContent = hex;
                    if (inst.effectName === 'colorPalette') {
                        document.dispatchEvent(new CustomEvent('paletteupdate'));
                    }
                });
                row.appendChild(pickBtn);
            }

            const handle = document.createElement('span');
            handle.textContent = '⠿';
            handle.style.cssText = 'cursor:grab;color:var(--text-dim);font-size:1rem;padding-right:4px;user-select:none;flex-shrink:0;';
            row.insertBefore(handle, row.firstChild);

            group.draggable = true;

            group.addEventListener('dragstart', (e) => {
                _paletteDragSrc = { instId: inst.id, index: paletteIndex };
                e.dataTransfer.effectAllowed = 'move';
                // defer so the browser snapshot doesn't capture the dimmed state
                requestAnimationFrame(() => { group.style.opacity = '0.4'; });
            });

            group.addEventListener('dragend', () => {
                group.style.opacity = '';
                group.style.outline = '';
            });

            group.addEventListener('dragover', (e) => {
                if (!_paletteDragSrc || _paletteDragSrc.instId !== inst.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                group.style.outline = '1px solid var(--accent, #888)';
            });

            group.addEventListener('dragleave', () => {
                group.style.outline = '';
            });

            group.addEventListener('drop', (e) => {
                e.preventDefault();
                group.style.outline = '';
                if (!_paletteDragSrc || _paletteDragSrc.instId !== inst.id) return;
                const srcIdx = _paletteDragSrc.index;
                _paletteDragSrc = null;
                if (srcIdx === paletteIndex) return;
                const srcColor = inst.params[`palette${srcIdx}`];
                const dstColor = inst.params[`palette${paletteIndex}`];
                saveState();
                setInstanceParam(inst.id, `palette${srcIdx}`, dstColor);
                setInstanceParam(inst.id, `palette${paletteIndex}`, srcColor);
                if (onRebuild) onRebuild();
            });
        }

        return group;
    }

    // String (free-text) → text input
    if (typeof schema.default === 'string') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentVal;
        input.dataset.instParam = key;
        input.style.cssText = 'width:120px;';
        input.addEventListener('input', () => {
            setInstanceParam(inst.id, key, input.value);
        });
        row.appendChild(labelEl);
        row.appendChild(input);

        if (schema.info) {
            const infoBtn = document.createElement('button');
            infoBtn.className = 'btn';
            infoBtn.textContent = 'i';
            infoBtn.title = 'Formula help';
            infoBtn.style.cssText = 'width:20px;height:20px;padding:0;border-radius:50%;font-size:0.7rem;font-style:italic;font-weight:700;flex-shrink:0;line-height:1;';
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.formula-info-popup').forEach(el => el.remove());
                const popup = document.createElement('div');
                popup.className = 'formula-info-popup';
                popup.style.cssText = [
                    'position:fixed',
                    'z-index:10000',
                    'background:var(--bg-2,#1a1a1a)',
                    'border:1px solid var(--border,#444)',
                    'border-radius:6px',
                    'padding:12px 14px',
                    'font-size:0.78rem',
                    'line-height:1.6',
                    'color:var(--text,#eee)',
                    'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
                    'max-width:260px',
                ].join(';');
                popup.innerHTML = schema.info;
                document.body.appendChild(popup);
                const btnRect = infoBtn.getBoundingClientRect();
                let top = btnRect.bottom + 6;
                let left = btnRect.left;
                if (left + 270 > window.innerWidth) left = window.innerWidth - 275;
                if (top + 220 > window.innerHeight) top = btnRect.top - 226;
                popup.style.top = top + 'px';
                popup.style.left = left + 'px';
                const dismiss = (ev) => {
                    if (!popup.contains(ev.target) && ev.target !== infoBtn) {
                        popup.remove();
                        document.removeEventListener('pointerdown', dismiss, true);
                    }
                };
                setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
            });
            row.appendChild(infoBtn);
        }

        group.appendChild(row);
        return group;
    }

    // meshScale — scales all 8 vertices relative to their centroid
    if (key === 'meshScale') {
        const group = document.createElement('div');
        group.className = 'control-group slider-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const step = schema.step ?? 0.05;
        const decBtn = document.createElement('button');
        decBtn.className = 'slider-btn slider-btn--dec';
        decBtn.textContent = '−';
        decBtn.tabIndex = -1;
        const trackWrapper = document.createElement('div');
        trackWrapper.className = 'slider-track-wrapper';
        const range = document.createElement('input');
        range.type = 'range';
        range.min = schema.min;
        range.max = schema.max;
        range.step = step;
        range.value = currentVal;
        range.dataset.instParam = key;
        const defaultVal = schema.default ?? 1;
        const pct = Math.max(2, Math.min(98, ((defaultVal - schema.min) / (schema.max - schema.min)) * 100));
        const resetBtn = document.createElement('button');
        resetBtn.className = 'slider-btn slider-btn--reset';
        resetBtn.textContent = '↺';
        resetBtn.title = `Reset to ${defaultVal}`;
        resetBtn.tabIndex = -1;
        resetBtn.style.left = `${pct}%`;
        const incBtn = document.createElement('button');
        incBtn.className = 'slider-btn slider-btn--inc';
        incBtn.textContent = '+';
        incBtn.tabIndex = -1;
        trackWrapper.appendChild(range);
        trackWrapper.appendChild(resetBtn);
        const valueSpan = document.createElement('span');
        valueSpan.className = 'control-value';
        valueSpan.textContent = currentVal;

        function applyMeshScale(newScale) {
            const clamped = Math.min(schema.max, Math.max(schema.min, newScale));
            const prevScale = inst.params.meshScale ?? 1;
            const ratio = prevScale !== 0 ? clamped / prevScale : 1;
            const tlx = inst.params.meshTLx ?? 10, tly = inst.params.meshTLy ?? 10;
            const trx = inst.params.meshTRx ?? 90, try_ = inst.params.meshTRy ?? 10;
            const brx = inst.params.meshBRx ?? 90, bry = inst.params.meshBRy ?? 90;
            const blx = inst.params.meshBLx ?? 10, bly = inst.params.meshBLy ?? 90;
            const cx = (tlx + trx + brx + blx) / 4;
            const cy = (tly + try_ + bry + bly) / 4;
            setInstanceParam(inst.id, 'meshTLx', cx + (tlx - cx) * ratio);
            setInstanceParam(inst.id, 'meshTLy', cy + (tly - cy) * ratio);
            setInstanceParam(inst.id, 'meshTRx', cx + (trx - cx) * ratio);
            setInstanceParam(inst.id, 'meshTRy', cy + (try_ - cy) * ratio);
            setInstanceParam(inst.id, 'meshBRx', cx + (brx - cx) * ratio);
            setInstanceParam(inst.id, 'meshBRy', cy + (bry - cy) * ratio);
            setInstanceParam(inst.id, 'meshBLx', cx + (blx - cx) * ratio);
            setInstanceParam(inst.id, 'meshBLy', cy + (bly - cy) * ratio);
            setInstanceParam(inst.id, key, clamped);
            range.value = clamped;
            valueSpan.textContent = clamped;
        }

        function activateScaleGroup() {
            if (activeSliderGroup === group) return;
            if (activeSliderGroup) activeSliderGroup.classList.remove('slider-group--active');
            activeSliderGroup = group;
            group.classList.add('slider-group--active');
        }

        range.addEventListener('mousedown', activateScaleGroup);
        range.addEventListener('touchstart', activateScaleGroup, { passive: true });
        range.addEventListener('focus', activateScaleGroup);
        range.addEventListener('input', () => { applyMeshScale(parseFloat(range.value)); });
        decBtn.addEventListener('click', () => { activateScaleGroup(); applyMeshScale(parseFloat(range.value) - step); });
        incBtn.addEventListener('click', () => { activateScaleGroup(); applyMeshScale(parseFloat(range.value) + step); });
        resetBtn.addEventListener('click', () => { activateScaleGroup(); applyMeshScale(defaultVal); });

        row.appendChild(labelEl);
        row.appendChild(decBtn);
        row.appendChild(trackWrapper);
        row.appendChild(incBtn);
        row.appendChild(valueSpan);
        group.appendChild(row);
        return group;
    }

    // meshRotate — rotates all 8 vertices around their centroid
    if (key === 'meshRotate') {
        const group = document.createElement('div');
        group.className = 'control-group slider-group';
        const row = document.createElement('div');
        row.className = 'control-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;

        const step = schema.step ?? 1;
        const defaultVal = schema.default ?? 0;

        const decBtn = document.createElement('button');
        decBtn.className = 'slider-btn slider-btn--dec';
        decBtn.textContent = '−';
        decBtn.tabIndex = -1;

        const trackWrapper = document.createElement('div');
        trackWrapper.className = 'slider-track-wrapper';

        const range = document.createElement('input');
        range.type = 'range';
        range.min = schema.min;
        range.max = schema.max;
        range.step = step;
        range.value = currentVal;
        range.dataset.instParam = key;

        const resetBtn = document.createElement('button');
        resetBtn.className = 'slider-btn slider-btn--reset';
        resetBtn.title = 'Reset';
        resetBtn.textContent = '↺';

        const incBtn = document.createElement('button');
        incBtn.className = 'slider-btn slider-btn--inc';
        incBtn.textContent = '+';
        incBtn.tabIndex = -1;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'control-value';
        valueSpan.textContent = currentVal;

        trackWrapper.appendChild(range);
        trackWrapper.appendChild(resetBtn);

        function applyMeshRotate(newAngle) {
            const clamped = Math.min(schema.max, Math.max(schema.min, newAngle));
            const prevAngle = inst.params.meshRotate ?? 0;
            const delta = (clamped - prevAngle) * Math.PI / 180;
            const cosD = Math.cos(delta), sinD = Math.sin(delta);
            const W = canvas.width, H = canvas.height;
            // Convert % → px, rotate, convert px → %
            const tlx = inst.params.meshTLx ?? 10, tly = inst.params.meshTLy ?? 10;
            const trx = inst.params.meshTRx ?? 90, try_ = inst.params.meshTRy ?? 10;
            const brx = inst.params.meshBRx ?? 90, bry = inst.params.meshBRy ?? 90;
            const blx = inst.params.meshBLx ?? 10, bly = inst.params.meshBLy ?? 90;
            const cxPx = (tlx + trx + brx + blx) / 4 / 100 * W;
            const cyPx = (tly + try_ + bry + bly) / 4 / 100 * H;
            const rot = (xPct, yPct) => {
                const dx = xPct / 100 * W - cxPx, dy = yPct / 100 * H - cyPx;
                return {
                    x: (cxPx + dx * cosD - dy * sinD) / W * 100,
                    y: (cyPx + dx * sinD + dy * cosD) / H * 100,
                };
            };
            const tl = rot(tlx, tly), tr = rot(trx, try_), br = rot(brx, bry), bl = rot(blx, bly);
            setInstanceParam(inst.id, 'meshTLx', tl.x); setInstanceParam(inst.id, 'meshTLy', tl.y);
            setInstanceParam(inst.id, 'meshTRx', tr.x); setInstanceParam(inst.id, 'meshTRy', tr.y);
            setInstanceParam(inst.id, 'meshBRx', br.x); setInstanceParam(inst.id, 'meshBRy', br.y);
            setInstanceParam(inst.id, 'meshBLx', bl.x); setInstanceParam(inst.id, 'meshBLy', bl.y);
            setInstanceParam(inst.id, key, clamped);
            range.value = clamped;
            valueSpan.textContent = clamped;
        }

        function activateRotateGroup() {
            if (activeSliderGroup === group) return;
            if (activeSliderGroup) activeSliderGroup.classList.remove('slider-group--active');
            activeSliderGroup = group;
            group.classList.add('slider-group--active');
        }

        range.addEventListener('mousedown', activateRotateGroup);
        range.addEventListener('touchstart', activateRotateGroup, { passive: true });
        range.addEventListener('focus', activateRotateGroup);
        range.addEventListener('input', () => { applyMeshRotate(parseFloat(range.value)); });
        decBtn.addEventListener('click', () => { activateRotateGroup(); applyMeshRotate(parseFloat(range.value) - step); });
        incBtn.addEventListener('click', () => { activateRotateGroup(); applyMeshRotate(parseFloat(range.value) + step); });
        resetBtn.addEventListener('click', () => { activateRotateGroup(); applyMeshRotate(defaultVal); });

        row.appendChild(labelEl);
        row.appendChild(decBtn);
        row.appendChild(trackWrapper);
        row.appendChild(incBtn);
        row.appendChild(valueSpan);
        group.appendChild(row);
        return group;
    }

    // Number with min/max → range slider
    if ('min' in schema && 'max' in schema) {
        const group = document.createElement('div');
        group.className = 'control-group slider-group';

        const row = document.createElement('div');
        row.className = 'control-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;

        const step = schema.step ?? (Math.abs(schema.max - schema.min) <= 1 ? 0.01 : 1);

        const decBtn = document.createElement('button');
        decBtn.className = 'slider-btn slider-btn--dec';
        decBtn.textContent = '−';
        decBtn.tabIndex = -1;

        const trackWrapper = document.createElement('div');
        trackWrapper.className = 'slider-track-wrapper';

        const range = document.createElement('input');
        range.type = 'range';
        range.min = schema.min;
        range.max = schema.max;
        range.step = step;
        range.value = currentVal;
        if (schema.gradient) range.style.background = schema.gradient;
        range.dataset.instParam = key;

        const defaultVal = schema.default ?? schema.min;
        const pct = Math.max(2, Math.min(98,
            ((defaultVal - schema.min) / (schema.max - schema.min)) * 100
        ));
        const resetBtn = document.createElement('button');
        resetBtn.className = 'slider-btn slider-btn--reset';
        resetBtn.textContent = '↺';
        resetBtn.title = `Reset to ${defaultVal}`;
        resetBtn.tabIndex = -1;
        resetBtn.style.left = `${pct}%`;

        const incBtn = document.createElement('button');
        incBtn.className = 'slider-btn slider-btn--inc';
        incBtn.textContent = '+';
        incBtn.tabIndex = -1;

        trackWrapper.appendChild(range);
        trackWrapper.appendChild(resetBtn);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'control-value';
        valueSpan.textContent = currentVal;

        function applyValue(v) {
            const clamped = Math.min(schema.max, Math.max(schema.min, v));
            range.value = clamped;
            const parsed = parseFloat(range.value);
            setInstanceParam(inst.id, key, parsed);
            valueSpan.textContent = parsed;
            range.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }

        function activateGroup() {
            if (activeSliderGroup === group) return;
            if (activeSliderGroup) activeSliderGroup.classList.remove('slider-group--active');
            activeSliderGroup = group;
            group.classList.add('slider-group--active');
        }

        range.addEventListener('mousedown', activateGroup);
        range.addEventListener('touchstart', activateGroup, { passive: true });
        range.addEventListener('focus', activateGroup);
        range.addEventListener('input', () => {
            const v = parseFloat(range.value);
            setInstanceParam(inst.id, key, v);
            valueSpan.textContent = v;
        });

        decBtn.addEventListener('click', () => { activateGroup(); applyValue(parseFloat(range.value) - step); });
        incBtn.addEventListener('click', () => { activateGroup(); applyValue(parseFloat(range.value) + step); });
        resetBtn.addEventListener('click', () => { activateGroup(); applyValue(defaultVal); });

        row.appendChild(labelEl);
        row.appendChild(decBtn);
        row.appendChild(trackWrapper);
        row.appendChild(incBtn);
        row.appendChild(valueSpan);
        group.appendChild(row);
        return group;
    }

    // Plain number (no range) → number input
    if (typeof schema.default === 'number') {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentVal;
        input.dataset.instParam = key;
        input.addEventListener('input', () => {
            setInstanceParam(inst.id, key, parseFloat(input.value) || 0);
        });
        row.appendChild(labelEl);
        row.appendChild(input);
        group.appendChild(row);
        return group;
    }

    return null;
}
