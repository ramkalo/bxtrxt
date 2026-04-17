import { isProcessing, setIsProcessing, setDebounceTimer, debounceTimer, useWebGL, originalImage } from './glstate.js';
import { renderWebGL } from './webgl.js';
import { processCanvas2D, processCanvas2DStack } from './canvas2d.js';
import { renderTimestampOverlay } from '../effects/vhs.js';
import { showProcessIndicator } from '../utils/notifications.js';
import { onParamsChange } from '../state/params.js';
import { onStackChange, getStack } from '../state/effectStack.js';

const overlayCanvas = document.getElementById('overlayCanvas');

onParamsChange(processImage);
onStackChange(processImage);

export function processImage() {
    if (!originalImage || isProcessing) return;
    clearTimeout(debounceTimer);
    setDebounceTimer(setTimeout(doProcess, 150));
}

function doProcess() {
    if (!originalImage || isProcessing) return;
    setIsProcessing(true);
    showProcessIndicator(true);

    const stack = getStack();

    if (stack.length > 0) {
        // Stack mode: always use Canvas 2D so each instance gets its own params
        overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        processCanvas2DStack(stack);
    } else if (useWebGL) {
        renderWebGL();
        renderTimestampOverlay(overlayCanvas);
    } else {
        overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        processCanvas2D();
    }

    setIsProcessing(false);
    showProcessIndicator(false);
}
