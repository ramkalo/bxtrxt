const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const FRAGMENT_SHADER_HEADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_temperature;
uniform float u_tint;

uniform float u_digitizeDither;
uniform float u_digitizeNoise;

uniform float u_grainIntensity;

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

uniform float u_vignetteIntensity;

uniform bool u_vhsEnabled;
uniform float u_vhsTracking;
uniform float u_vhsBleed;
uniform float u_vhsNoise;

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

// Bayer 4x4 dither matrix
const float bayer4x4[16] = float[16](
    0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
   12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
    3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
   15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Exact CRT wave formula from original code
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
    vec4 color = texture(u_image, uv);
`;

const FRAGMENT_SHADER_FOOTER = `
    fragColor = color;
}`;

function createBasicAdjustmentsShader() {
    return `
    // Basic Adjustments
    float lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    
    // Highlights
    if (u_highlights != 0.0) {
        float hf = u_highlights * (lum / 255.0) * 0.3;
        color.rgb += hf;
    }
    
    // Shadows
    if (u_shadows != 0.0) {
        float sf = u_shadows * ((255.0 - lum) / 255.0) * 0.3;
        color.rgb += sf;
    }
    
    // Contrast & Brightness
    float contrastFactor = (u_contrast + 100.0) / 100.0;
    color.rgb = color.rgb * contrastFactor + u_brightness;
    
    // Saturation
    if (u_saturation != 0.0) {
        float sat = 1.0 + u_saturation / 100.0;
        float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
        color.r = gray + sat * (color.r - gray);
        color.g = gray + sat * (color.g - gray);
        color.b = gray + sat * (color.b - gray);
    }
    
    // Temperature
    if (u_temperature != 0.0) {
        float temp = u_temperature / 100.0;
        color.r += temp * 25.0;
        color.b -= temp * 25.0;
    }
    
    // Tint
    if (u_tint != 0.0) {
        color.g += u_tint * 0.25;
    }
    
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createDigitizeDitherShader() {
    return `
    // Digitize Dithering (ordered dither - 4x4 Bayer matrix)
    if (u_digitizeDither > 0.0) {
        float amount = u_digitizeDither / 100.0;
        int x = int(mod(gl_FragCoord.x, 4.0));
        int y = int(mod(gl_FragCoord.y, 4.0));
        float threshold = bayer4x4[y * 4 + x] * amount;
        color.rgb = floor(color.rgb / 32.0 + threshold) * 32.0;
    }
`;
}

