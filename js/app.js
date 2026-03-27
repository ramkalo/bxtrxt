const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let gl = null;
let programPreCRT = null;
let programCRT = null;
let texture = null;
let framebuffer1 = null;
let framebufferTexture1 = null;
let originalImage = null;
let isProcessing = false;
let debounceTimer = null;
let undoStack = [];
let redoStack = [];

let useWebGL = false;
let useWebGL2 = false;
let webglVersion = 0;

const params = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    basicEnabled: false,
    pixelArtEnabled: false,
    pixelSize: 24,
    pixelColors: 16,
    digitizeDither: 0,
    digitizeNoise: 0,
    digitizeEnabled: false,
    chromaEnabled: false,
    chromaRedX: 0, chromaRedY: 0,
    chromaGreenX: 0, chromaGreenY: 0,
    chromaBlueX: 0, chromaBlueY: 0,
    vhsEnabled: false,
    vhsTracking: 0,
    vhsBleed: 0,
    vhsNoise: 0,
    vhsTimestampEnabled: false,
    vhsTimestamp: 'DEC 31 1999 11:59:59',
    vhsTimestampSize: 64,
    vhsTimestampPos: 'bottom-left',
    vhsTimestampColor: 'white',
    vhsTimestampMargin: 'small',
    grainIntensity: 0,
    grainEnabled: false,
    vignetteRadius: 100,
    vignetteCenterX: 0,
    vignetteCenterY: 0,
    vignetteEdge: 0,
    vignetteCenter: 0,
    vignetteEnabled: false,
    invertEnabled: false,
    invertMode: 'all',
    invertIntensity: 100,
    invertReverse: false,
    crtEnabled: false,
    crtCurvature: 0,
    crtCurvatureRadius: 100,
    crtCurvatureIntensity: 100,
    crtCurvatureX: 0,
    crtCurvatureY: 0,
    crtScanline: 0,
    crtScanSpacing: 4,
    crtWaves: 0,
    crtWavePhase: 0,
    crtStatic: 0,
    crtStaticType: 'white'
};

// Store a copy of the original defaults for use by the reset function
const defaultParams = JSON.parse(JSON.stringify(params));

// Control range limits for all input elements
const controlLimits = {
    brightness: { min: -100, max: 100 },
    contrast: { min: -100, max: 100 },
    saturation: { min: -100, max: 100 },
    highlights: { min: -100, max: 100 },
    shadows: { min: -100, max: 100 },
    temperature: { min: -100, max: 100 },
    tint: { min: -100, max: 100 },
    pixelSize: { min: 2, max: 32 },
    pixelColors: { min: 2, max: 64 },
    digitizeDither: { min: 0, max: 100 },
    digitizeNoise: { min: 0, max: 100 },
    chromaRedX: { min: -20, max: 20 },
    chromaRedY: { min: -20, max: 20 },
    chromaGreenX: { min: -20, max: 20 },
    chromaGreenY: { min: -20, max: 20 },
    chromaBlueX: { min: -20, max: 20 },
    chromaBlueY: { min: -20, max: 20 },
    vhsTracking: { min: 0, max: 100 },
    vhsBleed: { min: 0, max: 20 },
    vhsNoise: { min: 0, max: 100 },
    vhsTimestampSize: { min: 8, max: 512 },
    grainIntensity: { min: 0, max: 100 },
    vignetteRadius: { min: 0, max: 150 },
    vignetteCenterX: { min: -50, max: 50 },
    vignetteCenterY: { min: -50, max: 50 },
    vignetteEdge: { min: -100, max: 100 },
    vignetteCenter: { min: -100, max: 100 },
    invertIntensity: { min: 0, max: 100 },
    crtCurvature: { min: 0, max: 100 },
    crtCurvatureRadius: { min: 0, max: 100 },
    crtCurvatureIntensity: { min: 0, max: 100 },
    crtCurvatureX: { min: -50, max: 50 },
    crtCurvatureY: { min: -50, max: 50 },
    crtScanline: { min: 0, max: 100 },
    crtScanSpacing: { min: 2, max: 12 },
    crtWaves: { min: 0, max: 20 },
    crtWavePhase: { min: 0, max: 100 },
    crtStatic: { min: 0, max: 100 }
};

let presets = JSON.parse(localStorage.getItem('retroPresets') || '{}');

function showNotification(message) {
    const n = document.getElementById('notification');
    n.textContent = message;
    n.classList.add('show');
    setTimeout(() => n.classList.remove('show'), 2000);
}

function showProcessIndicator(show) {
    document.getElementById('processIndicator').classList.toggle('visible', show);
}

function saveState() {
    if (!originalImage) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const state = undoStack.pop();
    ctx.putImageData(state, 0, 0);
    updateUndoButtons();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const state = redoStack.pop();
    ctx.putImageData(state, 0, 0);
    updateUndoButtons();
}

function updateUndoButtons() {
    document.getElementById('undoBtn').disabled = undoStack.length === 0;
    document.getElementById('redoBtn').disabled = redoStack.length === 0;
    document.getElementById('undoBtnMobile').disabled = undoStack.length === 0;
    document.getElementById('redoBtnMobile').disabled = redoStack.length === 0;
}

const VERTEX_SHADER_GLSL1 = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

