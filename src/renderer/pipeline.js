import { originalImage } from './glstate.js';
import { processWebGLStack } from './webgl.js';
import { onStackChange, getStack } from '../state/effectStack.js';

onStackChange(processImage);

let debounceTimer = null;

export function processImage() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (!originalImage) return;
        processWebGLStack(getStack());
    }, 150);
}

export function processImageImmediate() {
    clearTimeout(debounceTimer);
    if (!originalImage) return;
    processWebGLStack(getStack());
}
