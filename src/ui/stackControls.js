import { EFFECT_CATALOG, getEffect } from '../effects/registry.js';
import { getStack, setInstanceParam } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';

// Special UI metadata for params that need non-default rendering
const PARAM_LABELS = {
    // basic
    basicEnabled: 'Enable', brightness: 'Brightness', contrast: 'Contrast',
    saturation: 'Saturation', highlights: 'Highlights', shadows: 'Shadows',
    temperature: 'Temperature', tint: 'Tint',
    // grain
    grainEnabled: 'Enable', grainIntensity: 'Intensity', grainSize: 'Grain Size',
    // vignette
    vignetteEnabled: 'Enable', vignetteMode: 'Mode', vignetteMajor: 'Major Axis',
    vignetteMinor: 'Minor Axis', vignetteAngle: 'Angle', vignetteEdge: 'Edge Brightness',
    vignetteCenter: 'Center Brightness', vignetteCenterX: 'Center X', vignetteCenterY: 'Center Y',
    // chroma
    chromaEnabled: 'Enable', chromaScale: 'Scale',
    chromaRedX: 'Red X', chromaRedY: 'Red Y', chromaGreenX: 'Green X', chromaGreenY: 'Green Y',
    chromaBlueX: 'Blue X', chromaBlueY: 'Blue Y', chromaCyanX: 'Cyan X', chromaCyanY: 'Cyan Y',
    chromaMagentaX: 'Magenta X', chromaMagentaY: 'Magenta Y', chromaYellowX: 'Yellow X', chromaYellowY: 'Yellow Y',
    chromaThreshold: 'Threshold', chromaThresholdReverse: 'Reverse Threshold',
    // invert
    invertEnabled: 'Enable', invertMode: 'Mode', invertTarget: 'Target',
    invertIntensity: 'Threshold', invertReverse: 'Reverse Threshold',
    // digitize
    digitizeEnabled: 'Enable', digitizeDither: 'Dithering', digitizeNoise: 'Noise',
    // pixelArt
    pixelArtEnabled: 'Enable', pixelSize: 'Pixel Size', pixelColors: '# Colors',
    // vhs
    vhsEnabled: 'Enable', vhsTracking: 'Tracking', vhsBleed: 'Color Bleed', vhsNoise: 'Noise',
    // vhsTimestamp
    vhsTimestampEnabled: 'Enable', vhsTimestamp: 'Text', vhsTimestampSize: 'Size',
    vhsTimestampPos: 'Position', vhsTimestampColor: 'Color', vhsTimestampMargin: 'Margin',
    // waves
    wavesEnabled: 'Enable', wavesR: 'Red', wavesG: 'Green', wavesB: 'Blue', wavesPhase: 'Phase',
    // crt
    crtEnabled: 'Enable', crtCurvature: 'Curvature', crtCurvatureRadius: 'Radius',
    crtCurvatureIntensity: 'Intensity', crtCurvatureX: 'Center X', crtCurvatureY: 'Center Y',
    crtScanline: 'Scanline', crtScanSpacing: 'Scan Spacing', crtWaves: 'Waves',
    crtWavePhase: 'Wave Phase', crtStatic: 'Static', crtStaticType: 'Static Type',
    // doubleExposure
    doubleExposureEnabled: 'Enable', doubleExposureChannelMode: 'Channels',
    doubleExposureBlendMode: 'Blend Mode', doubleExposureIntensity: 'Threshold',
    doubleExposureReverse: 'Reverse Threshold',
};