function createDigitizeNoiseShader() {
    return `
    // Digitize Noise
    if (u_digitizeNoise > 0.0) {
        float intensity = u_digitizeNoise / 100.0 * 80.0;
        float noise = (rand(v_texCoord + u_time) - 0.5) * intensity;
        color.rgb += noise;
    }
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createGrainShader() {
    return `
    // Film Grain
    if (u_grainIntensity > 0.0) {
        float intensity = u_grainIntensity / 100.0 * 50.0;
        float noise = (rand(v_texCoord + u_time * 0.001) - 0.5) * intensity;
        color.rgb += noise;
    }
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createPixelArtShader() {
    return `
    // Pixel Art
    if (u_pixelArtEnabled) {
        vec2 pixelUV = floor(v_texCoord * u_resolution / u_pixelSize) * u_pixelSize / u_resolution;
        vec4 pixelColor = texture(u_image, pixelUV);
        
        float step = 256.0 / u_pixelColors;
        pixelColor.rgb = floor(pixelColor.rgb / step + 0.5) * step;
        
        color = pixelColor;
    }
`;
}

function createChromaticAberrationShader() {
    return `
    // Chromatic Aberration
    if (u_chromaEnabled) {
        vec2 redOffset = vec2(u_chromaRedX, u_chromaRedY) / u_resolution;
        vec2 greenOffset = vec2(u_chromaGreenX, u_chromaGreenY) / u_resolution;
        vec2 blueOffset = vec2(u_chromaBlueX, u_chromaBlueY) / u_resolution;
        
        color.r = texture(u_image, uv + redOffset).r;
        color.g = texture(u_image, uv + greenOffset).g;
        color.b = texture(u_image, uv + blueOffset).b;
    }
`;
}

function createVignetteShader() {
    return `
    // Vignette
    if (u_vignetteIntensity > 0.0) {
        vec2 center = vec2(0.5);
        float dist = distance(uv, center);
        float maxDist = 0.7071; // sqrt(0.5^2 + 0.5^2)
        float vignette = 1.0 - pow(dist / maxDist, 2.0) * (u_vignetteIntensity / 100.0);
        color.rgb *= vignette;
    }
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createVHSTrackingShader() {
    return `
    // VHS Tracking lines
    if (u_vhsEnabled && u_vhsTracking > 0.0) {
        int numLines = int(u_vhsTracking / 15.0);
        float lineY = mod(float(int(u_time * 100.0)) * 0.1, 1.0);
        for (int i = 0; i < 7; i++) {
            if (i < numLines) {
                float rowY = fract(float(i) * 0.1324 + u_time * 0.5);
                float rowDist = abs(uv.y - rowY);
                if (rowDist < 1.0 / u_resolution.y * 2.0) {
                    float offset = (rand(vec2(float(i), u_time)) - 0.5) * 30.0;
                    vec2 trackingUV = vec2(uv.x + offset / u_resolution.x, uv.y);
                    color = texture(u_image, trackingUV);
                }
            }
        }
    }
`;
}

function createVHSBleedShader() {
    return `
    // VHS Color Bleed
    if (u_vhsEnabled && u_vhsBleed > 0.0) {
        float bleed = u_vhsBleed / u_resolution.x;
        color.r = texture(u_image, vec2(uv.x - bleed, uv.y)).r;
        color.b = texture(u_image, vec2(uv.x + bleed, uv.y)).b;
    }
`;
}

function createVHSNoiseShader() {
    return `
    // VHS Noise
    if (u_vhsEnabled && u_vhsNoise > 0.0) {
        float intensity = u_vhsNoise / 100.0 * 120.0;
        float noise = (rand(v_texCoord + u_time) - 0.5) * intensity;
        color.rgb += noise;
    }
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createCRTCurvatureShader() {
    return `
    // CRT Curvature (barrel distortion)
    if (u_crtEnabled && u_crtCurvature > 0.0) {
        vec2 center = vec2(u_crtCurvatureX / 100.0, u_crtCurvatureY / 100.0);
        float maxRadius = min(u_resolution.x, u_resolution.y) * (u_crtCurvatureRadius / 100.0) / u_resolution.x;
        float intensity = u_crtCurvature / 100.0 * u_crtCurvatureIntensity / 100.0;
        float k = intensity;
        
        vec2 dc = uv - center;
        float r = length(dc);
        
        if (r > 0.0 && r < maxRadius) {
            float factor = 1.0 - k * pow(1.0 - r / maxRadius, 2.0);
            uv = center + dc * factor;
        }
        
        // Clamp to edge
        uv = clamp(uv, 0.0, 1.0);
        color = texture(u_image, uv);
    }
`;
}

function createCRTScanlinesShader() {
    return `
    // CRT Scanlines
    if (u_crtEnabled && u_crtScanline > 0.0) {
        float spacing = u_crtScanSpacing;
        float row = mod(gl_FragCoord.y, spacing);
        if (row < 1.0) {
            float darken = 1.0 - u_crtScanline / 100.0 * 0.7;
            color.rgb *= darken;
        }
    }
`;
}

function createCRTWavesShader() {
    return `
    // CRT Waves (exact formula from original)
    if (u_crtEnabled && u_crtWaves > 0.0) {
        float amplitude = u_crtWaves / 100.0;
        float phase = u_crtWavePhase / 100.0 * 20.0;
        
        float offset = crtWave(uv, phase, amplitude * 80.0) / u_resolution.x;
        
        float r = texture(u_image, vec2(uv.x + offset, uv.y)).r;
        float g = color.g;
        float b = texture(u_image, vec2(uv.x - offset, uv.y)).b;
        
        color.rgb = vec3(r, g, b);
    }
`;
}

function createCRTStaticShader() {
    return `
    // CRT Static
    if (u_crtEnabled && u_crtStatic > 0.0) {
        float intensity = u_crtStatic / 100.0;
        float noise = (rand(v_texCoord + u_time) - 0.5) * 255.0 * intensity;
        
        if (u_crtStaticType == 0) {
            // White
            color.rgb += noise;
        } else if (u_crtStaticType == 1) {
            // Color
            color.r += noise * rand(v_texCoord + u_time + 0.1);
            color.g += noise * rand(v_texCoord + u_time + 0.2);
            color.b += noise * rand(v_texCoord + u_time + 0.3);
        } else {
            // Luma
            float gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
            float newGray = clamp(gray + noise, 0.0, 255.0);
            float ratio = newGray / max(gray, 0.001);
            color.rgb *= ratio;
        }
    }
    color.rgb = clamp(color.rgb, 0.0, 255.0);
`;
}

function createFullShader(effects) {
    let shader = FRAGMENT_SHADER_HEADER;
    
    // Apply effects in order
    for (const effect of effects) {
        switch(effect) {
            case 'basic': shader += createBasicAdjustmentsShader(); break;
            case 'dither': shader += createDigitizeDitherShader(); break;
            case 'noise': shader += createDigitizeNoiseShader(); break;
            case 'grain': shader += createGrainShader(); break;
            case 'pixel': shader += createPixelArtShader(); break;
            case 'chroma': shader += createChromaticAberrationShader(); break;
            case 'vignette': shader += createVignetteShader(); break;
            case 'vhsTracking': shader += createVHSTrackingShader(); break;
            case 'vhsBleed': shader += createVHSBleedShader(); break;
            case 'vhsNoise': shader += createVHSNoiseShader(); break;
            case 'crtCurvature': shader += createCRTCurvatureShader(); break;
            case 'crtScanlines': shader += createCRTScanlinesShader(); break;
            case 'crtWaves': shader += createCRTWavesShader(); break;
            case 'crtStatic': shader += createCRTStaticShader(); break;
        }
    }
    
    shader += FRAGMENT_SHADER_FOOTER;
    return shader;
}

const SHADERS = {
    VERTEX_SHADER,
    FRAGMENT_SHADER_HEADER,
    FRAGMENT_SHADER_FOOTER,
    createFullShader,
    createBasicAdjustmentsShader,
    createDigitizeDitherShader,
    createDigitizeNoiseShader,
    createGrainShader,
    createPixelArtShader,
    createChromaticAberrationShader,
    createVignetteShader,
    createVHSTrackingShader,
    createVHSBleedShader,
    createVHSNoiseShader,
    createCRTCurvatureShader,
    createCRTScanlinesShader,
    createCRTWavesShader,
    createCRTStaticShader
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SHADERS;
}