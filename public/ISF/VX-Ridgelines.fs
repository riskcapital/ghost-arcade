/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A mountain range drawn as a stack of hairlines, near ones at the bottom and far ones at the top, each lifted by the land under it so the nearer ridges hide the ones behind. The sound's motion slides the land toward you; its level raises the ridges; each hit sends one line of light in the accent color rolling in from the far ridges, to come to rest on a nearer one. With no sound the range lies low and still.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "roughness", "LABEL": "Roughness", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Rolling line", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Lines in the stack (at most).
const int MAX_LINES = 70;
// How much land the nearest line spans, side to side.
const float WIDTH = 1.5;

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

// Smooth noise over the land: (value 0-1, its slope along x).
vec2 landNoise(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float du = 6.0 * f.x * (1.0 - f.x);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return vec2(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), du * mix(b - a, d - c, u.y));
}

// The land's height at a point: (height 0-1.5 or so, its slope along x).
// Broad massifs with flat valleys between, creased into sharp crests, with small folds on the high ground.
// n1 is the broad noise under the massifs, worked out by the caller (it also bounds the height cheaply).
vec2 land(vec2 q, vec2 n1) {
    vec2 n2 = landNoise(q * 1.9 + vec2(11.3, 5.1));
    vec2 n3 = landNoise(q * 5.3 + vec2(1.9, 8.4));
    float m = n1.x * n1.x * 1.9;
    float dm = 3.8 * n1.x * n1.y * 0.7;
    float c = 1.0 - abs(2.0 * n2.x - 1.0);
    float dc = (n2.x > 0.5 ? -2.0 : 2.0) * n2.y * 1.9;
    float crest = c * c;
    float dcrest = 2.0 * c * dc;
    float rk = mix(0.2, 1.0, roughness);
    float shape = 1.0 - 0.5 * rk + 1.2 * rk * crest;
    float fold = 0.12 * roughness * (n3.x - 0.5);
    float h = m * shape + fold * (0.3 + m);
    float dh = dm * shape + m * 1.2 * rk * dcrest + 0.12 * roughness * n3.y * 5.3 * (0.3 + m) + fold * dm;
    return vec2(h, dh);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // The land slides toward the viewer with the sound; a trace of drift keeps it from freezing.
    float scroll = vxFlow * 0.3 + TIME * 0.02;

    float count = floor(mix(40.0, float(MAX_LINES), lines) + 0.5);
    // The view: the nearest line sits just under the bottom edge, the farthest at yTop.
    // Lines are spaced evenly in the logarithm of their distance, so they crowd toward the horizon.
    float yBot = -0.56;
    float yTop = mix(0.06, 0.32, tilt);
    float ratio = mix(6.5, 2.6, tilt);
    float cam = (yTop - yBot) / (1.0 - 1.0 / ratio);
    float yHor = yBot + cam;
    float amp = mix(0.15, 0.75, height) * (0.5 + 0.5 * sw);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 ground = vec3(0.004, 0.0045, 0.006);

    // The line of light a hit sends in: it starts on the far ridges and comes to rest on a nearer one.
    float rest = 0.06 + 0.4 * hash11(n * 3.17 + 0.7);
    float lit = n > 0.5 ? 1.0 : 0.0;
    float uHit = mix(rest, 1.02, pu * pu);
    float hitW = 0.6 / count;

    vec3 col = vec3(0.0);
    // How much of this pixel is still uncovered by nearer ground.
    float open = 1.0;

    for (int k = 0; k < MAX_LINES; k++) {
        float fk = float(k);
        if (fk >= count) break;
        float u = fk / (count - 1.0);
        float z = pow(ratio, u);
        float yBase = yHor - cam / z;
        // Near ground is calm; the range rises in the middle distance.
        float env = smoothstep(-0.05, 0.3, u) * (1.0 - 0.35 * smoothstep(0.75, 1.0, u));
        float reach = amp * env * 3.2 / z;
        float w = max(0.55 * px, mix(0.0013, 0.0006, u));

        // This ridge cannot reach up to the pixel: look at the next one back.
        if (p.y > yBase + reach + w + px) continue;
        // The pixel is deep under this line: its ground covers everything behind.
        if (p.y < yBase - 0.06) {
            col += open * ground;
            open = 0.0;
            break;
        }

        vec2 q = vec2(p.x * z * WIDTH, z * 1.6 + scroll);
        vec2 n1 = landNoise(q * 0.7 + vec2(3.7, 0.0));
        // The massif alone says how high this ridge can stand here; if that is under the pixel, move on.
        float top = n1.x * n1.x * 1.9 * 1.78 + 0.03;
        if (p.y > yBase + amp * env * top / z + w + px) continue;
        vec2 h = land(q, n1);
        float ridge = yBase + amp * env * h.x / z;
        float slope = amp * env * h.y * WIDTH;
        // Distance from the pixel to the line, measured square to it.
        float d = (p.y - ridge) / sqrt(1.0 + slope * slope);

        float stroke = 1.0 - smoothstep(w - 0.6 * px, w + 0.6 * px, abs(d));
        float under = smoothstep(0.6 * px, -0.6 * px, d);

        // Far lines are fainter, as through air; high ground catches more light.
        float hitK = lit * exp(-pow((u - uHit) / hitW, 2.0));
        float b = (0.42 + 0.58 * sw) * mix(1.0, 0.4, u) * (0.55 + 0.6 * clamp(h.x, 0.0, 1.5));
        vec3 lc = mix(inkC * b, accC * (0.75 + 1.1 * pu), hitK);
        // A little of the line's light falls on the slope just under it.
        float below = max(-d, 0.0);
        vec3 fill = ground + lc * (0.07 * exp(-below / 0.012) + 0.25 * hitK * exp(-below / 0.03));

        col += open * (lc * stroke * 1.25 + fill * under * (1.0 - stroke));
        open *= 1.0 - max(under, stroke);
        if (open < 0.004) break;
    }

    // Behind the range: a dark sky with a low glow that sets the far ridges in silhouette.
    float above = max(p.y - yTop, 0.0);
    vec3 sky = ground + inkC * (0.035 + 0.05 * sw) * exp(-above / 0.22);
    col += open * sky;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lines keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark ground lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
