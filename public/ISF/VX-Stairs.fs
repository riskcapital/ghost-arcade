/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A staircase wavefolder. A ramp from the centre (a circle, diamond or square) is cut into quantised steps and folded up and down in stages, so the frame fills with concentric terraces of stepped brightness, each edge a crisp line. The bass swells the step count so the rings crowd inward as it plays; every bass note pushes the rings outward; the top ring of each stage is the accent.",
    "PASSES": [
        {
            "TARGET": "stairState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "seen",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "shape", "LABEL": "Shape", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Circle", "Diamond", "Square"] },
        { "NAME": "stages", "LABEL": "Stages", "TYPE": "float", "DEFAULT": 2, "MIN": 1, "MAX": 6 },
        { "NAME": "stepCount", "LABEL": "Step count", "TYPE": "float", "DEFAULT": 4, "MIN": 2, "MAX": 10 },
        { "NAME": "swell", "LABEL": "Bass swell", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "phaseResponse", "LABEL": "Phase response", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "fill", "LABEL": "Fill", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "centreOffset", "LABEL": "Centre offset", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Steps", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Top ring", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// stairState (1x1): x = whole steps the rings have moved out (mod 840, which every
// staircase length divides), y = the fraction of a step, z = push still to come.
// seen (1x1): the note count as of last frame.
const float WRAP = 840.0;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Brightness of step k in a staircase folded up and down: 0 at the floor, 1 at the top.
float stairLevel(float k, float m) {
    float period = 2.0 * (m - 1.0);
    return abs(mod(k, period) - (m - 1.0)) / (m - 1.0);
}

void main() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float count = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 st = IMG_NORM_PIXEL(stairState, vec2(0.5));
        float lastSeen = IMG_NORM_PIXEL(seen, vec2(0.5)).r;
        bool ready = FRAMEINDEX >= 2;
        // Each bass note pushes the rings outward by an amount set by its pitch.
        if (ready && count != lastSeen && vxPitch > 0.0) {
            float note = floor(vxPitch * 127.0 + 0.5);
            st.z += mix(0.3, 2.5, phaseResponse) * (0.5 + fract(note * 7.0 / 12.0));
        }
        // The push lands fast and settles, like a hit through a slew.
        float move = st.z * (1.0 - exp(-dt / 0.09));
        st.z -= move;
        float y = st.y + move;
        float whole = floor(y);
        st.x = mod(st.x + whole, WRAP);
        st.y = y - whole;
        if (!ready) st = vec4(0.0);
        gl_FragColor = st;
        return;
    }
    if (PASSINDEX == 1) {
        gl_FragColor = vec4(count, 0.0, 0.0, 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec4 st = IMG_NORM_PIXEL(stairState, vec2(0.5));

    // The centre wanders slowly on a small circle.
    float wander = vxPhase * 0.04;
    vec2 c = centreOffset * 0.22 * vec2(cos(wander) * 1.4, sin(wander * 1.3));
    vec2 q = p - c;
    float r;
    if (shape == 0) {
        r = length(q);
    } else if (shape == 1) {
        r = abs(q.x) + abs(q.y);
    } else {
        r = max(abs(q.x), abs(q.y)) * 1.15;
    }
    float R = mix(0.25, 0.55, size);
    float u = r / R;

    // The staircase: S stages of M steps, folded. The bass multiplies the steps.
    float S = clamp(floor(stages + 0.5), 1.0, 6.0);
    float M = clamp(floor(stepCount + 0.5), 2.0, 10.0);
    float dense = 1.0 + swell * 1.6 * vxEnv;
    float drift = vxPhase * 0.25;
    float phase = st.x + st.y + drift;
    float s = u * S * 2.0 * (M - 1.0) * dense - phase;
    float fw = max(fwidth(s), 1e-4);

    // Box-filtered step edge: blend the two steps either side of the nearest edge.
    float k = floor(s + 0.5);
    float t = clamp((s - k) / fw + 0.5, 0.0, 1.0);
    float lA = stairLevel(k - 1.0, M);
    float lB = stairLevel(k, M);
    float level = mix(lA, lB, t);
    // A crisp line on every edge, as bright as the higher step it bounds.
    float edge = 1.0 - smoothstep(0.35, 1.1, abs(s - k) / fw);
    float edgeLevel = max(lA, lB);

    float gamma = mix(1.0, 4.0, contrast);
    float fillLight = pow(level, gamma) * mix(0.0, 0.32, fill);
    float lineLight = edge * mix(0.1, 1.0, pow(edgeLevel, gamma * 0.5));
    // The top step of each stage: a ring of accent.
    float topA = stairLevel(k - 1.0, M) > 0.999 ? 1.0 - t : 0.0;
    float topB = stairLevel(k, M) > 0.999 ? t : 0.0;
    float top = topA + topB;

    // The terraces fade out towards the rim and stay clear of the middle's pinch.
    float win = (1.0 - smoothstep(0.78, 1.0, u)) * smoothstep(0.0, 0.05, u);
    float hit = vxHit * vxHit;
    float gain = mix(0.55, 1.0, smoothstep(0.0, 0.6, vxEnv)) * (1.0 + 0.25 * hit);

    vec3 col = ink.rgb * (fillLight * (1.0 - top) + lineLight) * win * gain;
    col += ink.rgb * top * mix(0.05, 0.2, fill) * win * gain;
    // The outer edge of each top ring burns in the accent.
    bool outerTop = (s - k) * sign(fwidth(u)) > -2.0 && lA > 0.999;
    if (outerTop) col = mix(col, accent.rgb * 0.85 * gain * win, edge);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
