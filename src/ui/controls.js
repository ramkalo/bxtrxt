import { params, controlLimits } from '../state/params.js';

// ---------------------------------------------------------------------------
// DOM ↔ params sync
// ---------------------------------------------------------------------------

/**
 * Push current params values into every [data-param] DOM input.
 * Call this after any bulk params change (preset load, undo/redo, reset)
 * so the UI reflects the new state.
 */
export function syncDOMFromParams() {
    document.querySelectorAll('input[data-param]').forEach(function(input) {
        const key = input.dataset.param;
        if (!(key in params)) return;
        if (input.type === 'checkbox') {
            input.checked = params[key];
        } else {
            input.value = params[key];
        }
    });

    document.querySelectorAll('select[data-param]').forEach(function(select) {
        const key = select.dataset.param;
        if (key in params) select.value = params[key];
    });

    updateAllControlValues();
}

export function applyControlLimits() {
    Object.keys(controlLimits).forEach(function(paramName) {
        const limits = controlLimits[paramName];
        document.querySelectorAll(`[data-param="${paramName}"]`).forEach(function(el) {
            if (el.type === 'range') {
                el.min = limits.min;
                el.max = limits.max;
            }
        });
    });
}

/** Refresh only the value-display spans (not the inputs themselves). */
export function updateAllControlValues() {
    document.querySelectorAll('input[data-param], select[data-param]').forEach(function(input) {
        if (!input.dataset.param) return;
        const valueSpan = input.parentElement.querySelector('.control-value');
        if (!valueSpan) return;
        if (input.type === 'checkbox') return; // no display span for checkboxes
        valueSpan.textContent = formatControlValue(input);
    });
}

export function formatControlValue(input) {
    return params[input.dataset.param];
}

// ---------------------------------------------------------------------------
// Input bindings
// ---------------------------------------------------------------------------

/**
 * Attach input listeners to every [data-param] element.
 * The listener writes to params (proxy intercepts → onParamsChange fires
 * → processImage debounces) so no explicit processImage() call is needed.
 */
export function initParamBindings() {
    document.querySelectorAll('input[data-param], select[data-param]').forEach(function(input) {
        const param = input.dataset.param;

        input.addEventListener('input', function() {
            let value;
            if (this.type === 'checkbox') {
                value = this.checked;
            } else if (this.type === 'number') {
                value = parseInt(this.value);
            } else {
                value = isNaN(parseFloat(this.value)) ? this.value : parseFloat(this.value);
            }

            // Writing to the proxy triggers _notify() → processImage()
            params[param] = value;

            // Update the display span
            const valueSpan = this.parentElement.querySelector('.control-value');
            if (valueSpan) valueSpan.textContent = formatControlValue(this);
        });
    });
}
