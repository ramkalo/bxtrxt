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
        const swapRow = document.createElement('div');
        swapRow.className = 'control-group';
        swapRow.innerHTML = `<div class="control-row"><button class="btn">⇄ Swap A / B</button></div>`;
        const swapBtn = swapRow.querySelector('button');
        swapBtn.addEventListener('click', () => {
            saveState();
            const a = inst.params.invertColorA;
            const b = inst.params.invertColorB;
            setInstanceParam(inst.id, 'invertColorA', b);
            setInstanceParam(inst.id, 'invertColorB', a);
            if (onRebuild) onRebuild();
        });
        const colorASelect = content.querySelector('[data-inst-param="invertColorA"]');
        const colorAGroup = colorASelect?.closest('.control-group');
        if (colorAGroup) colorAGroup.after(swapRow);
        else content.appendChild(swapRow);

        const colorBSelect = content.querySelector('[data-inst-param="invertColorB"]');
        const colorBGroup  = colorBSelect?.closest('.control-group');
        const colorCSelect = content.querySelector('[data-inst-param="invertColorC"]');
        const colorCGroup  = colorCSelect?.closest('.control-group');
        const colorDSelect = content.querySelector('[data-inst-param="invertColorD"]');
        const colorDGroup  = colorDSelect?.closest('.control-group');

        const swapBCRow = document.createElement('div');
        swapBCRow.className = 'control-group';
        swapBCRow.innerHTML = `<div class="control-row"><button class="btn">⇄ Swap B / C</button></div>`;
        const swapBCBtn = swapBCRow.querySelector('button');
        swapBCBtn.addEventListener('click', () => {
            saveState();
            const b = inst.params.invertColorB;
            const c = inst.params.invertColorC;
            setInstanceParam(inst.id, 'invertColorB', c === 'none' ? b : c);
            setInstanceParam(inst.id, 'invertColorC', b);
            if (onRebuild) onRebuild();
        });
        if (colorBGroup) colorBGroup.after(swapBCRow);
        else content.appendChild(swapBCRow);

        const swapCDRow = document.createElement('div');
        swapCDRow.className = 'control-group';
        swapCDRow.innerHTML = `<div class="control-row"><button class="btn">⇄ Swap C / D</button></div>`;
        const swapCDBtn = swapCDRow.querySelector('button');
        swapCDBtn.addEventListener('click', () => {
            saveState();
            const c = inst.params.invertColorC;
            const d = inst.params.invertColorD;
            setInstanceParam(inst.id, 'invertColorC', d === 'none' ? c : d);
            setInstanceParam(inst.id, 'invertColorD', c);
            if (onRebuild) onRebuild();
        });
        if (colorCGroup) colorCGroup.after(swapCDRow);
        else content.appendChild(swapCDRow);

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
            setInstanceParam(inst.id, 'invertColorC', Math.random() < 0.5 ? palette[2] : 'none');
            setInstanceParam(inst.id, 'invertColorD', Math.random() < 0.5 ? palette[3] : 'none');
            if (onRebuild) onRebuild();
        });
        if (colorDGroup) colorDGroup.after(randomizeRow);
        else content.appendChild(randomizeRow);

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
        for (const sel of [colorASelect, colorBSelect, colorCSelect, colorDSelect]) {
            if (!sel) continue;
            styleColorSelect(sel);
            sel.addEventListener('change', () => styleColorSelect(sel));
            document.addEventListener('paletteupdate', () => {
                if (!document.contains(sel)) return;
                styleColorSelect(sel);
            });
        }

        function syncAllColorsState() {
            const isAll = colorASelect?.value === 'all';
            if (colorBSelect) colorBSelect.disabled = isAll;
            if (colorBGroup)  colorBGroup.style.opacity = isAll ? '0.4' : '';
            if (colorCSelect) colorCSelect.disabled = isAll;
            if (colorCGroup)  colorCGroup.style.opacity = isAll ? '0.4' : '';
            if (colorDSelect) colorDSelect.disabled = isAll;
            if (colorDGroup)  colorDGroup.style.opacity = isAll ? '0.4' : '';
            swapBtn.disabled = isAll;
            swapBCBtn.disabled = isAll;
            swapCDBtn.disabled = isAll;
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
        input.placeholder = '#ff0000 #ff8800 … (8 hex codes)';
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