const PRE_CRT_SHADER_GLSL1 = `
    precision highp float;

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform float u_time;

    uniform bool u_basicEnabled;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_highlights;
    uniform float u_shadows;
    uniform float u_temperature;
    uniform float u_tint;

    uniform bool u_digitizeEnabled;
    uniform float u_digitizeDither;
    uniform float u_digitizeNoise;

    uniform bool u_grainEnabled;
    uniform float u_grainIntensity;

    uniform bool u_vignetteEnabled;

    uniform bool u_pixelArtEnabled;
    uniform float u_pixelSize;
    uniform float u_pixelColors;

    uniform bool u_chromaEnabled;
    uniform float u_chromaRedX;
    uniform float u_chromaRedY;
    uniform float u_chromaGreenX;
    uniform float u_chromaGreenY;
    uniform float u_chromaBlueX;
    uniform float u_chromaBlueY;

    uniform float u_vignetteRadius;
    uniform float u_vignetteCenterX;
    uniform float u_vignetteCenterY;
    uniform float u_vignetteEdge;
    uniform float u_vignetteCenter;

    uniform bool u_invertEnabled;
    uniform int u_invertMode;
    uniform float u_invertIntensity;
    uniform bool u_invertReverse;

    uniform bool u_vhsEnabled;
    uniform float u_vhsTracking;
    uniform float u_vhsBleed;
    uniform float u_vhsNoise;

    const float bayer4x4[16] = float[16](
        0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
       12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
        3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
       15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );

    float rand(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vec2 uv = v_texCoord;
        vec4 color = texture2D(u_image, uv);

        if (u_basicEnabled) {
            float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;

            if (u_highlights != 0.0) {
                float hf = u_highlights * (lum / 255.0) * 0.3;
                color.rgb += hf;
            }

            if (u_shadows != 0.0) {
                float sf = u_shadows * ((255.0 - lum) / 255.0) * 0.3;
                color.rgb += sf;
            }

            float contrastFactor = (u_contrast + 100.0) / 100.0;
            color.rgb = color.rgb * contrastFactor + u_brightness;

            if (u_saturation != 0.0) {
                float sat = 1.0 + u_saturation / 100.0;
                float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
                color.r = gray + sat * (color.r - gray);
                color.g = gray + sat * (color.g - gray);
                color.b = gray + sat * (color.b - gray);
            }

            if (u_temperature != 0.0) {
                float temp = u_temperature / 100.0;
                color.r += temp * 25.0;
                color.b -= temp * 25.0;
            }

            if (u_tint != 0.0) {
                color.g += u_tint * 0.25;
            }
        }

        if (u_digitizeEnabled && u_digitizeDither > 0.0) {
            float amount = u_digitizeDither / 100.0;
            int x = int(mod(gl_FragCoord.x, 4.0));
            int y = int(mod(gl_FragCoord.y, 4.0));
            float threshold = bayer4x4[y * 4 + x] * amount;
            color.rgb = floor(color.rgb / 32.0 + threshold) * 32.0;
        }

        if (u_digitizeEnabled && u_digitizeNoise > 0.0) {
            float intensity = u_digitizeNoise / 100.0 * 80.0;
            float noise = (rand(v_texCoord + u_time) - 0.5) * intensity;
            color.rgb += noise;
        }

        if (u_grainEnabled && u_grainIntensity > 0.0) {
            float intensity = u_grainIntensity / 100.0 * 50.0;
            float noise = (rand(v_texCoord + u_time * 0.001) - 0.5) * intensity;
            color.rgb += noise;
        }

        if (u_pixelArtEnabled) {
            vec2 pixelUV = floor(v_texCoord * u_resolution / u_pixelSize) * u_pixelSize / u_resolution;
            vec4 pixelColor = texture2D(u_image, pixelUV);
            float step = 256.0 / u_pixelColors;
            pixelColor.rgb = floor(pixelColor.rgb / step + 0.5) * step;
            color = pixelColor;
        }

        if (u_chromaEnabled) {
            vec2 redOffset = vec2(u_chromaRedX, -u_chromaRedY) / u_resolution;  // Negate Y: negative = down
            vec2 greenOffset = vec2(u_chromaGreenX, -u_chromaGreenY) / u_resolution;  // Negate Y: negative = down
            vec2 blueOffset = vec2(u_chromaBlueX, -u_chromaBlueY) / u_resolution;  // Negate Y: negative = down
            color.r = texture2D(u_image, uv + redOffset).r;
            color.g = texture2D(u_image, uv + greenOffset).g;
            color.b = texture2D(u_image, uv + blueOffset).b;
        }

        if (u_vignetteEnabled) {
            vec2 center = vec2(0.5 + u_vignetteCenterX / 100.0, 0.5 - u_vignetteCenterY / 100.0);  // Flip Y: negative = down
            float dist = distance(uv, center);
            float maxDist = 0.7071 * (u_vignetteRadius / 100.0);
            float falloff = pow(min(dist / maxDist, 1.0), 2.0);

            // Edge effect: scales brightness at edges based on falloff
            // falloff=0 (center) → edgeFactor=1.0 (no change)
            // falloff=1 (edges) → edgeFactor varies with u_vignetteEdge
            float edgeFactor = 1.0 + falloff * (u_vignetteEdge / 100.0);
            edgeFactor = max(0.0, edgeFactor);

            // Center effect: adds/subtracts brightness at center
            // At center (falloff≈0): full center effect
            // At edges (falloff≈1): center effect fades out
            float centerFactor = 1.0 + (1.0 - falloff) * (u_vignetteCenter / 100.0);
            centerFactor = max(0.0, centerFactor);

            // Combine effects
            float vignette = edgeFactor * centerFactor;

            color.rgb *= vignette;
        }

        if (u_invertEnabled) {
            float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
            float threshold = 255.0 * (u_invertIntensity / 100.0);
            bool shouldInvert = u_invertReverse ? (lum <= threshold) : (lum >= threshold);

            if (shouldInvert) {
                if (u_invertMode == 1) {  // all
                    color.rgb = vec3(255.0) - color.rgb;
                } else if (u_invertMode == 2) {  // rc (red-cyan)
                    color.r = 255.0 - color.r;
                } else if (u_invertMode == 3) {  // gm (green-magenta)
                    color.g = 255.0 - color.g;
                } else if (u_invertMode == 4) {  // by (blue-yellow)
                    color.b = 255.0 - color.b;
                } else if (u_invertMode == 5) {  // bw (black-white/luminance)
                    float newLum = 255.0 - lum;
                    color.rgb = vec3(newLum);
                }
            }
        }

        if (u_vhsEnabled) {
            if (u_vhsTracking > 0.0) {
                int numLines = int(u_vhsTracking / 15.0);
                for (int i = 0; i < 7; i++) {
                    if (i < numLines) {
                        float rowY = fract(float(i) * 0.1324 + u_time * 0.5);
                        float rowDist = abs(uv.y - rowY);
                        if (rowDist < 1.0 / u_resolution.y * 2.0) {
                            float offset = (rand(vec2(float(i), u_time)) - 0.5) * 30.0 / u_resolution.x;
                            uv = vec2(uv.x + offset, uv.y);
                            color = texture2D(u_image, uv);
                        }
                    }
                }
            }

            if (u_vhsBleed > 0.0) {
                float bleed = u_vhsBleed / u_resolution.x;
                color.r = texture2D(u_image, vec2(uv.x - bleed, uv.y)).r;
                color.b = texture2D(u_image, vec2(uv.x + bleed, uv.y)).b;
            }

            if (u_vhsNoise > 0.0) {
                float intensity = u_vhsNoise / 100.0 * 120.0;
                float noise = (rand(v_texCoord + u_time) - 0.5) * intensity;
                color.rgb += noise;
            }
        }

        color.rgb = clamp(color.rgb, 0.0, 255.0);

        gl_FragColor = color;
    }
`;

