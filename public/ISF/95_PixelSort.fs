/*{
    "DESCRIPTION": "Pixel sorting aesthetic with vertical and horizontal streaks driven by audio",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "streakLength", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.05, "MAX": 1.0},
        {"NAME": "noiseScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "sortDirection", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (float i = 0.0; i < 4.0; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    // Audio reactivity
    float bassStretch = 1.0 + audioBass * 1.5;
    float midThreshold = 0.3 + audioMid * 0.3;
    float beatGlitch = audioBeat;
    float highNoise = 1.0 + audioHigh * 0.5;

    // Base noise pattern to determine "brightness" for sorting
    vec2 noiseUV = uv * noiseScale + vec2(t * 0.2, t * 0.1);
    float baseNoise = fbm(noiseUV * highNoise);

    // Threshold for sort region
    float sortMask = smoothstep(midThreshold, midThreshold + 0.1, baseNoise);

    // Sort direction mixing (0 = horizontal, 1 = vertical)
    float dirMix = sortDirection + audioBass * 0.2;
    dirMix = clamp(dirMix, 0.0, 1.0);

    // Horizontal streak
    float hStreak = fract(uv.x + baseNoise * streakLength * bassStretch + t * 0.3);

    // Vertical streak
    float vStreak = fract(uv.y + baseNoise * streakLength * bassStretch + t * 0.2);

    // Mix direction
    float streak = mix(hStreak, vStreak, dirMix);

    // Generate color from the "sorted" position
    vec2 sortedUV = mix(
        vec2(hStreak, uv.y),
        vec2(uv.x, vStreak),
        dirMix
    );

    // Colorful pattern from sorted coordinates
    float r = fbm(sortedUV * 3.0 + vec2(t * 0.1, 0.0));
    float g = fbm(sortedUV * 3.0 + vec2(0.0, t * 0.1));
    float b = fbm(sortedUV * 3.0 + vec2(t * 0.05, t * 0.05));

    vec3 sortedColor = vec3(r, g, b) * colorIntensity;

    // Original unsorted color (more structured)
    float hue = fbm(uv * noiseScale + t * 0.1);
    vec3 origColor = vec3(
        0.5 + 0.5 * cos(hue * 6.28),
        0.5 + 0.5 * cos(hue * 6.28 + 2.09),
        0.5 + 0.5 * cos(hue * 6.28 + 4.18)
    ) * 0.6;

    // Blend sorted and unsorted based on mask
    vec3 col = mix(origColor, sortedColor, sortMask);

    // Beat glitch - offset strips
    float glitchStrip = step(0.9, hash(vec2(floor(uv.y * 30.0), floor(t * 3.0))));
    col = mix(col, col.gbr, glitchStrip * beatGlitch);

    // Scanline overlay
    float scanline = 0.95 + 0.05 * sin(uv.y * RENDERSIZE.y * 1.0);
    col *= scanline;

    gl_FragColor = vec4(col, 1.0);
}
