/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A camera pointed at its own monitor. A thin ring, square or line sits near the middle of the screen, and the loop copies the screen into itself again and again, slightly larger and turned, so the seed opens into a deep tunnel of echoes that drift towards the accent as they age. Each hit flashes the seed and the flash runs out through the tunnel; the sound's level pushes the gain towards the edge.",
    "PASSES": [
        {
            "TARGET": "screen",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 9, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "zoom", "LABEL": "Zoom", "TYPE": "float", "DEFAULT": 0.5, "MIN": -1, "MAX": 1 },
        { "NAME": "rotate", "LABEL": "Rotate", "TYPE": "float", "DEFAULT": 0.3, "MIN": -1, "MAX": 1 },
        { "NAME": "gain", "LABEL": "Gain", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "shift", "LABEL": "Shift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tint", "LABEL": "Tint", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "seedShape", "LABEL": "Seed shape", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Changes each hit", "Ring", "Square", "Line"] },
        { "NAME": "seedSize", "LABEL": "Seed size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "symmetry", "LABEL": "Symmetry", "TYPE": "float", "DEFAULT": 1, "MIN": 1, "MAX": 6 },
        { "NAME": "ink", "LABEL": "Seeds", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Echoes", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// The loop runs at a fixed rate whatever the frame rate, so the echoes
// always sit the same distance apart.
const float STEP_RATE = 20.0;

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

mat2 rot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

// Distance from p to a seed shape centred at the origin, in frame-height units.
// kind: 0 ring with a small gap (so the loop's turn shows as a spiral),
// 1 square outline, 2 line.
float seedDist(vec2 p, float kind, float size) {
    if (kind < 0.5) {
        const float GAP = 0.3;
        if (abs(atan(p.y, p.x)) > GAP) return abs(length(p) - size);
        vec2 e = size * vec2(cos(GAP), sin(GAP));
        return min(length(p - e), length(p - vec2(e.x, -e.y)));
    }
    if (kind < 1.5) {
        vec2 a = abs(p);
        vec2 dq = a - vec2(size * 0.8);
        float outside = length(max(dq, 0.0));
        float inside = min(max(dq.x, dq.y), 0.0);
        return abs(outside + inside);
    }
    float t = clamp(p.x, -size * 1.3, size * 1.3);
    return length(p - vec2(t, 0.0));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 asp = vec2(aspect, 1.0);
    float px = 1.0 / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        vec2 p = (uv - 0.5) * asp;

        // How many loop steps fall in this frame (0 or 1 at 30 or 60 fps).
        float k1 = floor(TIME * STEP_RATE + 0.001);
        float k0 = floor(max(TIME - TIMEDELTA, 0.0) * STEP_RATE + 0.001);
        float steps = clamp(k1 - k0, 0.0, 3.0);

        // One step of the camera: zoomed and turned about a vanishing point
        // that the motion clock walks slowly around the middle.
        float lz = zoom * 0.16;
        float ang = rotate * 0.05 + 0.012 * sin(vxPhase * 0.4);
        vec2 fp = shift * 0.1 * vec2(cos(vxPhase * 0.8), sin(vxPhase * 0.67));
        float g = min(mix(0.8, 0.97, gain) + 0.03 * vxEnv, 0.99);

        vec3 c;
        if (steps < 0.5) {
            // Between steps the monitor holds its picture.
            c = IMG_NORM_PIXEL(screen, uv).rgb;
        } else {
            vec2 q = fp + rot2(ang * steps) * (p - fp) * exp(-lz * steps);
            vec2 quv = q / asp + 0.5;
            vec2 inside = step(vec2(0.0), quv) * step(quv, vec2(1.0));
            // Past the edge of the monitor the camera sees the dark room.
            c = IMG_NORM_PIXEL(screen, quv).rgb * inside.x * inside.y;
            // Gain held under critical; the sound pushes it towards the edge.
            c *= pow(g, steps);
            // The tube's gamma: faint light fades faster than bright, so haze
            // never settles over the blacks.
            c *= pow(clamp(dot(c, LUMA), 1e-4, 1.0), 0.012 * steps);
            // Each pass through the loop drifts the colour towards the accent.
            vec3 accentN = accent.rgb / max(dot(accent.rgb, LUMA), 0.05);
            c = mix(c, accentN * dot(c, LUMA), clamp(tint * 0.05 * steps, 0.0, 1.0));
            // Soft saturation, and a little off the bottom so blacks stay black.
            c = 1.4 * tanh(c / 1.4);
            c = max(c - (0.0006 + decay * 0.003) * steps, 0.0);
        }

        // The seed: a thin shape near the middle (Spread lets it wander). Each
        // hit changes it and flashes it; between hits it glows faintly so the
        // tunnel stays alive.
        float n = floor(vxCount + 0.5);
        float kind = seedShape == 0 ? mod(n, 3.0) : float(seedShape - 1);
        float size = (0.08 + seedSize * 0.2) * (0.85 + 0.3 * hash11(n * 5.3 + 2.0));
        vec2 wander = (vec2(hash11(n * 1.71 + 0.3), hash11(n * 3.13 + 1.7)) - 0.5) * vec2(0.5 * aspect, 0.45);
        vec2 at = spread * wander + (0.025 + 0.05 * spread) * vec2(cos(vxPhase * 1.1), sin(vxPhase * 0.9));
        float tilt = hash11(n * 9.7 + 4.1) * TAU;
        float copies = floor(clamp(symmetry, 1.0, 6.0) + 0.5);
        float hit = vxHit * vxHit;
        float level = 0.3 + hit * (0.8 + 0.3 * vxVel) + 0.3 * vxEnv;
        // Seed lines are never thinner than a stored pixel of the loop.
        vec2 fwPx = fwidth(gl_FragCoord.xy);
        float lineW = max(1.2, 0.85 * max(fwPx.x, fwPx.y));

        // When a frame covers several steps, draw the seed where each of
        // those steps would have left it, so the spacing stays even.
        float drawn = max(steps, 1.0);
        for (int j = 0; j < 3; j++) {
            float fj = float(j);
            if (fj >= drawn) break;
            float zj = exp(lz * fj);
            vec2 pj = fp + rot2(ang * fj) * (p - fp) / zj;
            float shape = 0.0;
            for (int k = 0; k < 6; k++) {
                if (float(k) >= copies) break;
                float a = TAU * float(k) / copies;
                vec2 local = rot2(-(tilt + a)) * (pj - rot2(a) * at);
                float d = seedDist(local, kind, size) * zj / px;
                shape = max(shape, exp(-d * d / (lineW * lineW)));
            }
            c = max(c, ink.rgb * shape * level * pow(g, fj));
        }

        if (FRAMEINDEX < 2) c = vec3(0.0);
        gl_FragColor = vec4(c, 1.0);
        return;
    }

    vec3 col = IMG_NORM_PIXEL(screen, uv).rgb;
    col = tanh(col * 1.4);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