const CRT_SHADER_GLSL1 = `
    precision highp float;

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform float u_time;

    uniform bool u_crtEnabled;
    uniform float u_crtCurvature;
    uniform float u_crtCurvatureRadius;
    uniform float u_crtCurvatureIntensity;
    uniform float u_crtCurvatureX;
    uniform float u_crtCurvatureY;
    uniform float u_crtScanline;
    uniform float u_crtScanSpacing;
    uniform float u_crtWaves;
    uniform float u_crtWavePhase;
    uniform float u_crtStatic;
    uniform int u_crtStaticType;

    float rand(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    float crtWave(vec2 uv, float phase, float amp) {
        float xNorm = uv.x * 10.0 + phase;
        float yNorm = uv.y * 8.0;

        float w =
            3.2 * sin(xNorm + 0.3 * cos(2.1 * xNorm) + yNorm) +
            2.1 * cos(0.73 * xNorm - 1.4 + yNorm * 0.7) * sin(0.5 * xNorm + 0.9 + yNorm * 0.5) +
            1.8 * sin(2.3 * xNorm + cos(xNorm) + yNorm * 0.3) * exp(-0.02 * pow(xNorm - 2.0, 2.0)) +
            0.9 * cos(3.7 * xNorm - 0.8 + yNorm * 0.4) * (1.0 / (1.0 + 0.15 * xNorm * xNorm)) +
            1.2 * sin(0.41 * xNorm * xNorm - xNorm + yNorm * 0.6);

        return w * amp;
    }

    void main() {
        vec2 uv = v_texCoord;
        vec4 color = texture2D(u_image, uv);

        if (u_crtEnabled) {
            if (u_crtCurvature > 0.0) {
                vec2 center = vec2(0.5 + u_crtCurvatureX / 100.0, 0.5 - u_crtCurvatureY / 100.0);  // Flip Y: negative = down
                float maxRadius = min(u_resolution.x, u_resolution.y) * (u_crtCurvatureRadius / 100.0) / u_resolution.x;
                float intensity = u_crtCurvature / 100.0 * u_crtCurvatureIntensity / 100.0;
                float k = intensity;

                vec2 dc = uv - center;
                float r = length(dc);

                if (r > 0.0 && r < maxRadius) {
                    float factor = 1.0 - k * pow(1.0 - r / maxRadius, 2.0);
                    uv = center + dc * factor;
                }

                uv = clamp(uv, 0.0, 1.0);
                color = texture2D(u_image, uv);
            }

            if (u_crtScanline > 0.0) {
                float spacing = u_crtScanSpacing;
                float row = mod(gl_FragCoord.y, spacing);
                if (row < 1.0) {
                    float darken = 1.0 - u_crtScanline / 100.0 * 0.7;
                    color.rgb *= darken;
                }
            }

            if (u_crtWaves > 0.0) {
                float amplitude = u_crtWaves / 100.0;
                float phase = u_crtWavePhase / 100.0 * 20.0;

                float offset = crtWave(uv, phase, amplitude * 80.0) / u_resolution.x;

                float r = texture2D(u_image, vec2(uv.x + offset, uv.y)).r;
                float g = color.g;
                float b = texture2D(u_image, vec2(uv.x - offset, uv.y)).b;

                color.rgb = vec3(r, g, b);
            }

            if (u_crtStatic > 0.0) {
                float intensity = u_crtStatic / 100.0;
                float noise = (rand(v_texCoord + u_time) - 0.5) * 255.0 * intensity;

                if (u_crtStaticType == 0) {
                    color.rgb += noise;
                } else if (u_crtStaticType == 1) {
                    color.r += noise * rand(v_texCoord + u_time + 0.1);
                    color.g += noise * rand(v_texCoord + u_time + 0.2);
                    color.b += noise * rand(v_texCoord + u_time + 0.3);
                } else {
                    float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
                    float newGray = clamp(gray + noise, 0.0, 255.0);
                    float ratio = newGray / max(gray, 0.001);
                    color.rgb *= ratio;
                }
            }
        }

        color.rgb = clamp(color.rgb, 0.0, 255.0);

        gl_FragColor = color;
    }
`;

function initWebGL() {
    gl = canvas.getContext('webgl2');
    if (gl) {
        useWebGL2 = true;
        useWebGL = true;
        webglVersion = 2;
        console.log('Using WebGL 2');
        updateRenderMode('WebGL 2');
        return initShaders();
    }

    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
        useWebGL2 = false;
        useWebGL = true;
        webglVersion = 1;
        console.log('Using WebGL 1');
        updateRenderMode('WebGL 1');
        return initShaders();
    }

    console.log('WebGL not available, using Canvas 2D');
    useWebGL = false;
    updateRenderMode('Canvas 2D');
    return true;
}

function updateRenderMode(mode) {
    const el = document.getElementById('renderMode');
    if (el) {
        el.textContent = mode;
        el.style.color = mode === 'Canvas 2D' ? '#e94560' : '#4ecca3';
    }
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function initShaders() {
    let vertexSrc, preCRTSrc, crtSrc;

    if (webglVersion === 1) {
        vertexSrc = VERTEX_SHADER_GLSL1;
        preCRTSrc = PRE_CRT_SHADER_GLSL1;
        crtSrc = CRT_SHADER_GLSL1;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
    const preCRTShader = createShader(gl, gl.FRAGMENT_SHADER, preCRTSrc);
    const crtShader = createShader(gl, gl.FRAGMENT_SHADER, crtSrc);

    if (!vertexShader || !preCRTShader || !crtShader) {
        console.error('Shader compilation failed, falling back to Canvas 2D');
        useWebGL = false;
        useWebGL2 = false;
        gl = null;
        updateRenderMode('Canvas 2D');
        return true;
    }

    programPreCRT = createProgram(gl, vertexShader, preCRTShader);
    programCRT = createProgram(gl, vertexShader, crtShader);

    if (!programPreCRT || !programCRT) {
        console.error('Program linking failed, falling back to Canvas 2D');
        useWebGL = false;
        useWebGL2 = false;
        gl = null;
        updateRenderMode('Canvas 2D');
        return true;
    }

    return true;
}

function createFramebuffer(width, height) {
    if (framebufferTexture1) gl.deleteTexture(framebufferTexture1);
    if (framebuffer1) gl.deleteFramebuffer(framebuffer1);
    
    framebufferTexture1 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebufferTexture1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    framebuffer1 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebufferTexture1, 0);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            originalImage = img;
            canvas.width = img.width;
            canvas.height = img.height;
            
            if (useWebGL) {
                createTexture(img);
                createFramebuffer(img.width, img.height);
            }
            
            ctx.drawImage(img, 0, 0);
            
            document.getElementById('imageInfo').textContent = `${img.width} × ${img.height}px`;
            document.getElementById('dropZone').classList.add('hidden');
            document.getElementById('exportBtn').disabled = false;
            document.getElementById('resetBtn').disabled = false;
            document.getElementById('savePresetBtn').disabled = false;
            document.getElementById('exportBtnMobile').disabled = false;
            document.getElementById('resetBtnMobile').disabled = false;
            document.getElementById('savePresetBtnMobile').disabled = false;
            
            processImage();
            showNotification('Image loaded');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function createTexture(image) {
    if (texture) gl.deleteTexture(texture);
    
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function processImage() {
    if (!originalImage || isProcessing) return;
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doProcess, 150);
}

function doProcess() {
    if (!originalImage || isProcessing) return;
    isProcessing = true;
    showProcessIndicator(true);
    
    console.log('Processing with:', useWebGL ? (useWebGL2 ? 'WebGL 2' : 'WebGL 1') : 'Canvas 2D');
    
    if (useWebGL) {
        renderWebGL();
    } else {
        processCanvas2D();
    }
    
    isProcessing = false;
    showProcessIndicator(false);
}

function flipPixelsVertically(pixels, width, height) {
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y) * width * 4;
        const dstRow = y * width * 4;
        for (let x = 0; x < width * 4; x++) {
            flipped[dstRow + x] = pixels[srcRow + x];
        }
    }
    return flipped;
}

