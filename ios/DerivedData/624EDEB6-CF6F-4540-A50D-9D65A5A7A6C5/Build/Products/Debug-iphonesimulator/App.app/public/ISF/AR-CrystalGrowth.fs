/*{
    "DESCRIPTION": "Crystalline dendrite structures growing from center with snowflake symmetry. Branch count and growth driven by FFT. Crystal edges glow with energy. Frost-like procedural fractal branching.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "branchCount", "TYPE": "float", "MIN": 4.0, "MAX": 8.0, "DEFAULT": 6.0},
        {"NAME": "growthSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "crystalSharp", "TYPE": "float", "MIN": 4.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "symmetry", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 6.0},
        {"NAME": "glowPower", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0},
        {"NAME": "meltRate", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.02}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Crystal branch shape in polar coords
float crystalBranch(vec2 p, float sym, float sharp, float growth) {
    float r = length(p);
    float a = atan(p.y, p.x);

    // Fold into symmetry sectors
    float sector = PI / sym;
    a = abs(mod(a + sector, 2.0 * sector) - sector);

    // Main branch spine along a=0
    float spine = exp(-a * sharp) * growth;

    // Sub-branches at intervals along the spine
    float subBranch = 0.0;
    for (int i = 1; i < 6; i++) {
        float fi = float(i);
        float branchR = fi * 0.15 * growth;
        if (r > branchR - 0.05 && r < branchR + 0.15) {
            float localA = a;
            float subSpine = exp(-abs(localA - 0.3) * sharp * 0.6);
            subSpine *= smoothstep(branchR - 0.05, branchR, r);
            subSpine *= smoothstep(branchR + 0.15, branchR + 0.05, r);
            subBranch += subSpine * 0.5;
        }
    }

    // Dendrite detail using FBM
    float detail = fbm(p * 8.0 + TIME * 0.1);
    float dendriteShape = spine + subBranch + detail * 0.15;

    // Sharp crystal threshold
    float crystal = smoothstep(r - 0.02, r + 0.02, dendriteShape);
    return crystal;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);

    // Audio with fallbacks
    float levelFallback = 0.4 + 0.2 * sin(TIME * 0.6);
    float bassFallback = 0.3 + 0.2 * sin(TIME * 0.8);
    float highFallback = 0.3 + 0.15 * cos(TIME * 1.1);
    float beatFallback = 0.15 + 0.15 * sin(TIME * 2.5);

    float level = max(audioLevel, levelFallback);
    float bass = max(audioBass, bassFallback);
    float high = max(audioHigh, highFallback);
    float beat = max(audioBeat, beatFallback);

    // Growth front - advances with energy, retreats with melt
    float growthFront = 0.3 + 0.6 * level * growthSpeed;
    growthFront += bass * 0.2;
    growthFront -= meltRate * (1.0 - level);
    growthFront = clamp(growthFront, 0.1, 1.2);

    // Dynamic symmetry
    float sym = floor(symmetry + 0.5);

    // Build crystal layers
    float crystal = 0.0;
    float edgeDist = 1.0;

    // Multiple crystal layers at slightly different scales
    for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float layerScale = 1.0 + fl * 0.3;
        float layerGrowth = growthFront * (1.0 - fl * 0.25);

        // FFT modulation per layer
        float fftPos = fl / 3.0;
        float fftVal = sampleFFT(fftPos);
        float fftFallback = 0.3 + 0.2 * sin(TIME + fl * 2.0);
        fftVal = max(fftVal, fftFallback);
        layerGrowth *= 0.7 + fftVal * 0.6;

        float layerCrystal = crystalBranch(p * layerScale, sym, crystalSharp, layerGrowth);

        // Distance to crystal edge for glow
        float layerEdge = abs(layerCrystal - 0.5);
        edgeDist = min(edgeDist, layerEdge);

        crystal += layerCrystal * (1.0 - fl * 0.2);
    }
    crystal = clamp(crystal, 0.0, 1.0);

    // Interior color - icy blue to white
    float hue = 0.55 + 0.1 * crystal + high * 0.05;
    float sat = 0.5 * (1.0 - crystal * 0.4);
    float val = crystal * (0.8 + level * 0.4);

    vec3 col = hsv2rgb(vec3(hue, sat, val));

    // Edge glow
    float glow = exp(-edgeDist * glowPower * 10.0);
    vec3 glowCol = hsv2rgb(vec3(0.6 + audioSpectralCentroid * 0.15, 0.7, 1.0));
    col += glowCol * glow * (0.5 + beat * 0.8);

    // Crystal sparkle from high frequencies
    float sparkle = noise(p * 40.0 + TIME * 3.0);
    sparkle = pow(sparkle, 8.0) * high * crystal;
    col += vec3(0.8, 0.9, 1.0) * sparkle * 2.0;

    // Radial fade at growth boundary
    float growthMask = smoothstep(growthFront + 0.1, growthFront - 0.05, r);
    col *= growthMask;

    // Background subtle ice texture
    float bgTex = fbm(p * 6.0 + TIME * 0.05);
    vec3 bgCol = vec3(0.02, 0.04, 0.08) * (0.5 + bgTex * 0.5);
    col = mix(bgCol, col, growthMask * crystal + glow * 0.3);

    // Beat pulse - flash the whole crystal
    col += col * beat * 0.4;

    // Vignette
    float vig = 1.0 - r * r * 0.6;
    col *= clamp(vig, 0.0, 1.0);

    // Tone mapping
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
