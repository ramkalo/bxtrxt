import { EFFECTS, getEffectDefaults } from '../effects/registry.js';

let _stack = [];
const _listeners = new Set();

function _notify(paramKey = null) {
    for (const fn of _listeners) fn(paramKey);
}

function _uid() {
    return 'inst_' + Math.random().toString(36).slice(2, 9);
}

export function onStackChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

export function getStack() {
    return _stack;
}

export function addEffect(effectName) {
    const defaults = getEffectDefaults(effectName);
    if (!defaults) return null;
    
    const effect = EFFECTS.find(e => e.name === effectName);
    const enabledKey = Object.keys(effect?.params || {}).find(k => 
        k.endsWith('Enabled') && typeof defaults[k] === 'boolean'
    );
    
    const instance = { id: _uid(), effectName, params: { ...defaults } };
    if (enabledKey) instance.params[enabledKey] = true;

    if (effectName === 'digital-smear') {
        const count = 10;
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const cellW = 100 / cols;
        const cellH = 100 / rows;
        let placed = 0;
        for (let r = 0; r < rows && placed < count; r++) {
            for (let c = 0; c < cols && placed < count; c++) {
                const jx = Math.random() * 0.8 + 0.1;
                const jy = Math.random() * 0.8 + 0.1;
                instance.params[`smearNx${placed}`] = Math.min(99, Math.round(c * cellW + jx * cellW));
                instance.params[`smearNy${placed}`] = Math.min(99, Math.round(r * cellH + jy * cellH));
                placed++;
            }
        }
        instance.params.smearNodeCount = placed;
    }

    if (effectName === 'viewport') {
        const entryInst = { id: _uid(), effectName: 'viewportEntry', params: {} };
        _stack.push(entryInst);
        instance.params.vpEntryId = entryInst.id;
    }

    _stack.push(instance);
    _notify();
    return instance;
}

export function removeEffect(id) {
    const inst = _stack.find(i => i.id === id);
    if (inst?.effectName === 'viewport') {
        const entryId = inst.params.vpEntryId;
        _stack = entryId
            ? _stack.filter(i => i.id !== entryId)
            : _stack.filter(i => i.effectName !== 'viewportEntry');
    }
    if (inst?.effectName === 'doubleExposure') {
        const entryId = inst.params.doubleExposureEntryId;
        if (entryId) _stack = _stack.filter(i => i.id !== entryId);
    }
    _stack = _stack.filter(i => i.id !== id);
    _notify();
}

export function insertEffect(effectName, beforeId) {
    const defaults = getEffectDefaults(effectName);
    if (!defaults) return null;
    const instance = { id: _uid(), effectName, params: { ...defaults } };
    const idx = beforeId ? _stack.findIndex(i => i.id === beforeId) : -1;
    _stack.splice(idx === -1 ? _stack.length : idx, 0, instance);
    _notify();
    return instance;
}

export function duplicateEffect(id) {
    const inst = _stack.find(i => i.id === id);
    if (!inst) return null;
    const copy = { id: _uid(), effectName: inst.effectName, params: { ...inst.params } };
    // Reset internal-mode link for the duplicate — it needs its own entry if the user wants it
    if (copy.effectName === 'doubleExposure' && copy.params.doubleExposureMode === 'internal') {
        copy.params.doubleExposureMode = 'external';
        copy.params.doubleExposureEntryId = null;
    }
    const idx = _stack.findIndex(i => i.id === id);
    _stack.splice(idx + 1, 0, copy);
    _notify();
    return copy;
}

export function moveEffect(id, newIndex) {
    const idx = _stack.findIndex(inst => inst.id === id);
    if (idx === -1) return;
    const [item] = _stack.splice(idx, 1);
    const clampedIndex = Math.max(0, Math.min(_stack.length, newIndex));
    _stack.splice(clampedIndex, 0, item);
    _notify();
}

export function setInstanceParam(id, key, value) {
    const inst = _stack.find(i => i.id === id);
    if (!inst) return;
    inst.params[key] = value;
    _notify(key);
}

export function snapshotStack() {
    return JSON.parse(JSON.stringify(_stack));
}

function _migrateInstance(inst) {
    if (inst.effectName !== 'crtStatic') return inst;
    const p = inst.params ?? {};
    const migrated = { ...inst, effectName: 'grain', params: { ...p } };
    const mp = migrated.params;
    if ('crtStaticEnabled'  in mp) { mp.grainEnabled   = mp.crtStaticEnabled;  delete mp.crtStaticEnabled; }
    if ('crtStatic'         in mp) { mp.grainIntensity  = mp.crtStatic;         delete mp.crtStatic; }
    if ('crtStaticType'     in mp) { mp.grainType       = mp.crtStaticType;     delete mp.crtStaticType; }
    if ('crtStaticGrain'    in mp) { mp.grainSize       = mp.crtStaticGrain;    delete mp.crtStaticGrain; }
    for (const key of Object.keys(mp)) {
        if (key.startsWith('crtStatic')) {
            mp['grain' + key.slice('crtStatic'.length)] = mp[key];
            delete mp[key];
        }
    }
    return migrated;
}

export function restoreStack(snapshot) {
    _stack = JSON.parse(JSON.stringify(snapshot)).map(_migrateInstance);
    _notify();
}