function renderWebGL() {
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    
    createFramebuffer(canvas.width, canvas.height);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
         1,  1, 1, 1
    ]), gl.STATIC_DRAW);
    
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(programPreCRT);
    
    const posLoc1 = gl.getAttribLocation(programPreCRT, 'a_position');
    const texLoc1 = gl.getAttribLocation(programPreCRT, 'a_texCoord');
    gl.enableVertexAttribArray(posLoc1);
    gl.vertexAttribPointer(posLoc1, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texLoc1);
    gl.vertexAttribPointer(texLoc1, 2, gl.FLOAT, false, 16, 8);
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform2f(gl.getUniformLocation(programPreCRT, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_time'), performance.now() / 1000);
    
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_basicEnabled'), params.basicEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_brightness'), params.brightness);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_contrast'), params.contrast);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_saturation'), params.saturation);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_highlights'), params.highlights);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_shadows'), params.shadows);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_temperature'), params.temperature);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_tint'), params.tint);

    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_digitizeEnabled'), params.digitizeEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_digitizeDither'), params.digitizeDither);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_digitizeNoise'), params.digitizeNoise);
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_grainEnabled'), params.grainEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_grainIntensity'), params.grainIntensity);
    
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_pixelArtEnabled'), params.pixelArtEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_pixelSize'), params.pixelSize);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_pixelColors'), params.pixelColors);
    
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_chromaEnabled'), params.chromaEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaRedX'), params.chromaRedX);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaRedY'), params.chromaRedY);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaGreenX'), params.chromaGreenX);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaGreenY'), params.chromaGreenY);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaBlueX'), params.chromaBlueX);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_chromaBlueY'), params.chromaBlueY);
    
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_vignetteEnabled'), params.vignetteEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vignetteRadius'), params.vignetteRadius);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vignetteCenterX'), params.vignetteCenterX);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vignetteCenterY'), params.vignetteCenterY);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vignetteEdge'), params.vignetteEdge);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vignetteCenter'), params.vignetteCenter);

    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_invertEnabled'), params.invertEnabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_invertMode'), ['all', 'rc', 'gm', 'by', 'bw'].indexOf(params.invertMode) + 1);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_invertIntensity'), params.invertIntensity);
    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_invertReverse'), params.invertReverse ? 1 : 0);

    gl.uniform1i(gl.getUniformLocation(programPreCRT, 'u_vhsEnabled'), params.vhsEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vhsTracking'), params.vhsTracking);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vhsBleed'), params.vhsBleed);
    gl.uniform1f(gl.getUniformLocation(programPreCRT, 'u_vhsNoise'), params.vhsNoise);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const flippedPixels = flipPixelsVertically(pixels, canvas.width, canvas.height);
    
    let timestampCanvas = document.createElement('canvas');
    timestampCanvas.width = canvas.width;
    timestampCanvas.height = canvas.height;
    let timestampCtx = timestampCanvas.getContext('2d');
    
    let imageData = timestampCtx.createImageData(canvas.width, canvas.height);
    imageData.data.set(flippedPixels);
    timestampCtx.putImageData(imageData, 0, 0);
    
    if (params.vhsTimestampEnabled && params.vhsTimestamp) {
        applyVHSTimestampToContext(timestampCtx);
    }
    
    let timestampTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, timestampTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, timestampCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(programCRT);
    
    const posLoc2 = gl.getAttribLocation(programCRT, 'a_position');
    const texLoc2 = gl.getAttribLocation(programCRT, 'a_texCoord');
    gl.enableVertexAttribArray(posLoc2);
    gl.vertexAttribPointer(posLoc2, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texLoc2);
    gl.vertexAttribPointer(texLoc2, 2, gl.FLOAT, false, 16, 8);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, timestampTexture);
    
    gl.uniform1i(gl.getUniformLocation(programCRT, 'u_image'), 0);
    gl.uniform2f(gl.getUniformLocation(programCRT, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_time'), performance.now() / 1000);
    
    gl.uniform1i(gl.getUniformLocation(programCRT, 'u_crtEnabled'), params.crtEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtCurvature'), params.crtCurvature);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtCurvatureRadius'), params.crtCurvatureRadius);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtCurvatureIntensity'), params.crtCurvatureIntensity);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtCurvatureX'), params.crtCurvatureX);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtCurvatureY'), params.crtCurvatureY);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtScanline'), params.crtScanline);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtScanSpacing'), params.crtScanSpacing);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtWaves'), params.crtWaves);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtWavePhase'), params.crtWavePhase);
    gl.uniform1f(gl.getUniformLocation(programCRT, 'u_crtStatic'), params.crtStatic);
    
    let staticType = 0;
    if (params.crtStaticType === 'color') staticType = 1;
    else if (params.crtStaticType === 'luma') staticType = 2;
    gl.uniform1i(gl.getUniformLocation(programCRT, 'u_crtStaticType'), staticType);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    gl.deleteTexture(timestampTexture);
    gl.deleteBuffer(positionBuffer);
}

function applyVHSTimestampToContext(targetCtx) {
    const marginMap = { 'small': 10, 'medium': 40, 'large': 160 };
    const margin = marginMap[params.vhsTimestampMargin] || 10;

    targetCtx.font = `${params.vhsTimestampSize}px JetBrains Mono, monospace`;

    // Set colors based on selection
    if (params.vhsTimestampColor === 'black') {
        targetCtx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    } else {
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        targetCtx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    }
    targetCtx.lineWidth = 2;

    const ts = params.vhsTimestamp;
    const pos = params.vhsTimestampPos;
    let x, y;

    // Horizontal positioning
    if (pos.includes('left')) {
        x = margin;
    } else {
        x = canvas.width - targetCtx.measureText(ts).width - margin;
    }

    // Vertical positioning
    if (pos.includes('top')) {
        y = margin + params.vhsTimestampSize;
    } else {
        y = canvas.height - margin;
    }

    targetCtx.strokeText(ts, x, y);
    targetCtx.fillText(ts, x, y);
}

