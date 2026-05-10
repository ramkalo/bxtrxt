import { getEffect } from '../effects/registry.js';
import { setInstanceParam, getStack } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { getCustomFonts } from '../state/customFonts.js';
import { getPixelsBeforeInstance } from '../renderer/webgl.js';

let activeSliderGroup = null;

// Stores a loaded reference image per palette instance (not serialized)
const _paletteImages = new Map();

// Greedy farthest-point sampling: picks `count` maximally distinct colors from the image.
function _pickDiverseColors(pixels, width, height, count = 8) {
    const samples = [];
    for (let i = 0; i < 600; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const off = (y * width + x) * 4;
        if (pixels[off + 3] < 128) continue;
        samples.push([pixels[off], pixels[off + 1], pixels[off + 2]]);
    }
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
        const row = document.createElement('div');
        row.className = 'control-group';
        row.innerHTML = `
            <div class="control-row">
                <button class="btn" id="loadSecondImageBtnStack_${inst.id}">Load 2nd Image</button>
                <span id="secondImageName" style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">No image</span>
            </div>`;
        row.querySelector('button').addEventListener('click', () => {
            document.getElementById('secondFileInput').click();
        });
        content.insertBefore(row, content.firstChild ? content.firstChild.nextSibling : null);
    }

    if (inst.effectName === 'invert') {
        const colorASelect = content.querySelector('[data-inst-param="invertColorA"]');
        const colorAGroup = colorASelect?.closest('.control-group');
        const colorBSelect = content.querySelector('[data-inst-param="invertColorB"]');
        const colorBGroup  = colorBSelect?.closest('.control-group');
        const colorCSelect = content.querySelector('[data-inst-param="invertColorC"]');
        const colorCGroup  = colorCSelect?.closest('.control-group');
        const colorDSelect = content.querySelector('[data-inst-param="invertColorD"]');
        const colorDGroup  = colorDSelect?.closest('.control-group');
        const colorESelect = content.querySelector('[data-inst-param="invertColorE"]');
        const colorEGroup  = colorESelect?.closest('.control-group');

        // --- colour helpers (used by swatches and stops slider) ---
        const namedHex = {
            r:'#ff0000', g:'#00ff00', b:'#0000ff',
            c:'#00ffff', y:'#ffff00', m:'#ff00ff',
            w:'#ffffff', bk:'#000000',
        };
        const contrastColor = (hex) => {
            const r = parseInt(hex.slice(1,3),16);
            const g = parseInt(hex.slice(3,5),16);
            const b = parseInt(hex.slice(5,7),16);
            return (0.299*r + 0.587*g + 0.114*b) > 128 ? '#000000' : '#ffffff';
        };
        const resolveInvertHex = (key) => {
            if (namedHex[key]) return namedHex[key];
            if (key?.startsWith('p')) {
                const idx = parseInt(key.slice(1));
                const stack = getStack();
                const invertPos = stack.findIndex(s => s.id === inst.id);
                for (let i = invertPos - 1; i >= 0; i--) {
                    if (stack[i].effectName === 'colorPalette' && stack[i].params.paletteEnabled) {
                        return stack[i].params[`palette${idx}`] || null;
                    }
                }
            }
            return null;
        };

        // --- checkboxes for C, D, E (activate / deactivate optional stops) ---
        const stopCheckboxes = {};
        const lastColors = {
            invertColorC: inst.params.invertColorC !== 'none' ? inst.params.invertColorC : 'w',
            invertColorD: inst.params.invertColorD !== 'none' ? inst.params.invertColorD : 'w',
            invertColorE: inst.params.invertColorE !== 'none' ? inst.params.invertColorE : 'w',
        };
        for (const [colorKey, selectEl, group] of [
            ['invertColorC', colorCSelect, colorCGroup],
            ['invertColorD', colorDSelect, colorDGroup],
            ['invertColorE', colorESelect, colorEGroup],
        ]) {
            if (!group) continue;
            const row = group.querySelector('.control-row');
            if (!row) continue;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = inst.params[colorKey] !== 'none';
            cb.style.cssText = 'flex-shrink:0;margin-right:4px;cursor:pointer;';
            row.insertBefore(cb, row.firstChild);
            stopCheckboxes[colorKey] = cb;
            if (selectEl) selectEl.disabled = inst.params[colorKey] === 'none';
            cb.addEventListener('change', () => {
                saveState();
                if (cb.checked) {
                    setInstanceParam(inst.id, colorKey, lastColors[colorKey]);
                    if (selectEl) selectEl.disabled = false;
                } else {
                    if (selectEl && selectEl.value !== 'none') lastColors[colorKey] = selectEl.value;
                    setInstanceParam(inst.id, colorKey, 'none');
                    if (selectEl) selectEl.disabled = true;
                }
                updateSlider();
            });
        }

        const syncCheckboxes = () => {
            for (const [colorKey, cb] of Object.entries(stopCheckboxes)) {
                cb.checked = inst.params[colorKey] !== 'none';
                const selEl = content.querySelector(`[data-inst-param="${colorKey}"]`);
                if (selEl) selEl.disabled = !cb.checked;
            }
        };

        const syncSelectValues = () => {
            for (const sel of [colorASelect, colorBSelect, colorCSelect, colorDSelect, colorESelect]) {
                if (!sel) continue;
                const key = sel.dataset.instParam;
                if (key && inst.params[key] !== undefined) sel.value = inst.params[key];
                styleColorSelect(sel);
            }
        };

        // --- stop-positions slider ---
        const STOP_DEFS = [
            { posKey: 'invertPosA', colorKey: 'invertColorA', label: 'A', defaultPos: 0    },
            { posKey: 'invertPosC', colorKey: 'invertColorC', label: 'C', defaultPos: 0.25 },
            { posKey: 'invertPosD', colorKey: 'invertColorD', label: 'D', defaultPos: 0.5  },
            { posKey: 'invertPosE', colorKey: 'invertColorE', label: 'E', defaultPos: 0.75 },
            { posKey: 'invertPosB', colorKey: 'invertColorB', label: 'B', defaultPos: 1    },
        ];
        const getStopPos  = (i) => inst.params[STOP_DEFS[i].posKey] ?? STOP_DEFS[i].defaultPos;
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
                syncCheckboxes();
                syncSelectValues();
            });
            handles[i].addEventListener('pointerup',          () => { dragState.active = false; dragState.idx = -1; });
            handles[i].addEventListener('lostpointercapture', () => { dragState.active = false; dragState.idx = -1; });
        }

        sliderRow.appendChild(sliderLabel);
        sliderRow.appendChild(trackWrap);

        const gradBar = document.createElement('div');
        gradBar.style.cssText = 'height:6px;border-radius:3px;border:1px solid var(--border);margin:2px 6px 4px;background:linear-gradient(to right,#000,#fff);pointer-events:none;';
        sliderRow.appendChild(gradBar);

        sliderGroup.appendChild(sliderRow);

        if (colorEGroup) colorEGroup.after(sliderGroup);
        else content.appendChild(sliderGroup);

        updateSlider();

        // --- randomize button ---
        const randomizeRow = document.createElement('div');
        randomizeRow.className = 'control-group';
        randomizeRow.innerHTML = `<div class="control-row"><button class="btn">⚄ Randomize Colors</button></div>`;
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
        sliderGroup.after(randomizeRow);

        // --- option swatches ---
        const styleColorSelect = (selectEl) => {
            if (!selectEl) return;
            for (const opt of selectEl.options) {
                const hex = resolveInvertHex(opt.value);
                opt.style.backgroundColor = hex ?? '';
                opt.style.color = hex ? contrastColor(hex) : '';
            }
            const row = selectEl.closest('.control-row');
            if (!row) return;
            let swatch = row.querySelector('.invert-swatch');
            if (!swatch) {
                swatch = document.createElement('span');
                swatch.className = 'invert-swatch';
                swatch.style.cssText = 'display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid var(--border);flex-shrink:0;margin-left:4px;';
                row.appendChild(swatch);
            }
            const hex = resolveInvertHex(selectEl.value);
            swatch.style.backgroundColor = hex ?? 'transparent';
            swatch.style.opacity = hex ? '1' : '0.25';
        };
        for (const sel of [colorASelect, colorBSelect, colorCSelect, colorDSelect, colorESelect]) {
            if (!sel) continue;
            styleColorSelect(sel);
            sel.addEventListener('change', () => { styleColorSelect(sel); updateSlider(); });
            document.addEventListener('paletteupdate', () => {
                if (!document.contains(sel)) return;
                styleColorSelect(sel);
                updateSlider();
            });
        }

        function syncAllColorsState() {
            const isAll = colorASelect?.value === 'all';
            if (colorBSelect) colorBSelect.disabled = isAll;
            if (colorBGroup)  colorBGroup.style.opacity = isAll ? '0.4' : '';
            if (colorCSelect) colorCSelect.disabled = isAll || inst.params.invertColorC === 'none';
            if (colorCGroup)  colorCGroup.style.opacity = isAll ? '0.4' : '';
            if (colorDSelect) colorDSelect.disabled = isAll || inst.params.invertColorD === 'none';
            if (colorDGroup)  colorDGroup.style.opacity = isAll ? '0.4' : '';
            if (colorESelect) colorESelect.disabled = isAll || inst.params.invertColorE === 'none';
            if (colorEGroup)  colorEGroup.style.opacity = isAll ? '0.4' : '';
            for (const cb of Object.values(stopCheckboxes)) cb.disabled = isAll;
            sliderGroup.style.opacity = isAll ? '0.4' : '';
            sliderGroup.style.pointerEvents = isAll ? 'none' : '';
            randomizeBtn.disabled = isAll;
        }

        colorASelect?.addEventListener('change', syncAllColorsState);
        syncAllColorsState();
    }

    if (inst.effectName === 'text') {
        const colorSelect     = content.querySelector('[data-inst-param="textColor"]');
        const randomizeGroup  = content.querySelector('[data-key="textNoiseRandomize"]');
        const noiseValues     = new Set(['greyNoise', 'colorNoise', 'paletteNoise']);

        function syncNoiseBtn() {
            if (randomizeGroup) randomizeGroup.style.display = noiseValues.has(colorSelect?.value) ? '' : 'none';
        }

        colorSelect?.addEventListener('change', syncNoiseBtn);
        syncNoiseBtn();
    }

    return content;
}

function buildControl(inst, key, schema, onRebuild, labelOverride) {
    const label = labelOverride ?? schema.label ?? key;
    const currentVal = inst.params[key];

    // Palette action buttons row — Randomize + Build From Image
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

        const fromImageBtn = document.createElement('button');
        fromImageBtn.className = 'btn';
        fromImageBtn.textContent = 'From Image';
        fromImageBtn.addEventListener('click', () => {
            const result = getPixelsBeforeInstance(getStack(), inst.id);
            if (!result) return;
            const colors = _pickDiverseColors(result.pixels, result.width, result.height);
            saveState();
            setInstanceParam(inst.id, 'palettePreset', 'custom');
            for (let i = 0; i < 8; i++) {
                setInstanceParam(inst.id, `palette${i}`, colors[i]);
            }
            if (onRebuild) onRebuild();
        });

        row.appendChild(randomBtn);
        row.appendChild(fromImageBtn);
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
            const colors = _pickDiverseColors(imgData.data, offscreen.width, offscreen.height);
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
    if (key === 'vhsTrackingSeed' || key === 'corruptedSeed'
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
