/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of tall light bars. Every hit of the sound it follows fires them one after another, left to right, right to left or out from the centre (turning every fourth hit): each bar flashes as a soft slab of light behind a bright leading edge, then falls away. Between hits only the bar outlines remain, as hairlines. Never more than about 40% of the frame is lit.",
    "PASSES": [
        {
            "TARGET": "launchA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "launchB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "velA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "velB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "lastHit",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "bars", "LABEL": "Bars", "TYPE": "float", "DEFAULT": 11, "MIN": 3, "MAX": 32 },
        { "NAME": "gap", "LABEL": "Gap", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 0.9 },
        { "NAME": "stagger", "LABEL": "Stagger", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "edgeGlow", "LABEL": "Edge glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fill", "LABEL": "Fill", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sweepMode", "LABEL": "Sweep", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Turns every 4th hit", "Left to right", "Right to left", "From the centre"] },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.74, "MIN": 0.2, "MAX": 1 },
        { "NAME": "outline", "LABEL": "Outlines", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Leading edge", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Sweep of hit m: 0 left to right, 1 right to left, 2 out from the centre.
float sweepOf(float m) {
    if (sweepMode > 0) return float(sweepMode - 1);
    float g = mod(floor(m / 4.0), 3.0);
    return g;
}

// Place of bar i in the firing order, and the side its leading edge is on (+1 right).
vec2 orderOf(float i, float nb, float sw) {
    if (sw < 0.5) return vec2(i, 1.0);
    if (sw < 1.5) return vec2(nb - 1.0 - i, -1.0);
    float c = (nb - 1.0) * 0.5;
    float o = floor(abs(i - c) + 0.01);
    return vec2(o, i >= c ? 1.0 : -1.0);
}

// Coverage of a line w wide at distance d; never thinner than one stored pixel.
float lineCov(float d, float w, float aa) {
    float ww = max(w, aa);
    return clamp((0.5 * ww - d) / aa + 0.5, 0.0, 1.0) * min(w / aa, 1.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float last = IMG_NORM_PIXEL(lastHit, vec2(0.5)).r;
    bool fresh = FRAMEINDEX >= 2 && abs(n - last) > 0.5;

    // State in 1x1 targets: per slot (8 hits), 1 + seconds since the hit, and its velocity.
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(launchA, vec2(0.5)) : IMG_NORM_PIXEL(launchB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        vec4 alive = step(0.5, v);
        v = (v + dt) * alive;
        v *= 1.0 - step(9.0, v);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 0 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(1.0), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX < 4) {
        vec4 v = PASSINDEX == 2 ? IMG_NORM_PIXEL(velA, vec2(0.5)) : IMG_NORM_PIXEL(velB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 2 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(clamp(vxVel, 0.0, 1.0)), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 4) {
        gl_FragColor = vec4(n, 0.0, 0.0, 1.0);
        return;
    }

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 pos = gl_FragCoord.xy;
    float nb = floor(clamp(bars, 3.0, 32.0) + 0.5);
    float margin = RENDERSIZE.y * 0.08;
    float pitchPx = (RENDERSIZE.x - 2.0 * margin) / nb;
    float hw = 0.5 * pitchPx * (1.0 - gap);
    float hh = 0.5 * RENDERSIZE.y * clamp(height, 0.2, 1.0);
    float cy = 0.5 * RENDERSIZE.y;
    float stg = mix(0.012, 0.11, stagger);
    float dec = mix(0.07, 0.75, decay * decay);
    float soft = max(mix(0.02, 0.3, edgeGlow) * hw, fw.x);
    float lw = max(1.4 * RENDERSIZE.y / 1080.0, 1.0);

    vec4 ageA = IMG_NORM_PIXEL(launchA, vec2(0.5));
    vec4 ageB = IMG_NORM_PIXEL(launchB, vec2(0.5));
    vec4 vA = IMG_NORM_PIXEL(velA, vec2(0.5));
    vec4 vB = IMG_NORM_PIXEL(velB, vec2(0.5));

    float bi = floor((pos.x - margin) / pitchPx);
    float light = 0.0;
    float red = 0.0;
    for (int j = 0; j < 3; j++) {
        float i = bi - 1.0 + float(j);
        if (i >= 0.0 && i < nb) {
            float cx = margin + (i + 0.5) * pitchPx;
            vec2 q = vec2(pos.x - cx, pos.y - cy);
            vec2 a = abs(q);

            // What every recent hit does to this bar: its slab, edge and side.
            float slab = 0.0;
            float edge = 0.0;
            float side = 1.0;
            float head = 0.0;
            for (int k = 0; k < 8; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                float slot = mod(m, 8.0);
                vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
                vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
                float stored = dot(ageA, pickA) + dot(ageB, pickB);
                if (stored > 0.5) {
                    float vel = dot(vA, pickA) + dot(vB, pickB);
                    vec2 ord = orderOf(i, nb, sweepOf(m));
                    float since = stored - 1.0 - ord.x * stg;
                    if (since >= 0.0) {
                        float e = exp(-since / dec);
                        float s = mix(0.45, 1.0, vel) * e;
                        if (s > slab) side = ord.y;
                        slab = max(slab, s);
                        edge = max(edge, mix(0.5, 1.0, vel) * exp(-since / (dec * 1.8)));
                        if (k == 0) head = max(head, 1.0 - smoothstep(0.0, max(stg * 1.5, 0.05), since));
                    }
                }
            }

            // The slab: soft-edged, brightest just behind its leading edge.
            vec2 dq = a - vec2(hw, hh);
            float inside = (1.0 - smoothstep(-soft, soft, dq.x)) * (1.0 - smoothstep(-soft, soft, dq.y));
            float u = clamp((side * q.x / hw) * 0.5 + 0.5, 0.0, 1.0);
            float grad = mix(0.35, 1.0, u * u);
            float dith = (hash21(pos + fract(TIME) * 37.0) - 0.5) / 255.0;
            light += slab * inside * grad * mix(0.15, 0.8, fill) + dith * step(0.002, slab * inside);

            // The bright edge on the leading side, with a faint tight halo.
            float dEdge = length(vec2(q.x - side * hw, max(a.y - hh, 0.0)));
            float core = lineCov(dEdge, lw * 1.6, fw.x);
            float halo = exp(-dEdge / (soft * 0.6 + lw)) * 0.22 * edgeGlow;
            light += edge * (core + halo * (1.0 - core));
            red = max(red, head * core);

            // Outlines: the whole bar as hairlines, always faintly there.
            float dBox = abs(max(dq.x, dq.y) < 0.0 ? max(dq.x, dq.y) : length(max(dq, 0.0)));
            float aaBox = dq.x > dq.y ? fw.x : fw.y;
            light += lineCov(dBox, lw, aaBox) * outline * (0.13 + 0.05 * sin(vxPhase * 0.7 + i * 0.9));
        }
    }

    light = min(light, 1.0);
    float ac = clamp(red, 0.0, 1.0);
    vec3 col = ink.rgb * light * (1.0 - ac) + accent.rgb * ac;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
