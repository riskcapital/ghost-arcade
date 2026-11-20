/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of fluted glass with soft lights drifting behind it: two blurred discs and a long slanted bar. Each flute bends what is behind it sideways, so the shapes break into repeated upright slivers, with a thin highlight down every flute and a dark seam between flutes. The sound's motion moves the lights; its level brightens and widens them; each hit adds a light in the accent color that swells and fades. With no sound the lights rest dim behind the glass.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "flutes", "LABEL": "Flutes", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "refraction", "LABEL": "Refraction", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "edge", "LABEL": "Edge highlight", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Light of the hit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// A soft disc of light: brightest at its heart, a blurred rim, and a faint bloom beyond it.
float disc(vec2 q, vec2 c, float r, float s) {
    float d = length(q - c) - r;
    return smoothstep(s, -s, d) * mix(0.7, 1.0, smoothstep(0.0, -r, d)) + 0.1 * exp(-max(d, 0.0) / (0.03 + 0.8 * s));
}

// A soft bar of light: a long rounded strip at an angle.
float bar(vec2 q, vec2 c, float ang, float halfLen, float halfThick, float s) {
    vec2 v = q - c;
    vec2 ax = vec2(cos(ang), sin(ang));
    vec2 l = vec2(dot(v, ax), dot(v, vec2(-ax.y, ax.x)));
    float d = length(vec2(max(abs(l.x) - halfLen, 0.0), l.y)) - halfThick;
    return smoothstep(s, -s, d) + 0.1 * exp(-max(d, 0.0) / (0.025 + 0.8 * s));
}

// The lights behind the glass, at a point of the room (x across, y up, the view one unit tall).
vec3 lights(vec2 q, float flow, float sw, float pu, float n) {
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    float s = mix(0.012, 0.16, softness);
    float level = 0.4 + 0.6 * sw;
    float wide = 1.0 + 0.3 * sw;

    // Two discs and a slanted bar, each drifting on its own slow path.
    vec2 cA = vec2(-0.5 + 0.24 * sin(flow * 0.31), 0.04 + 0.12 * sin(flow * 0.23 + 1.0));
    vec2 cB = vec2(0.52 + 0.2 * sin(flow * 0.27 + 2.0), -0.1 + 0.14 * cos(flow * 0.19));
    vec2 cC = vec2(0.05 + 0.3 * sin(flow * 0.17 + 4.0), 0.1 * sin(flow * 0.29 + 0.5));
    vec3 col = inkC * disc(q, cA, 0.25 * wide, s) * level;
    col += inkC * disc(q, cB, 0.15 * wide, s) * level * 0.8;
    col += mix(inkC, vec3(1.0), 0.45) * bar(q, cC, 0.62 + 0.3 * sin(flow * 0.13), 0.95, 0.028 * (1.0 + 0.9 * sw), s * 0.6) * level * 1.15;

    // The light the latest hit added: it swells as the hit fades, and lingers faintly until the next.
    if (n > 0.5) {
        float h1 = hash11(n * 4.31 + 0.7);
        float h2 = hash11(n * 9.17 + 2.3);
        float h3 = hash11(n * 1.93 + 5.9);
        vec2 cH = vec2((h1 - 0.5) * 1.3, (h2 - 0.5) * 0.5);
        float grow = 0.55 + 0.75 * (1.0 - pu);
        float hit = h3 < 0.6 ? disc(q, cH, 0.13 * grow, s) : bar(q, cH, 1.571 - 0.6 + 1.2 * h1, 0.3 * grow, 0.03 * grow, s * 0.6);
        col += accC * hit * (0.2 + 1.2 * pu);
    }
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // The lights move with the sound; a trace of drift keeps them from freezing.
    float flow = vxFlow + TIME * 0.02;

    // The flutes: which one this pixel is in, and where across it (-0.5 to 0.5).
    float N = floor(mix(18.0, 96.0, flutes) + 0.5);
    float fx = uv.x * N;
    float fi = floor(fx);
    float f = fract(fx) - 0.5;
    // A pixel's width, measured in flutes.
    float pf = N / RENDERSIZE.x;

    // Each flute is a lens: it shows a strip of the room behind, squeezed, and past a point turned round.
    // Its curve bends the view more toward its edges, and the glass is not perfectly even down its length.
    float mag = 1.0 - 4.0 * refraction;
    float bend = f * (1.0 + 1.6 * f * f);
    float wob = (noise1(uv.y * 5.0 + fi * 13.7) - 0.5) * 0.1 * refraction;
    float xs = (fi + 0.5 + bend * mag + wob) / N;
    vec2 q = vec2((xs - 0.5) * asp, p.y);
    vec3 seen = lights(q, flow, sw, pu, n);

    // The glass itself: darker toward each flute's edges, with a dark seam where two flutes meet.
    float rim = abs(f) * 2.0;
    float seamW = max(0.05, 1.5 * pf);
    float seam = smoothstep(0.5 - seamW, 0.5, abs(f));
    vec3 col = seen * (1.0 - 0.5 * rim * rim) * (1.0 - 0.9 * seam);

    // A thin highlight down each flute: light from the room behind, caught at a steep angle.
    float hw = max(0.035, 0.8 * pf);
    float glint = exp(-pow((f + 0.27) / hw, 2.0));
    vec2 qh = vec2(((fi + 0.5 - 2.2) / N - 0.5) * asp, p.y);
    vec3 caught = lights(qh, flow, sw, pu, n);
    float cl = max(max(caught.r, caught.g), caught.b);
    vec3 shine = mix(caught, vec3(cl), 0.4) * 0.85 + ink.rgb * (0.012 + 0.014 * uv.y);
    col += shine * glint * (0.2 + 1.6 * edge) * (1.0 - seam);

    // The dark room shows through as a deep ground, a touch lighter where the glass faces the room's glow.
    col += vec3(0.004, 0.0045, 0.006) + ink.rgb * 0.006 * (1.0 - rim * rim) * (1.0 - seam);

    // The wall falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lights keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark glass lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