function processCanvas2D() {
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    ctx.drawImage(originalImage, 0, 0);
    
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const hasBasic = params.brightness !== 0 || params.contrast !== 0 ||
                     params.saturation !== 0 || params.highlights !== 0 ||
                     params.shadows !== 0 || params.temperature !== 0 || params.tint !== 0;
    if (params.basicEnabled && hasBasic) {
        imageData = applyBasicAdjustments(imageData);
    }

    if (params.digitizeEnabled && params.digitizeDither > 0) {
        imageData = applyFloydSteinberg(imageData, params.digitizeDither / 100);
    }

    if (params.digitizeEnabled && params.digitizeNoise > 0) {
        imageData = applyNoise(imageData, params.digitizeNoise / 100);
    }

    if (params.grainEnabled && params.grainIntensity > 0) {
        imageData = applyGrain(imageData, params.grainIntensity / 100);
    }
    
    if (params.pixelArtEnabled) {
        imageData = applyPixelArt(imageData);
    }
    
    if (params.chromaEnabled) {
        imageData = applyChromaticAberration(imageData);
    }
    
    if (params.vignetteEnabled) {
        imageData = applyVignette(imageData);
    }
    
    if (params.invertEnabled) {
        imageData = applyInvert(imageData, params.invertMode);
    }

    if (params.vhsEnabled) {
        imageData = applyVHS(imageData);
    }

    ctx.putImageData(imageData, 0, 0);
    
    if (params.vhsTimestampEnabled && params.vhsTimestamp) {
        applyVHSTimestampToContext(ctx);
    }
    
    if (params.crtEnabled && params.crtScanline > 0) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        imageData = applyCRTScanlines(imageData);
        ctx.putImageData(imageData, 0, 0);
    }
    
    if (params.crtEnabled && params.crtCurvature > 0) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        imageData = applyCRTCurvature(imageData);
        ctx.putImageData(imageData, 0, 0);
    }
    
    if (params.crtEnabled && params.crtWaves > 0) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        imageData = applyCRTWaves(imageData);
        ctx.putImageData(imageData, 0, 0);
    }
    
    if (params.crtEnabled && params.crtStatic > 0) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        imageData = applyCRTStatic(imageData);
        ctx.putImageData(imageData, 0, 0);
    }
}

function applyBasicAdjustments(imageData) {
    const data = imageData.data;
    const contrastFactor = (params.contrast + 100) / 100;
    const brightness = params.brightness;
    
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        
        if (params.highlights !== 0) {
            const hf = params.highlights * (lum / 255) * 0.3;
            r += hf; g += hf; b += hf;
        }
        
        if (params.shadows !== 0) {
            const sf = params.shadows * ((255 - lum) / 255) * 0.3;
            r += sf; g += sf; b += sf;
        }
        
        r = r * contrastFactor + brightness;
        g = g * contrastFactor + brightness;
        b = b * contrastFactor + brightness;
        
        if (params.saturation !== 0) {
            const sat = 1 + params.saturation / 100;
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + sat * (r - gray);
            g = gray + sat * (g - gray);
            b = gray + sat * (b - gray);
        }
        
        if (params.temperature !== 0) {
            const temp = params.temperature / 100;
            r += temp * 25;
            b -= temp * 25;
        }
        
        if (params.tint !== 0) {
            g += params.tint * 0.25;
        }
        
        data[i] = Math.max(0, Math.min(255, r));
        data[i + 1] = Math.max(0, Math.min(255, g));
        data[i + 2] = Math.max(0, Math.min(255, b));
    }
    
    return imageData;
}

function applyNoise(imageData, factor) {
    const data = imageData.data;
    const intensity = factor * 80;
    
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * intensity;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    return imageData;
}

function applyFloydSteinberg(imageData, amount) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            
            const oldR = data[i];
            const oldG = data[i + 1];
            const oldB = data[i + 2];
            
            const newR = Math.round(oldR / 32) * 32;
            const newG = Math.round(oldG / 32) * 32;
            const newB = Math.round(oldB / 32) * 32;
            
            data[i] = newR;
            data[i + 1] = newG;
            data[i + 2] = newB;
            
            const errR = (oldR - newR) * amount;
            const errG = (oldG - newG) * amount;
            const errB = (oldB - newB) * amount;
            
            const addError = (nx, ny, factor) => {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const ni = (ny * width + nx) * 4;
                    data[ni] = Math.max(0, Math.min(255, data[ni] + errR * factor));
                    data[ni + 1] = Math.max(0, Math.min(255, data[ni + 1] + errG * factor));
                    data[ni + 2] = Math.max(0, Math.min(255, data[ni + 2] + errB * factor));
                }
            };
            
            addError(x + 1, y, 7/16);
            addError(x - 1, y + 1, 3/16);
            addError(x, y + 1, 5/16);
            addError(x + 1, y + 1, 1/16);
        }
    }
    
    return imageData;
}

function applyGrain(imageData, factor) {
    const data = imageData.data;
    const intensity = factor * 50;
    
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * intensity;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    return imageData;
}

function applyPixelArt(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const pixelSize = params.pixelSize;
    const numColors = params.pixelColors;
    const step = 256 / numColors;
    
    for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
            let r = 0, g = 0, b = 0, count = 0;
            
            for (let py = 0; py < pixelSize && y + py < height; py++) {
                for (let px = 0; px < pixelSize && x + px < width; px++) {
                    const i = ((y + py) * width + (x + px)) * 4;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
            }
            
            r = Math.floor(r / count / step) * step;
            g = Math.floor(g / count / step) * step;
            b = Math.floor(b / count / step) * step;
            
            for (let py = 0; py < pixelSize && y + py < height; py++) {
                for (let px = 0; px < pixelSize && x + px < width; px++) {
                    const i = ((y + py) * width + (x + px)) * 4;
                    data[i] = r;
                    data[i + 1] = g;
                    data[i + 2] = b;
                }
            }
        }
    }
    
    return imageData;
}

function applyChromaticAberration(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const sourceData = imageData.data;
    const result = new Uint8ClampedArray(sourceData);
    
    const shifts = [
        { x: params.chromaRedX, y: params.chromaRedY, channel: 0 },
        { x: params.chromaGreenX, y: params.chromaGreenY, channel: 1 },
        { x: params.chromaBlueX, y: params.chromaBlueY, channel: 2 }
    ];
    
    for (const shift of shifts) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const nx = Math.round(x + shift.x);
                const ny = Math.round(y - shift.y);  // Negate Y: negative offset = down
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const srcI = (ny * width + nx) * 4 + shift.channel;
                    const dstI = (y * width + x) * 4 + shift.channel;
                    result[dstI] = sourceData[srcI];
                }
            }
        }
    }
    
    imageData.data.set(result);
    return imageData;
}

function applyVignette(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Center position (-50 to +50 → pixel coordinates, 0 = image center)
    const cx = (0.5 + params.vignetteCenterX / 100) * width;
    const cy = (0.5 - params.vignetteCenterY / 100) * height;  // Flip Y: negative = down

    // Maximum distance (from center to corner)
    const maxDist = Math.sqrt(cx * cx + cy * cy + (width - cx) * (width - cx) + (height - cy) * (height - cy)) / 2;

    // Scaled radius (0-150 range)
    const scaledMaxDist = maxDist * (params.vignetteRadius / 100);

    const edgeScale = params.vignetteEdge / 100;
    const centerScale = params.vignetteCenter / 100;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            const falloff = Math.pow(Math.min(dist / scaledMaxDist, 1.0), 2);

            // Edge effect: scales brightness at edges based on falloff
            // falloff=0 (center) → edgeFactor=1.0 (no change)
            // falloff=1 (edges) → edgeFactor varies with edgeScale
            let edgeFactor = 1.0 + falloff * edgeScale;
            edgeFactor = Math.max(0, edgeFactor);

            // Center effect: adds/subtracts brightness at center
            // At center (falloff≈0): full center effect
            // At edges (falloff≈1): center effect fades out
            let centerFactor = 1.0 + (1.0 - falloff) * centerScale;
            centerFactor = Math.max(0, centerFactor);

            // Combine effects
            let vignette = edgeFactor * centerFactor;

            const i = (y * width + x) * 4;
            data[i] = Math.max(0, Math.min(255, data[i] * vignette));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * vignette));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * vignette));
        }
    }
    return imageData;
}