// Select options for enum params
const PARAM_OPTIONS = {
    vignetteMode: [['ellipse', 'Ellipse'], ['rectangle', 'Rectangle']],
    invertMode: [['all', 'All Colors'], ['rc', 'Red ↔ Cyan'], ['gm', 'Green ↔ Magenta'], ['by', 'Blue ↔ Yellow'], ['bw', 'Black vs White']],
    invertTarget: [['lum', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']],
    vhsTimestampPos: [['top-left', 'Top Left'], ['top-right', 'Top Right'], ['bottom-left', 'Bottom Left'], ['bottom-right', 'Bottom Right']],
    vhsTimestampColor: [['white', 'White'], ['black', 'Black']],
    vhsTimestampMargin: [['small', 'Small (10px)'], ['medium', 'Medium (40px)'], ['large', 'Large (160px)']],
    crtStaticType: [['white', 'White'], ['color', 'Color'], ['luma', 'Luma']],
    doubleExposureChannelMode: [['all', 'All'], ['r', 'R only'], ['g', 'G only'], ['b', 'B only'], ['rg', 'R + G'], ['rb', 'R + B'], ['gb', 'G + B']],
    doubleExposureBlendMode: [['screen', 'Screen'], ['multiply', 'Multiply'], ['add', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']],
};

export function buildControlsPanel() {
    const container = document.getElementById('stackControlsContainer');
    container.innerHTML = '';
    const stack = getStack();

    if (stack.length === 0) {
        container.innerHTML = '<div class="stack-empty">Add effects in the Effects panel to see controls here.</div>';
        return;
    }

    // Global collapse/expand toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'controls-toolbar';
    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.className = 'btn btn-sm';
    collapseAllBtn.textContent = 'Collapse All';
    collapseAllBtn.addEventListener('click', () => {
        const sections = container.querySelectorAll('.tool-section');
        const allCollapsed = [...sections].every(s => s.classList.contains('collapsed'));
        sections.forEach(s => s.classList.toggle('collapsed', !allCollapsed));
        collapseAllBtn.textContent = allCollapsed ? 'Collapse All' : 'Expand All';
    });
    toolbar.appendChild(collapseAllBtn);
    container.appendChild(toolbar);

    // Count occurrences for duplicate labeling
    const counts = {};
    const seen = {};
    for (const inst of stack) {
        counts[inst.effectName] = (counts[inst.effectName] || 0) + 1;
    }

    for (const inst of stack) {
        const effect = getEffect(inst.effectName);
        if (!effect) continue;

        seen[inst.effectName] = (seen[inst.effectName] || 0) + 1;
        const catalogEntry = EFFECT_CATALOG.find(e => e.name === inst.effectName);
        const baseLabel = catalogEntry ? catalogEntry.label : inst.effectName;
        const label = counts[inst.effectName] > 1
            ? `${baseLabel} (${seen[inst.effectName]})`
            : baseLabel;

        const section = document.createElement('div');
        section.className = 'tool-section';
        section.dataset.instanceId = inst.id;

        // Find the enabled/disabled key (e.g. grainEnabled, vhsEnabled …)
        const enabledKey = Object.keys(effect.params).find(k =>
            k.endsWith('Enabled') &&
            (effect.params[k].default === true || effect.params[k].default === false)
        );

        const header = document.createElement('div');
        header.className = 'tool-header';

        const titleEl = document.createElement('h3');
        titleEl.textContent = label;
        header.appendChild(titleEl);

        if (enabledKey !== undefined) {
            const enableLabel = document.createElement('label');
            enableLabel.className = 'header-enable-label';
            enableLabel.addEventListener('click', e => e.stopPropagation());
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = inst.params[enabledKey];
            checkbox.dataset.instParam = enabledKey;
            checkbox.addEventListener('change', () => {
                saveState();
                setInstanceParam(inst.id, enabledKey, checkbox.checked);
            });
            enableLabel.appendChild(checkbox);
            enableLabel.appendChild(document.createTextNode(' On'));
            header.appendChild(enableLabel);
        }

        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'tool-toggle';
        toggleSpan.innerHTML = '&#9660;';
        header.appendChild(toggleSpan);

        header.addEventListener('click', () => section.classList.toggle('collapsed'));

        const content = document.createElement('div');
        content.className = 'tool-content';

        for (const [key, schema] of Object.entries(effect.params)) {
            if (key === enabledKey) continue; // already shown in header
            const controlEl = buildControl(inst, key, schema);
            if (controlEl) content.appendChild(controlEl);
        }

        // VHS Timestamp "Now" button
        if (inst.effectName === 'vhsTimestamp') {
            const row = document.createElement('div');
            row.className = 'control-group';
            const nowBtn = document.createElement('button');
            nowBtn.className = 'btn';
            nowBtn.textContent = 'Set to Now';
            nowBtn.style.cssText = 'padding:4px 8px;font-size:0.75rem;margin-top:4px;';
            nowBtn.addEventListener('click', () => {
                const now = new Date();
                const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                const ts = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2,'0')} ${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                setInstanceParam(inst.id, 'vhsTimestamp', ts);
                const input = content.querySelector('[data-inst-param="vhsTimestamp"]');
                if (input) input.value = ts;
            });
            row.appendChild(nowBtn);
            content.appendChild(row);
        }

        // Double exposure load image button
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
            content.insertBefore(row, content.firstChild.nextSibling);
        }

        section.appendChild(header);
        section.appendChild(content);
        container.appendChild(section);
    }
}

function buildControl(inst, key, schema) {
    const label = PARAM_LABELS[key] || key;
    const currentVal = inst.params[key];

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
    if (PARAM_OPTIONS[key]) {
        const group = document.createElement('div');
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const select = document.createElement('select');
        select.dataset.instParam = key;
        for (const [val, text] of PARAM_OPTIONS[key]) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = text;
            if (val === currentVal) opt.selected = true;
            select.appendChild(opt);
        }
        select.addEventListener('change', () => {
            saveState();
            setInstanceParam(inst.id, key, select.value);
        });
        row.appendChild(labelEl);
        row.appendChild(select);
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
        group.className = 'control-group';
        const row = document.createElement('div');
        row.className = 'control-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'control-label';
        labelEl.textContent = label;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = schema.min;
        range.max = schema.max;
        range.step = schema.step ?? (Math.abs(schema.max - schema.min) <= 1 ? 0.01 : 1);
        range.value = currentVal;
        range.dataset.instParam = key;
        const valueSpan = document.createElement('span');
        valueSpan.className = 'control-value';
        valueSpan.textContent = currentVal;
        range.addEventListener('input', () => {
            const v = parseFloat(range.value);
            setInstanceParam(inst.id, key, v);
            valueSpan.textContent = v;
        });
        row.appendChild(labelEl);
        row.appendChild(range);
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
