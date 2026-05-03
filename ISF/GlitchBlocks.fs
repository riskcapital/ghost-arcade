/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Digital glitch block effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "blockSize", "TYPE": "float", "MIN": 4.0, "MAX": 32.0, "DEFAULT": 12.0},
        {"NAME": "glitchRate", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "colorGlitch", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "rgbSplit", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.02}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash2(float n) {
    return fract(sin(n) * 43758.5453);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    float t = floor(iTime * glitchRate);

    // Block grid
    vec2 blockUv = floor(uv * blockSize) / blockSize;
    vec2 blockId = floor(uv * blockSize);

    // Random values per block per time
    float r1 = hash(blockId + t);
    float r2 = hash(blockId + t + 100.0);
    float r3 = hash(blockId + t + 200.0);

    // Decide if block should glitch
    float shouldGlitch = step(1.0 - intensity, r1);

    vec3 col = vec3(0.1, 0.1, 0.12); // Base dark color

    if (shouldGlitch > 0.5) {
        // Glitch effects
        float effectType = floor(r2 * 4.0);

        if (effectType < 1.0) {
            // Solid color block
            float hue = hash2(t + blockId.x * 13.0 + blockId.y * 7.0);
            col = hsv2rgb(vec3(hue, 0.8, 0.9));
        } else if (effectType < 2.0) {
            // White flash
            col = vec3(1.0);
        } else if (effectType < 3.0) {
            // Inverted block
            col = vec3(1.0) - col;
            col *= vec3(r1, r2, r3);
        } else {
            // Colored noise
            col = vec3(
                hash(blockId * 1.1 + t),
                hash(blockId * 2.2 + t),
                hash(blockId * 3.3 + t)
            );
        }

        // Color channel glitch
        if (colorGlitch > 0.0) {
            float colorShift = hash(blockId + t + 500.0) * colorGlitch;
            col = vec3(col.r, col.g * (1.0 - colorShift), col.b);
        }
    }

    // RGB split
    if (rgbSplit > 0.0) {
        float splitAmount = rgbSplit * (0.5 + 0.5 * sin(iTime * 10.0));
        vec2 uvR = uv + vec2(splitAmount, 0.0);
        vec2 uvB = uv - vec2(splitAmount, 0.0);

        vec2 blockR = floor(uvR * blockSize);
        vec2 blockB = floor(uvB * blockSize);

        float rGlitch = step(1.0 - intensity, hash(blockR + t));
        float bGlitch = step(1.0 - intensity, hash(blockB + t));

        if (rGlitch > 0.5) col.r = hash(blockR + t + 10.0);
        if (bGlitch > 0.5) col.b = hash(blockB + t + 20.0);
    }

    // Scanlines
    float scanline = sin(fragCoord.y * 2.0) * 0.02;
    col -= scanline;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
