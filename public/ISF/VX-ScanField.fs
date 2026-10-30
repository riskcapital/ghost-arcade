/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A scan-processor landscape: horizontal scan lines lifted by a moving terrain, drawn as thin beams with hidden lines removed. Every hit of the sound it follows drops a ripple into the field that rolls out through the lines; the sound's level lifts the land.",
    "PASSES": [
        {
            "TARGET": "waves",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 256,
            "HEIGHT": 256
        },
        {
            "TARGET": "terrain",
            "FLOAT": true,
            "WIDTH": 512,
            "HEIGHT": 512
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 96, "MIN": 24, "MAX": 160 },
        { "NAME": "relief", "LABEL": "Relief", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripple", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ring", "LABEL": "Ring time", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "horizon", "LABEL": "Horizon", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "hidden", "LABEL": "Hidden lines", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "width", "LABEL": "Beam", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "fog", "LABEL": "Distance fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.86, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Ripples", "TYPE": "color", "DEFAULT": [0.32, 0.47, 1.0, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// World: the camera looks along +z over a plane. Scan lines sit at even
// depths from Z_NEAR to Z_FAR; each is lifted by the relief at its depth.
const float Z_NEAR = 1.0;
const float Z_FAR = 10.0;
const float X_EXTENT = 8.0;
// The ripples live in a smaller field that covers what the camera sees up close.
const float WAVE_X = 4.5;
const float WAVE_Z = 7.0;
const int MAX_CANDIDATES = 56;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Ridged noise: sharp crests, soft valleys, like land seen by a scanner.
float ridged(vec2 q) {
    vec2 p = q;
    float sum = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 4; i++) {
        float n = 1.0 - abs(valueNoise(p) * 2.0 - 1.0);
        sum += n * n * amp;
        p = p * 2.03 + vec2(17.1, 9.7);
        amp *= 0.5;
    }
    return sum;
}

// Crests and troughs ease into their limits instead of flattening.
float softLift(float v, float drop, float lift) {
    return v >= 0.0 ? lift * tanh(v / lift) : -drop * tanh(-v / drop);
}

float horizonY() {
    return 0.56 + horizon * 0.3;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    if (PASSINDEX == 0) {
        // A damped wave equation: r is the height now, g the height a frame ago.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 c = IMG_NORM_PIXEL(waves, uv);
        float h = c.r;
        float lap = IMG_NORM_PIXEL(waves, uv + vec2(px.x, 0.0)).r
                  + IMG_NORM_PIXEL(waves, uv - vec2(px.x, 0.0)).r
                  + IMG_NORM_PIXEL(waves, uv + vec2(0.0, px.y)).r
                  + IMG_NORM_PIXEL(waves, uv - vec2(0.0, px.y)).r
                  - 4.0 * h;
        // Tuned for 60 frames a second; slower frame rates ring a little slower.
        float frames = clamp(TIMEDELTA * 60.0, 0.25, 1.0);
        float damp = pow(mix(0.955, 0.996, ring), frames);
        float next = (2.0 * h - c.g + 0.48 * frames * lap) * damp;
        // Each hit lands somewhere new in view (spread), nudged sideways by pitch.
        float n = floor(vxCount + 0.5);
        vec2 world = vec2((uv.x * 2.0 - 1.0) * WAVE_X, Z_NEAR + uv.y * (WAVE_Z - Z_NEAR));
        float zHit = mix(2.2, 2.2 + 3.5 * spread, hash11(n * 7.31 + 4.0));
        float halfView = 0.5 * (RENDERSIZE.x > 0.0 ? 1.7778 : 1.0) * zHit * 0.9;
        float xHit = ((hash11(n * 3.17 + 1.0) - 0.5) * spread * 1.4 + (vxGlide - 0.42) * 1.2) * halfView;
        vec2 d = world - vec2(xHit, zHit);
        next += vxHit * vxHit * ripple * 0.2 * exp(-dot(d, d) / 0.09);
        if (FRAMEINDEX < 2) next = 0.0;
        gl_FragColor = vec4(clamp(next, -2.0, 2.0), h, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        // The relief: land flowing toward the camera, plus the ripples.
        float x = (uv.x * 2.0 - 1.0) * X_EXTENT;
        float z = mix(Z_NEAR, Z_FAR, uv.y);
        float travel = vxPhase * (0.15 + flow * 1.6);
        float land = ridged(vec2(x * 0.32, (z + travel) * 0.32));
        // The middle of the field is quieter, so ripples read against it.
        float valley = smoothstep(0.0, 4.5, abs(x));
        float lift = 0.7 + 0.6 * vxEnv;
        vec2 wuv = vec2(x / WAVE_X * 0.5 + 0.5, (z - Z_NEAR) / (WAVE_Z - Z_NEAR));
        float edge = smoothstep(0.0, 0.08, wuv.x) * smoothstep(1.0, 0.92, wuv.x) * smoothstep(1.0, 0.85, wuv.y);
        float w = (wuv.y <= 1.0) ? IMG_NORM_PIXEL(waves, clamp(wuv, 0.0, 1.0)).r * edge : 0.0;
        float height = land * relief * lift * (0.35 + 0.65 * valley) + w * 1.6;
        gl_FragColor = vec4(height, w, 0.0, 1.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float yh = horizonY();
    float y = uv.y;
    vec3 col = vec3(0.0);

    if (y < yh) {
        float count = floor(lines);
        float c = yh - 0.035;
        // Most lift any line gets, as a share of its distance below the horizon.
        float maxLift = 0.62;
        // Troughs drop a line below its rest height, crests lift it.
        float maxDrop = 0.3;
        float zMin = max(Z_NEAR, c * (1.0 - maxLift) / (yh - y));
        float zMax = min(Z_FAR, c * (1.0 + maxDrop) / (yh - y));
        float spacing = (Z_FAR - Z_NEAR) / count;
        float k0 = max(0.0, ceil((zMin - Z_NEAR) / spacing));
        float k1 = min(count - 1.0, floor((zMax - Z_NEAR) / spacing));

        float pxY = 1.0 / RENDERSIZE.y;
        float beam = 0.55 + width * 1.6;
        float sky = -1.0;
        float light = 0.0;
        float rippleGlow = 0.0;

        for (int i = 0; i < MAX_CANDIDATES; i++) {
            float k = k0 + float(i);
            if (k > k1) break;
            float z = Z_NEAR + k * spacing;
            float t = (z - Z_NEAR) / (Z_FAR - Z_NEAR);
            float scale = c / z;
            // World x under this pixel, and one pixel to the right, at this depth.
            float wx = (uv.x - 0.5) * aspect * z * 0.9;
            float wx2 = (uv.x + 1.0 / RENDERSIZE.x - 0.5) * aspect * z * 0.9;
            vec2 r1 = IMG_NORM_PIXEL(terrain, vec2(wx / X_EXTENT * 0.5 + 0.5, t)).rg;
            float h2 = IMG_NORM_PIXEL(terrain, vec2(wx2 / X_EXTENT * 0.5 + 0.5, t)).r;
            float lift1 = softLift(r1.x * 0.5, maxDrop, maxLift);
            float lift2 = softLift(h2 * 0.5, maxDrop, maxLift);
            float yd = yh - scale * (1.0 - lift1);
            float yd2 = yh - scale * (1.0 - lift2);
            // Distance to the beam in pixels, measured across the line.
            float slopePx = (yd2 - yd) / pxY;
            float dist = abs(y - yd) / pxY / sqrt(1.0 + slopePx * slopePx);
            // A line hidden behind nearer land shows only as much as `hidden` allows.
            float shown = (y >= sky - pxY * 0.5) ? 1.0 : 1.0 - hidden;
            float core = exp(-dist * dist / (beam * beam)) + 0.12 * exp(-dist / (beam * 3.0));
            // The beam slows on flat runs, so they burn brighter, as on a scan processor.
            float speed = 1.0 / (1.0 + abs(slopePx) * 0.35);
            float near = exp(-t * (0.4 + fog * 3.2));
            light = max(light, core * shown * (0.35 + 0.65 * speed) * near * (0.55 + 0.45 * clamp(r1.x, 0.0, 1.0)));
            rippleGlow = max(rippleGlow, core * shown * near * smoothstep(0.03, 0.25, abs(r1.y)));
            sky = max(sky, yd);
        }
        col = ink.rgb * light;
        col = mix(col, accent.rgb * (light + 0.25 * rippleGlow), clamp(rippleGlow * 1.2, 0.0, 1.0));
    }

    // Blue-noise-ish dither keeps the soft falloff from banding.
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
