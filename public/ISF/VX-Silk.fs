/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A few broad ribbons of thin silk hanging down through the frame and swaying across each other. Each ribbon is shaded with soft folds whose highlights run along it like satin, and it is thin enough to see through, so where ribbons cross the cloth looks denser. The sound's clock moves the folds down the ribbons; its level widens and brightens them. Each hit sends a sheen of the accent color traveling down one ribbon. With no sound the ribbons hang dim and barely stir.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "ribbons", "LABEL": "Ribbons", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "foldSize", "LABEL": "Fold size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sheen", "LABEL": "Sheen", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Silk", "TYPE": "color", "DEFAULT": [0.86, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Passing sheen", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Ribbons at most. They are drawn back to front.
const int MAX_RIBBONS = 5;
const float TAU = 6.2831853;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Where a point sits on ribbon number fi: (how far across it, -1 and 1 at its edges; its half
// width there; how far down it, 0 at the top of the frame and 1 at the bottom).
// The ribbon hangs from above the frame, leaning, and its line and width wander smoothly.
vec3 ribbonAt(vec2 p, float fi, float count, float sway, float sw, float asp) {
    float h1 = hash11(fi * 7.3 + 1.0);
    float h2 = hash11(fi * 3.1 + 5.0);
    float h3 = hash11(fi * 5.7 + 9.0);
    float s = 0.5 - p.y;
    float x0 = ((fi + 0.5) / count - 0.5) * asp * 0.8 + (h1 - 0.5) * 0.14 + 0.07 * sin(sway * 0.31 + fi * 2.1);
    float lean = (h2 - 0.5) * 0.9 + (mod(fi, 2.0) < 0.5 ? 0.22 : -0.22);
    float a1 = s * 2.3 + sway * (0.7 + 0.6 * h1) + h3 * TAU;
    float a2 = s * 5.1 - sway * 1.3 + h1 * TAU;
    float xc = x0 + lean * (s - 0.5) + 0.13 * sin(a1) + 0.045 * sin(a2);
    float slope = lean + 0.13 * 2.3 * cos(a1) + 0.045 * 5.1 * cos(a2);
    float w = (0.105 + 0.06 * h3) * (0.72 + 0.28 * sin(s * 2.9 + sway * 0.8 + h2 * TAU)) * (1.0 + 0.3 * sw);
    float v = (p.x - xc) / (w * sqrt(1.0 + slope * slope));
    return vec3(v, w, s);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow + TIME * 0.02;

    float count = floor(mix(2.0, 5.99, ribbons));
    float sway = flow * mix(0.06, 0.6, drift);
    float K = mix(8.0, 2.4, foldSize);
    float level = 0.5 + 0.62 * sw;

    vec3 inkC = ink.rgb;
    vec3 deep = inkC * inkC * 0.55;
    vec3 pale = mix(inkC, vec3(1.0), 0.65);

    // One soft light, high on the left and in front of the cloth.
    vec3 L = normalize(vec3(-0.5, 0.5, 0.7));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));

    // The ribbon the latest hit touched, and how far down it the hit's sheen has traveled.
    float touched = floor(hash11(n * 5.7 + 2.3) * count);
    // It comes to rest at the foot of the ribbon and lingers there, fainter, until the next hit.
    float sheenAt = mix(-0.3, 1.08, pow(1.0 - pu, 0.7));
    float sheenOn = max(smoothstep(0.02, 0.25, pu), n > 0.5 ? 0.5 : 0.0);

    // A dark room with a little of the light in its air.
    vec3 col = inkC * 0.012 * (1.0 - 0.6 * length(p - vec2(-0.5, 0.35)));
    col = max(col, 0.0);
    float cover = 0.0;

    for (int i = 0; i < MAX_RIBBONS; i++) {
        float fi = float(i);
        if (fi >= count) break;
        float h1 = hash11(fi * 7.3 + 1.0);
        float h2 = hash11(fi * 3.1 + 5.0);
        float h3 = hash11(fi * 5.7 + 9.0);

        // The ribbon's soft shadow on whatever hangs behind it, thrown down and to the right.
        vec3 sh = ribbonAt(p - vec2(0.022, -0.03), fi, count, sway, sw, asp);
        float shadow = smoothstep(1.3, 0.7, abs(sh.x));
        col *= 1.0 - 0.4 * shadow;

        vec3 r = ribbonAt(p, fi, count, sway, sw, asp);
        float v = r.x;
        float w = r.y;
        float s = r.z;
        float aa = 1.5 * px / w;
        float edge = smoothstep(1.0 + aa, 1.0 - aa, abs(v));
        if (edge <= 0.0) continue;

        // Folds run along the ribbon and wander from side to side as they go; the clock carries them down it.
        float along = s * 3.0 - flow * (0.7 + 0.5 * h2);
        float f1 = v * K + 1.7 * sin(along * 0.9 + h1 * TAU) + h2 * TAU;
        float f2 = v * K * 1.9 - 1.3 * sin(along * 1.4 + h3 * TAU) + along * 0.6;
        float f3 = v * K * 3.4 + 2.1 * sin(along * 0.7 + h2 * TAU) - along * 0.4;
        // The finest folds are left out where they would be too small for the picture to hold.
        float fine = 0.28 * smoothstep(8.0, 24.0, TAU / (K * 3.4) * w * RENDERSIZE.y);
        float tiltAcross = (cos(f1) + 0.6 * cos(f2) + fine * cos(f3)) * 1.05 + v * 0.6;
        float tiltAlong = 0.35 * cos(f1) * cos(along * 0.9 + h1 * TAU);
        vec3 N = normalize(vec3(-tiltAcross, tiltAlong, 1.0));

        // Satin: a soft body of color, darker in the valleys, with a long highlight on each fold.
        float facing = 0.5 + 0.5 * dot(N, L);
        float hl = max(dot(N, H), 0.0);
        float spec = pow(hl, mix(12.0, 60.0, sheen) * clamp(RENDERSIZE.y / 540.0, 0.35, 1.0)) * (0.3 + 1.5 * sheen);
        float broad = pow(hl, 5.0);
        float rim = (1.0 - N.z) * (1.0 - N.z);
        // Ribbons farther back are dimmer.
        float back = mix(0.6, 1.0, (fi + 1.0) / count);
        vec3 rc = mix(deep, inkC, facing * facing) * (0.08 + 0.92 * facing * sqrt(facing));
        rc += pale * spec + inkC * rim * 0.12;
        rc *= level * back;
        // A turned hem catches the light along each edge.
        float hem = smoothstep(1.0 - 4.0 * aa, 1.0 - 1.5 * aa, abs(v));
        rc += pale * hem * 0.1 * level * back;

        // The hit's sheen: a stretch of the touched ribbon lit in the accent color, brightest on the folds.
        if (fi == touched) {
            float band = exp(-pow((s - sheenAt) / 0.22, 2.0)) * sheenOn;
            rc = mix(rc, accent.rgb * (0.12 + 0.75 * facing) * (level + 0.3), band * 0.7);
            rc += accent.rgb * band * (0.5 * broad + 1.2 * spec);
        }

        // Thin cloth: more of it lies in a pixel where a fold is steep, so it is denser there.
        float dens = mix(0.5, 0.85, clamp(abs(tiltAcross) * 0.5, 0.0, 1.0)) * edge;
        col = mix(col, rc, dens);
        cover = cover + dens * (1.0 - cover);
    }

    // The lens darkens a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the cloth keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The cloth is as solid as it is dense; the dark between ribbons lets what is under it show.
        outa = clamp(max(cover, max(max(col.r, col.g), col.b) * 1.4), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
