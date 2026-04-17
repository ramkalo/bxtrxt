// Bottom sheet state machine for mobile.
// The .sidebar element doubles as the bottom sheet on mobile —
// CSS positions it fixed at the bottom and translateY controls how much is visible.
//
// States (CSS classes on .sidebar):
//   (no class) = peek  — 17vh visible (handle + effect category tops)
//   sheet-expanded     — 90vh visible (full controls)
//   sheet-adjust       — 50px visible (handle only; canvas-drag mode active)

const isMobile = () =>
    window.matchMedia('(max-width: 900px), (pointer: coarse)').matches ||
    'ontouchstart' in window;

let sheetEl   = null;
let pillEl    = null;
let pillLabel = null;
let pillValue = null;

// The slider currently being scrubbed. Read by touch.js.
export let activeSlider = null;

export function initBottomSheet() {
    if (!isMobile()) return;

    sheetEl   = document.querySelector('.sidebar');
    pillEl    = document.getElementById('adjustPill');
    pillLabel = document.getElementById('adjustPillLabel');
    pillValue = document.getElementById('adjustPillValue');
    const handleEl = document.getElementById('sheetHandle');

    if (!sheetEl || !handleEl) return;

    // ── Drag handle ──────────────────────────────────────────────────────
    // Returns the translateY in pixels that matches the current CSS class state.
    function getSnappedTranslateY() {
        const h      = window.innerHeight;
        const sheetH = h * 0.9;
        if (sheetEl.classList.contains('sheet-expanded')) return 0;
        if (sheetEl.classList.contains('sheet-adjust'))   return sheetH - 50;
        return sheetH - h * 0.17; // peek
    }

    let dragging            = false;
    let dragStartY          = 0;
    let dragStartTranslateY = 0;
    let dragVelocity        = 0;
    let lastMoveY           = 0;
    let lastMoveTime        = 0;

    handleEl.addEventListener('pointerdown', (e) => {
        dragging            = true;
        dragStartY          = e.clientY;
        dragStartTranslateY = getSnappedTranslateY();
        dragVelocity        = 0;
        lastMoveY           = e.clientY;
        lastMoveTime        = Date.now();

        // Kill the CSS transition while dragging so the sheet tracks the finger.
        sheetEl.style.transition = 'none';
        // Capture so pointermove/pointerup fire even if finger slides off the bar.
        handleEl.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handleEl.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // Don't allow visual drag in adjust mode — only a tap exits it.
        if (sheetEl.classList.contains('sheet-adjust')) return;

        const h      = window.innerHeight;
        const sheetH = h * 0.9;
        const delta  = e.clientY - dragStartY;
        const newY   = Math.max(0, Math.min(sheetH - 50, dragStartTranslateY + delta));

        sheetEl.style.transform = `translateY(${newY}px)`;

        // Track instantaneous velocity (px / ms) for flick detection.
        const now = Date.now();
        const dt  = now - lastMoveTime;
        if (dt > 0) dragVelocity = (e.clientY - lastMoveY) / dt;
        lastMoveY    = e.clientY;
        lastMoveTime = now;
    });

    function onDragEnd(clientY) {
        if (!dragging) return;
        dragging = false;

        // Re-enable CSS transition and clear inline transform so the
        // class-based translateY takes over (with animation).
        sheetEl.style.transition = '';
        sheetEl.style.transform  = '';

        const delta = clientY - dragStartY;

        // In adjust mode any touch on the handle exits adjust mode.
        if (sheetEl.classList.contains('sheet-adjust')) {
            exitAdjustMode();
            return;
        }

        // Treat tiny movements as a tap → toggle between peek and expanded.
        if (Math.abs(delta) < 10) {
            if (sheetEl.classList.contains('sheet-expanded')) {
                sheetEl.classList.remove('sheet-expanded');
            } else {
                sheetEl.classList.add('sheet-expanded');
            }
            return;
        }

        // Snap based on flick velocity, falling back to final position vs midpoint.
        const h        = window.innerHeight;
        const sheetH   = h * 0.9;
        const peekY    = sheetH - h * 0.17;
        const currentY = Math.max(0, Math.min(sheetH - 50, dragStartTranslateY + delta));
        const midpoint = peekY / 2;
        const FLICK    = 0.3; // px / ms

        if (dragVelocity < -FLICK || currentY < midpoint) {
            sheetEl.classList.add('sheet-expanded');
        } else {
            sheetEl.classList.remove('sheet-expanded');
        }
    }

    handleEl.addEventListener('pointerup',     (e) => onDragEnd(e.clientY));
    handleEl.addEventListener('pointercancel', (e) => onDragEnd(e.clientY));

    // ── Slider tap → enter adjust mode ──────────────────────────────────
    // pointerdown fires before the range input, so the sheet collapses just
    // as the user lifts their finger, feeling instantaneous.
    sheetEl.addEventListener('pointerdown', (e) => {
        const slider = e.target.closest('input[type="range"]');
        if (slider) {
            setTimeout(() => enterAdjustMode(slider), 80);
        }
    });
}

export function enterAdjustMode(slider) {
    if (!sheetEl) return;
    activeSlider = slider;
    sheetEl.classList.remove('sheet-expanded');
    sheetEl.classList.add('sheet-adjust');
    document.body.classList.add('touch-adjust-active');

    // Derive a human-readable label from the adjacent .control-label, fallback to data-param
    const row   = slider.closest('.control-row');
    const label = row?.querySelector('.control-label')?.textContent?.trim()
                  ?? slider.dataset.param
                  ?? '—';

    if (pillLabel) pillLabel.textContent = label;
    updatePillValue(slider.value);
    if (pillEl) pillEl.classList.remove('hidden');
}

export function exitAdjustMode() {
    if (!sheetEl) return;
    activeSlider = null;
    sheetEl.classList.remove('sheet-adjust');
    sheetEl.classList.add('sheet-expanded');
    document.body.classList.remove('touch-adjust-active');
    if (pillEl) pillEl.classList.add('hidden');
}

export function updatePillValue(val) {
    if (!pillValue) return;
    const n = parseFloat(val);
    pillValue.textContent = Number.isFinite(n)
        ? (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''))
        : String(val);
}
