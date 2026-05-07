const STORAGE_KEY = 'bxtrxt_customFonts';

// In-memory store: { name: { label, data: base64 } }
let _store = {};

function _nameFromFile(file) {
    return file.name.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-').toLowerCase();
}

function _base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function _registerWithBrowser(name, base64) {
    const font = new FontFace(name, _base64ToBuffer(base64));
    await font.load();
    document.fonts.add(font);
}

export function getCustomFonts() {
    return Object.entries(_store).map(([name, { label }]) => ({ name, label }));
}

export async function registerFontFromData(name, label, base64) {
    await _registerWithBrowser(name, base64);
    _store[name] = { label, data: base64 };
}

export async function restoreCustomFonts() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        for (const [name, { label, data }] of Object.entries(saved)) {
            await _registerWithBrowser(name, data);
            _store[name] = { label, data };
        }
    } catch { /* corrupt storage — ignore */ }
}

export async function loadFontFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = reader.result.split(',')[1];
                const name = _nameFromFile(file);
                const label = file.name.replace(/\.[^/.]+$/, '');
                await registerFontFromData(name, label, base64);
                // Persist to localStorage
                const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
                existing[name] = { label, data: base64 };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
                resolve({ name, label });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Returns only the fonts whose names appear in a stack snapshot
export function collectUsedCustomFonts(stackSnapshot) {
    const used = {};
    for (const inst of stackSnapshot) {
        for (const val of Object.values(inst.params)) {
            if (typeof val === 'string' && _store[val]) {
                used[val] = _store[val];
            }
        }
    }
    return used;
}
