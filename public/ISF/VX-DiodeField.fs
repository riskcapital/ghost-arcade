/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of LED diodes showing water: two slow wave sources cross and make moving interference bands, stepped to a few brightness levels as a real LED wall would show them. Each hit drops a ring from a new point, drawn in the accent color as it spreads; the sound's level raises how much of the wall is lit. With no sound a few thin bands drift across a dim wall.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "diodes", "LABEL": "Diodes", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "waves", "LABEL": "Wave size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "steps", "LABEL": "Brightness steps", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Diodes", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Ring", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

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

// What one diode shows: (brightness 0-1, how much of it is the hit's ring).
// q is the diode's centre, in units of the wall's height with the origin at its middle.
vec2 diode(vec2 q, float asp, float n, float flow) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    // Two sources wander slowly; their waves cross.
    vec2 a = vec2(-0.55 * asp, -0.25) + 0.25 * vec2(sin(flow * 0.21), cos(flow * 0.17));
    vec2 b = vec2(0.5 * asp, 0.3) + 0.25 * vec2(cos(flow * 0.19), sin(flow * 0.23));
    float k = mix(34.0, 9.0, waves);
    float wa = sin(length(q - a) * k - flow * 2.2);
    float wb = sin(length(q - b) * k * 1.13 - flow * 1.7);
    // Each source's crests show as arcs, brightest where two cross.
    float field = max(wa, wb) + 0.45 * wa * wb;
    // More of the wall lights as the sound rises: the crests widen.
    float cut = mix(0.92, 0.25, sw);
    float lit = smoothstep(cut, cut + 0.35, field);
    // Stepped, as a wall with few brightness levels shows a gradient.
    float levels = floor(mix(2.0, 9.0, steps) + 0.5);
    lit = floor(lit * levels + 0.5) / levels;

    // The hit's ring: from a point that changes with every hit, spreading and thinning.
    vec2 c = (vec2(hash11(n * 3.17 + 1.0), hash11(n * 5.71 + 2.0)) - 0.5) * vec2(asp * 0.7, 0.6);
    float age = 1.0 - pu;
    float radius = age * 1.3;
    float d = length(q - c) - radius;
    float ring = exp(-pow(d / (0.035 + 0.05 * age), 2.0)) * pu * step(0.5, n);
    // A second, fainter ring follows inside the first.
    ring += 0.45 * exp(-pow((d + 0.16) / 0.03, 2.0)) * pu * pu * step(0.5, n);
    ring = min(ring, 1.0);
    float on = max(lit * (0.5 + 0.5 * sw), ring);
    return vec2(on, ring / max(on, 1e-3));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    float R = floor(mix(30.0, 120.0, diodes));
    float C = floor(R * asp + 0.5);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow;

    vec2 cell = uv * vec2(C, R);
    vec2 ic = floor(cell);
    vec2 f = fract(cell) - 0.5;
    float fmax = clamp(R / RENDERSIZE.y, 1e-4, 4.0);
    // The diode's own centre decides its light, so each one is a single flat value.
    vec2 q = ((ic + 0.5) / vec2(C, R) - 0.5) * vec2(asp, 1.0);
    vec2 me = diode(q, asp, n, flow);
    // The field at this very point, unstepped by the grid: the soft light between diodes.
    vec2 soft = diode((uv - 0.5) * vec2(asp, 1.0), asp, n, flow);

    float rr = length(f);
    float rad = 0.33;
    float far = smoothstep(0.3, 0.6, fmax);
    float core = smoothstep(rad + 0.75 * fmax, rad - 0.75 * fmax, rr);
    core = mix(core, 3.14159 * rad * rad, far);
    float lens = mix(exp(-rr * rr / 0.09), 0.4, far);

    vec3 dc = mix(ink.rgb, accent.rgb, clamp(me.y, 0.0, 1.0));
    vec3 sc = mix(ink.rgb, accent.rgb, clamp(soft.y, 0.0, 1.0));
    float jitter = 0.86 + 0.14 * hash21(ic + 0.5);
    vec3 e = dc * me.x * jitter * (core * 2.0 + lens * 0.5);
    e += vec3(1.0) * me.x * me.x * core * 0.3;
    e += sc * soft.x * (0.08 + 0.4 * glow);
    e += ink.rgb * (1.0 - me.x) * core * 0.02;

    vec3 col = vec3(0.005, 0.006, 0.008) + e;
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