function applyInvert(imageData, mode) {
    const data = imageData.data;
    const intensity = params.invertIntensity / 100;
    const threshold = 255 * intensity;
    const reverse = params.invertReverse;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Determine if this pixel should be inverted based on threshold
        const shouldInvert = reverse ? (lum <= threshold) : (lum >= threshold);

        if (shouldInvert) {
            if (mode === 'all') {
                data[i] = 255 - r;
                data[i + 1] = 255 - g;
                data[i + 2] = 255 - b;
            } else if (mode === 'rc') {
                data[i] = 255 - r;
            } else if (mode === 'gm') {
                data[i + 1] = 255 - g;
            } else if (mode === 'by') {
                data[i + 2] = 255 - b;
            } else if (mode === 'bw') {
                const newLum = 255 - lum;
                data[i] = newLum;
                data[i + 1] = newLum;
                data[i + 2] = newLum;
            }
        }
    }

    return imageData;
}

function applyVHS(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const result = new Uint8ClampedArray(data);
    
    if (params.vhsBleed > 0) {
        const bleed = Math.floor(params.vhsBleed);
        for (let y = 0; y < height; y++) {
            for (let x = bleed; x < width; x++) {
                const i = (y * width + x) * 4;
                const srcI = (y * width + (x - bleed)) * 4;
                result[i] = data[srcI];
            }
            for (let x = 0; x < width - bleed; x++) {
                const i = (y * width + x) * 4;
                const srcI = (y * width + (x + bleed)) * 4;
                result[i + 2] = data[srcI + 2];
            }
        }
        imageData.data.set(result);
    }
    
    if (params.vhsTracking > 0) {
        const numLines = Math.floor(params.vhsTracking / 15);
        for (let t = 0; t < numLines; t++) {
            const lineY = Math.floor(Math.random() * height);
            const offset = Math.floor(Math.random() * 30 - 15);
            for (let x = 0; x < width; x++) {
                const srcX = Math.max(0, Math.min(width - 1, x + offset));
                const i = (lineY * width + x) * 4;
                const srcI = (lineY * width + srcX) * 4;
                imageData.data[i] = imageData.data[srcI];
                imageData.data[i + 1] = imageData.data[srcI + 1];
                imageData.data[i + 2] = imageData.data[srcI + 2];
            }
        }
    }
    
    if (params.vhsNoise > 0) {
        const intensity = params.vhsNoise / 100;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 120 * intensity;
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise));
            imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise));
            imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise));
        }
    }
    
    return imageData;
}

function applyCRTScanlines(imageData) {
    const intensity = params.crtScanline / 100;
    const spacing = Math.floor(params.crtScanSpacing);
    if (intensity === 0 || spacing < 1) return imageData;
    
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    const darken = 1 - intensity * 0.7;
    
    for (let y = 0; y < height; y++) {
        const row = y % spacing;
        if (row < 1) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                data[i] *= darken;
                data[i + 1] *= darken;
                data[i + 2] *= darken;
            }
        }
    }
    return imageData;
}

function applyCRTCurvature(imageData) {
    const strength = params.crtCurvature / 100;
    if (strength === 0) return imageData;
    
    const srcData = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const result = new Uint8ClampedArray(width * height * 4);
    
    const centerX = (0.5 + params.crtCurvatureX / 100) * width;
    const centerY = (0.5 - params.crtCurvatureY / 100) * height;  // Flip Y: negative = down
    
    const maxRadius = Math.min(width, height) * (params.crtCurvatureRadius / 100);
    const intensity = params.crtCurvatureIntensity / 100;
    const k = strength * intensity;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const r = Math.sqrt(dx * dx + dy * dy);
            
            let srcX, srcY;
            
            if (r > maxRadius) {
                srcX = x;
                srcY = y;
            } else if (r === 0) {
                srcX = x;
                srcY = y;
            } else {
                const factor = 1 - k * (1 - r / maxRadius) * (1 - r / maxRadius);
                srcX = centerX + dx * factor;
                srcY = centerY + dy * factor;
            }
            
            const sx = Math.floor(Math.max(0, Math.min(width - 1, srcX)));
            const sy = Math.floor(Math.max(0, Math.min(height - 1, srcY)));
            
            const i = (y * width + x) * 4;
            const srcI = (sy * width + sx) * 4;
            
            result[i] = srcData[srcI];
            result[i + 1] = srcData[srcI + 1];
            result[i + 2] = srcData[srcI + 2];
            result[i + 3] = 255;
        }
    }
    
    imageData.data.set(result);
    return imageData;
}

function applyCRTWaves(imageData) {
    const amplitude = params.crtWaves / 100;
    const phase = params.crtWavePhase / 100 * 20;
    if (amplitude === 0) return imageData;
    
    const srcData = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const result = new Uint8ClampedArray(width * height * 4);
    
    const amp = amplitude * 80;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const xNorm = x / width * 10 + phase;
            const yNorm = y / height * 8;
            
            const wave = 
                3.2 * Math.sin(xNorm + 0.3 * Math.cos(2.1 * xNorm) + yNorm) +
                2.1 * Math.cos(0.73 * xNorm - 1.4 + yNorm * 0.7) * Math.sin(0.5 * xNorm + 0.9 + yNorm * 0.5) +
                1.8 * Math.sin(2.3 * xNorm + Math.cos(xNorm) + yNorm * 0.3) * Math.exp(-0.02 * Math.pow(xNorm - 2, 2)) +
                0.9 * Math.cos(3.7 * xNorm - 0.8 + yNorm * 0.4) * (1 / (1 + 0.15 * xNorm * xNorm)) +
                1.2 * Math.sin(0.41 * xNorm * xNorm - xNorm + yNorm * 0.6);
            
            const offset = wave * amp;
            
            const srcXR = Math.floor(Math.max(0, Math.min(width - 1, x + offset)));
            const srcXG = Math.floor(Math.max(0, Math.min(width - 1, x)));
            const srcXB = Math.floor(Math.max(0, Math.min(width - 1, x - offset)));
            
            const i = (y * width + x) * 4;
            const srcIR = (y * width + srcXR) * 4;
            const srcIG = (y * width + srcXG) * 4;
            const srcIB = (y * width + srcXB) * 4;
            
            result[i] = srcData[srcIR];
            result[i + 1] = srcData[srcIG + 1];
            result[i + 2] = srcData[srcIB + 2];
            result[i + 3] = 255;
        }
    }
    
    imageData.data.set(result);
    return imageData;
}

