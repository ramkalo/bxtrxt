import { originalImage } from './glstate.js';
import { processWebGLStack } from './webgl.js';
import { onParamsChange } from '../state/params.js';
import { onStackChange, getStack } from '../state/effectStack.js';

onParamsChange(processImage);
onStackChange(processImage);

let debounceTimer = null;

export function processImage() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (!originalImage) return;
        processWebGLStack(getStack());
    }, 150);
}
