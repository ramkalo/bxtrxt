import { EFFECTS, getEffectDefaults } from '../effects/registry.js';

let _stack = [];
const _listeners = new Set();

function _notify() {
    for (const fn of _listeners) fn();
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
    const instance = { id: _uid(), effectName, params: { ...defaults } };
    _stack.push(instance);
    _notify();
    return instance;
}

export function removeEffect(id) {
    _stack = _stack.filter(inst => inst.id !== id);
    _notify();
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
    _notify();
}

export function snapshotStack() {
    return JSON.parse(JSON.stringify(_stack));
}

export function restoreStack(snapshot) {
    _stack = JSON.parse(JSON.stringify(snapshot));
    _notify();
}
