import { getEffect } from '../effects/registry.js';
import { setInstanceParam } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { getCustomFonts } from '../state/customFonts.js';

let activeSliderGroup = null;

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
        swapRow.innerHTML = `<div class="control-row"><button class="btn">⇄ Swap Colors</button></div>`;
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

        function syncAllColorsState() {
            const isAll = colorASelect?.value === 'all';
            if (colorBSelect) colorBSelect.disabled = isAll;
            if (colorBGroup)  colorBGroup.style.opacity = isAll ? '0.4' : '';
            swapBtn.disabled = isAll;
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
            setInstanceParam(inst.id, key, select.value);
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