function applyCRTStatic(imageData) {
    const intensity = params.crtStatic / 100;
    const type = params.crtStaticType;
    if (intensity === 0) return imageData;
    
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * intensity;
        
        if (type === 'white') {
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        } else if (type === 'color') {
            data[i] = Math.max(0, Math.min(255, data[i] + noise * Math.random()));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * Math.random()));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * Math.random()));
        } else if (type === 'luma') {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const newGray = Math.max(0, Math.min(255, gray + noise));
            const ratio = newGray / (gray || 1);
            data[i] *= ratio;
            data[i + 1] *= ratio;
            data[i + 2] *= ratio;
        }
    }
    return imageData;
}

function exportImage(format) {
    console.log('Exporting with:', useWebGL ? (useWebGL2 ? 'WebGL 2' : 'WebGL 1') : 'Canvas 2D');

    if (useWebGL) {
        renderWebGL();
    } else {
        processCanvas2D();
    }

    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpg' ? 'jpg' : 'png';
    const now = new Date();
    const ts = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    const filename = `retroinator-export-${ts}.${ext}`;

    canvas.toBlob(function(blob) {
        const objectURL = URL.createObjectURL(blob);
        const previewModal = document.getElementById('exportPreviewModal');
        const previewImg = document.getElementById('exportPreviewImg');
        const hint = document.getElementById('exportHint');

        previewImg.src = objectURL;
        previewModal.dataset.objectUrl = objectURL;
        previewModal.classList.remove('hidden');

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (isIOS) {
            // iOS: show long-press hint so user can save directly to Photos
            hint.classList.remove('hidden');
        } else {
            // Desktop: trigger download automatically and show preview
            hint.classList.add('hidden');
            const link = document.createElement('a');
            link.download = filename;
            link.href = objectURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }, mimeType);
}

function resetImage() {
    if (!originalImage) return;
    saveState();
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    ctx.drawImage(originalImage, 0, 0);
    
    if (useWebGL) {
        createTexture(originalImage);
        createFramebuffer(canvas.width, canvas.height);
    }
    
    // Reset to the original defaults defined at lines 20-73
    Object.keys(defaultParams).forEach(function(key) {
        params[key] = JSON.parse(JSON.stringify(defaultParams[key]));
    });
    
    document.querySelectorAll('input[data-param]').forEach(function(input) {
        const paramName = input.dataset.param;
        const defaultValue = defaultParams[paramName];
        if (input.type === 'checkbox') {
            input.checked = defaultValue || false;
        } else {
            input.value = defaultValue !== undefined ? defaultValue : input.min || 0;
        }
    });

    document.querySelectorAll('select[data-param]').forEach(function(select) {
        const paramName = select.dataset.param;
        const defaultValue = defaultParams[paramName];
        if (defaultValue !== undefined) {
            select.value = defaultValue;
        } else {
            select.value = select.options[0].value;
        }
    });
    
    updateAllControlValues();
    processImage();
    showNotification('Image reset');
}

function formatControlValue(input) {
    return params[input.dataset.param];
}

function applyControlLimits() {
    Object.keys(controlLimits).forEach(function(paramName) {
        const limits = controlLimits[paramName];
        const elements = document.querySelectorAll(`[data-param="${paramName}"]`);
        elements.forEach(function(element) {
            if (element.type === 'range') {
                element.min = limits.min;
                element.max = limits.max;
            }
        });
    });
}

function updateAllControlValues() {
    document.querySelectorAll('input[data-param], select[data-param]').forEach(function(input) {
        if (!input.dataset.param) return;

        const valueSpan = input.parentElement.querySelector('.control-value');
        if (!valueSpan) return;

        if (input.type === 'checkbox') {
            // Checkboxes don't have value displays
            return;
        } else if (input.type === 'select-one') {
            valueSpan.textContent = input.value;
        } else {
            // Range inputs and text inputs
            valueSpan.textContent = formatControlValue(input);
        }
    });
}

function savePreset() {
    const name = document.getElementById('presetName').value.trim();
    if (!name) {
        showNotification('Enter a preset name');
        return;
    }
    
    presets[name] = JSON.parse(JSON.stringify(params));
    localStorage.setItem('retroPresets', JSON.stringify(presets));
    renderPresetList();
    showNotification('Preset saved');
}

function loadPreset(name) {
    if (!presets[name]) return;
    
    saveState();
    
    Object.keys(presets[name]).forEach(function(key) {
        params[key] = presets[name][key];
    });
    
    document.querySelectorAll('input[data-param]').forEach(function(input) {
        const param = input.dataset.param;
        if (params.hasOwnProperty(param)) {
            if (input.type === 'checkbox') {
                input.checked = params[param];
            } else {
                input.value = params[param];
            }
        }
    });
    
    document.querySelectorAll('select[data-param]').forEach(function(select) {
        const param = select.dataset.param;
        if (params.hasOwnProperty(param)) {
            select.value = params[param];
        }
    });
    
    updateAllControlValues();
    processImage();
    showNotification('Preset loaded');
}

function deletePreset(name) {
    delete presets[name];
    localStorage.setItem('retroPresets', JSON.stringify(presets));
    renderPresetList();
    showNotification('Preset deleted');
}

function downloadPreset(name) {
    if (!presets[name]) return;

    // Create JSON string from preset
    const presetData = JSON.stringify(presets[name], null, 2);

    // Create blob and download link
    const blob = new Blob([presetData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `retroinator-preset-${name}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function renderPresetList() {
    const list = document.getElementById('presetList');
    list.innerHTML = '';
    
    Object.keys(presets).forEach(function(name) {
        const item = document.createElement('div');
        item.className = 'preset-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'preset-name';
        nameSpan.textContent = name;
        
        const actions = document.createElement('div');
        actions.className = 'preset-actions';
        
        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn';
        loadBtn.textContent = 'Load';
        loadBtn.onclick = function() { loadPreset(name); document.getElementById('presetModal').classList.add('hidden'); };
        
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn';
        downloadBtn.textContent = 'Download';
        downloadBtn.onclick = function() { downloadPreset(name); };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = function() { deletePreset(name); };

        actions.appendChild(loadBtn);
        actions.appendChild(downloadBtn);
        actions.appendChild(deleteBtn);
        
        item.appendChild(nameSpan);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

function importPreset(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            Object.keys(imported).forEach(function(key) {
                if (params.hasOwnProperty(key)) {
                    params[key] = imported[key];
                }
            });
            
            document.querySelectorAll('input[data-param]').forEach(function(input) {
                const param = input.dataset.param;
                if (imported.hasOwnProperty(param)) {
                    if (input.type === 'checkbox') {
                        input.checked = imported[param];
                    } else {
                        input.value = imported[param];
                    }
                }
            });
            
            document.querySelectorAll('select[data-param]').forEach(function(select) {
                const param = select.dataset.param;
                if (imported.hasOwnProperty(param)) {
                    select.value = imported[param];
                }
            });
            
            updateAllControlValues();
            processImage();
            showNotification('Preset imported');
        } catch (err) {
            showNotification('Invalid preset file');
        }
    };
    reader.readAsText(file);
}

document.getElementById('fileInput').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
        loadImage(e.target.files[0]);
    }
});

document.getElementById('loadBtn').addEventListener('click', function() {
    document.getElementById('fileInput').click();
});

document.getElementById('exportBtn').addEventListener('click', function() {
    document.getElementById('exportModal').classList.remove('hidden');
});

document.getElementById('confirmExportBtn').addEventListener('click', function() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    document.getElementById('exportModal').classList.add('hidden');
    exportImage(format);
});

document.getElementById('cancelExportBtn').addEventListener('click', function() {
    document.getElementById('exportModal').classList.add('hidden');
});

document.getElementById('closeExportPreviewBtn').addEventListener('click', function() {
    const modal = document.getElementById('exportPreviewModal');
    if (modal.dataset.objectUrl) URL.revokeObjectURL(modal.dataset.objectUrl);
    document.getElementById('exportPreviewImg').src = '';
    modal.classList.add('hidden');
    showNotification('Export complete');
});

// Mobile toolbar button listeners (duplicate desktop buttons)
document.getElementById('loadBtnMobile').addEventListener('click', function() {
    document.getElementById('fileInput').click();
});

document.getElementById('exportBtnMobile').addEventListener('click', function() {
    document.getElementById('exportModal').classList.remove('hidden');
});

document.getElementById('undoBtnMobile').addEventListener('click', undo);
document.getElementById('redoBtnMobile').addEventListener('click', redo);

document.getElementById('loadPresetBtnMobile').addEventListener('click', function() {
    document.getElementById('presetModal').classList.remove('hidden');
    renderPresetList();
});

document.getElementById('resetBtnMobile').addEventListener('click', resetImage);

document.getElementById('savePresetBtnMobile').addEventListener('click', function() {
    document.getElementById('presetModal').classList.remove('hidden');
});

document.getElementById('resetBtn').addEventListener('click', resetImage);
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

document.getElementById('dropZone').addEventListener('click', function() {
    document.getElementById('fileInput').click();
});

document.getElementById('dropZoneBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('fileInput').click();
});

document.getElementById('dropZone').addEventListener('dragover', function(e) {
    e.preventDefault();
    this.classList.add('dragover');
});

document.getElementById('dropZone').addEventListener('dragleave', function() {
    this.classList.remove('dragover');
});

document.getElementById('dropZone').addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        loadImage(e.dataTransfer.files[0]);
    }
});

document.querySelectorAll('.tool-header').forEach(function(header) {
    header.addEventListener('click', function() {
        this.parentElement.classList.toggle('collapsed');
    });
});

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
        
        params[param] = value;

        const valueSpan = this.parentElement.querySelector('.control-value');
        if (valueSpan) {
            valueSpan.textContent = formatControlValue(this);
        }

        processImage();
    });
});

document.getElementById('savePresetBtn').addEventListener('click', function() {
    document.getElementById('presetModal').classList.remove('hidden');
});

document.getElementById('loadPresetBtn').addEventListener('click', function() {
    document.getElementById('presetModal').classList.remove('hidden');
    renderPresetList();
});

document.getElementById('closeModalBtn').addEventListener('click', function() {
    document.getElementById('presetModal').classList.add('hidden');
});

document.getElementById('savePresetBtn2').addEventListener('click', savePreset);

document.getElementById('importPresetBtn').addEventListener('click', function() {
    document.getElementById('presetFileInput').click();
});

document.getElementById('presetFileInput').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
        importPreset(e.target.files[0]);
    }
});

document.getElementById('timestampNowBtn').addEventListener('click', function() {
    const now = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const ts = months[now.getMonth()] + ' ' +
               String(now.getDate()).padStart(2, '0') + ' ' +
               now.getFullYear() + ' ' +
               String(now.getHours()).padStart(2, '0') + ':' +
               String(now.getMinutes()).padStart(2, '0') + ':' +
               String(now.getSeconds()).padStart(2, '0');
    
    document.querySelector('input[data-param="vhsTimestamp"]').value = ts;
    params.vhsTimestamp = ts;
    processImage();
});

document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o') {
            e.preventDefault();
            document.getElementById('fileInput').click();
        } else if (e.key === 'e') {
            e.preventDefault();
            document.getElementById('exportModal').classList.remove('hidden');
        } else if (e.key === 's' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('presetModal').classList.remove('hidden');
        } else if (e.key === 's' && e.shiftKey) {
            e.preventDefault();
            document.getElementById('presetModal').classList.remove('hidden');
            renderPresetList();
        } else if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        } else if (e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            redo();
        }
    }
});

renderPresetList();
initWebGL();

function initMobileUI() {
    const isMobile = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches || 'ontouchstart' in window;
    
    if (!isMobile) return;
    
    const statusBar = document.querySelector('.status-bar');
    const toolbar = document.querySelector('.toolbar');
    
    let toggleBtn = document.querySelector('.toolbar-toggle-mobile');
    if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.className = 'mobile-menu-toggle toolbar-toggle-mobile';
        toggleBtn.innerHTML = '&#9776;';
        toggleBtn.setAttribute('aria-label', 'Toggle toolbar menu');
        statusBar.insertBefore(toggleBtn, statusBar.firstChild);
    }
    
    const sidebar = document.querySelector('.sidebar');
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }
    
    let closeBtn = sidebar.querySelector('.sidebar-close-btn');
    if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.className = 'btn sidebar-close-btn';
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'width:100%;margin-bottom:10px;';
        sidebar.insertBefore(closeBtn, sidebar.firstChild);
    }
    
    if (!toggleBtn._hasListener) {
        toggleBtn._hasListener = true;
        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toolbar.classList.toggle('open');
            sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        });
    }
    
    let sidebarToggle = document.querySelector('.sidebar-toggle-mobile');
    if (!sidebarToggle) {
        sidebarToggle = document.createElement('button');
        sidebarToggle.className = 'mobile-menu-toggle sidebar-toggle-mobile';
        sidebarToggle.innerHTML = '&#9881;';
        sidebarToggle.setAttribute('aria-label', 'Toggle settings sidebar');
        statusBar.insertBefore(sidebarToggle, statusBar.firstChild);
    }
    
    if (!sidebarToggle._hasListener) {
        sidebarToggle._hasListener = true;
        
        sidebarToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            sidebar.classList.add('open');
            document.body.classList.add('sidebar-open');
            toolbar.classList.remove('open');
        });
    }
    
    if (!backdrop._hasListener) {
        backdrop._hasListener = true;
        backdrop.addEventListener('click', function() {
            sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        });
    }
    
    if (!closeBtn._hasListener) {
        closeBtn._hasListener = true;
        closeBtn.addEventListener('click', function() {
            sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        });
    }
}

applyControlLimits();
initMobileUI();
window.addEventListener('resize', initMobileUI);
window.addEventListener('orientationchange', function() {
    setTimeout(initMobileUI, 100);
});