// Preferences — user-facing UI settings, persisted to localStorage.
// Currently: UI side (effect list + library on the left or right).

const STORAGE_KEY = 'bxtrxt-prefs';

const defaults = {
    uiSide: 'right', // 'right' | 'left'
};

function load() {
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
        return { ...defaults };
    }
}

function save(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

let prefs = load();

function applyUiSide() {
    const container = document.querySelector('.app-container');
    if (container) container.classList.toggle('ui-left', prefs.uiSide === 'left');
    document.querySelectorAll('#uiSideToggle .pref-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.side === prefs.uiSide);
    });
}

// Apply persisted prefs to the DOM as early as possible (before modal wiring).
export function applyPreferences() {
    applyUiSide();
}

export function initPreferences() {
    applyPreferences();

    const modal = document.getElementById('prefsModal');
    const openBtn = document.getElementById('prefsBtn');
    const closeBtn = document.getElementById('closePrefsBtn');
    const toggle = document.getElementById('uiSideToggle');

    if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    if (toggle) {
        toggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.pref-seg-btn');
            if (!btn) return;
            prefs.uiSide = btn.dataset.side;
            save(prefs);
            applyUiSide();
        });
    }
}
