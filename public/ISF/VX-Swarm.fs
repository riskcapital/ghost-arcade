/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A swarm of soft points of light circling a common center, each on its own tilted orbit, leaving trails that a slow current smears like smoke. The sound's clock drives the orbits and its level swells the points. Each hit pulls the whole swarm in toward its center, to relax again, and lights a share of the points in the accent color, whose trails keep that color as they fade. With no sound the points hang dim, barely creeping, and the trails clear to black.",
    "PASSES": [
        {
            "TARGET": "trails",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "particles", "LABEL": "Particles", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "trail", "LABEL": "Trail length", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turbulence", "LABEL": "Turbulence", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Swarm", "TYPE": "color", "DEFAULT": [0.78, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Struck points", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Points in the swarm at most.
const int MAX_POINTS = 90;
const float TAU = 6.2831853;
// The side, in pixels, of each of the two note squares kept in the corner of the trail buffer.
const float NOTE = 4.0;

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

// The slow current that carries the trails: the swirl of a smooth rolling field, so it never
// gathers the smoke into a point or pulls it apart.
vec2 current(vec2 p, float t, float turb) {
    float fr = 0.7 + turb;
    vec2 k1 = vec2(2.1, 3.3) * fr;
    vec2 k2 = vec2(-3.7, 1.9) * fr;
    vec2 k3 = vec2(4.3, -5.1) * fr;
    vec2 v = cos(dot(k1, p) + t * 0.9) * vec2(k1.y, -k1.x);
    v += 0.6 * cos(dot(k2, p) - t * 1.3 + 1.7) * vec2(k2.y, -k2.x);
    v += 0.35 * cos(dot(k3, p) + t * 0.7 + 4.1) * vec2(k3.y, -k3.x);
    return v / fr;
}

// A few pixels in the bottom left corner of the trail buffer hold no smoke. They are the
// swarm's notebook: when the buffer was last drawn, and where the sound's clock and the hit's pull stood then.
bool inNotes(vec2 px) {
    return px.x < 2.0 * NOTE && px.y < NOTE;
}

// The smoke at a place in the frame (red: plain trails, green: accent trails, blue: the points now).
vec3 smokeAt(vec2 at) {
    vec2 inside = step(vec2(0.0), at) * step(at, vec2(1.0));
    float keep = inNotes(at * RENDERSIZE.xy - 1.0) ? 0.0 : inside.x * inside.y;
    return IMG_NORM_PIXEL(trails, at).rgb * keep;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float res = RENDERSIZE.y / 1080.0;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow + TIME * 0.02;

    // The swarm's center wanders slowly.
    vec2 center = vec2(0.16 * sin(flow * 0.11 + 0.5), 0.05 * sin(flow * 0.17 + 2.0));

    if (PASSINDEX == 0) {
        float turb = clamp(turbulence, 0.0, 1.0);

        // Read the notebook: how long ago the smoke in the buffer was drawn, how far the sound's
        // clock has run since, and how hard the hit was pulling then. (The clock is kept twice,
        // coarse and fine, so the small step between frames is read exactly.)
        vec3 noteA = IMG_NORM_PIXEL(trails, vec2(0.5 * NOTE) / RENDERSIZE.xy).rgb;
        vec3 noteB = IMG_NORM_PIXEL(trails, vec2(1.5 * NOTE, 0.5 * NOTE) / RENDERSIZE.xy).rgb;
        float coarse = fract(fract(flow) - noteA.r);
        float fine = fract(fract(flow * 16.0) - noteA.g) / 16.0;
        float ran = fine + floor((coarse - fine) * 16.0 + 0.5) / 16.0;
        float gone = fract(fract(TIME) - noteA.b);
        float pullWas = clamp(noteB.r, 0.0, 1.0);
        float pullVel = (noteB.g - 0.5) * 20.0;
        // After a pause or on the first frames the notebook says nothing useful: start clean.
        bool fresh = FRAMEINDEX < 2 || gone > 0.25 || ran > 0.25 || ran < 0.0;
        if (fresh) {
            ran = 0.0;
            gone = clamp(TIMEDELTA, 0.0, 0.1);
            pullWas = pu;
            pullVel = 0.0;
        }
        // The pull follows the hit as a weight on a damped spring would, so the swarm swoops
        // inward and eases back out, and no trail gets a corner.
        float pullNow = pullWas;
        for (int k = 0; k < 2; k++) {
            pullVel += 0.5 * gone * (36.0 * (pu - pullNow) - 12.0 * pullVel);
            pullNow += 0.5 * gone * pullVel;
        }
        pullNow = clamp(pullNow, 0.0, 1.0);

        if (inNotes(gl_FragCoord.xy)) {
            vec3 note = gl_FragCoord.x < NOTE ? vec3(fract(flow), fract(flow * 16.0), fract(TIME)) : vec3(pullNow, clamp(0.5 + pullVel / 20.0, 0.0, 1.0), 0.0);
            gl_FragColor = vec4(note, 1.0);
            return;
        }

        // The old smoke, carried a little way along the current and faded.
        vec2 vel = current(p, flow * 0.5, turb) * 0.012 * (0.4 + 1.2 * turb) * (0.35 + sw + 0.5 * pu);
        vec2 from = p - vel * gone;
        vec2 old = smokeAt(vec2(from.x / asp + 0.5, from.y + 0.5)).rg;
        float tau = mix(0.15, 2.0, trail * trail);
        // A little is taken off the bottom as well, so old smoke clears to true black.
        old = max(old * exp(-gone / tau) - 0.05 * gone, 0.0);

        // The points now. Each circles the center on its own tilted orbit, seen in depth: its place
        // is a sum of sines of the sound's clock, so no point needs remembering. Each is drawn as
        // the stroke it has traveled since the old smoke was drawn, so its trail is one unbroken line.
        float count = floor(mix(40.0, float(MAX_POINTS), particles));
        // A hit pulls every orbit in toward the center.
        float pull = 1.0 - 0.26 * pullNow;
        float pulledWas = 1.0 - 0.26 * pullWas;
        float stretch = 1.75 + 0.2 * sin(flow * 0.13);
        float flowWas = flow - ran;
        vec2 centerWas = vec2(0.16 * sin(flowWas * 0.11 + 0.5), 0.05 * sin(flowWas * 0.17 + 2.0));
        float stretchWas = 1.75 + 0.2 * sin(flowWas * 0.13);
        float accOn = smoothstep(0.05, 0.35, pu);
        float rBase = mix(1.4, 4.6, size) * (1.0 + 0.7 * sw) * max(res, 0.3);
        float inkD = 0.0;
        float accD = 0.0;
        float head = 0.0;
        for (int i = 0; i < MAX_POINTS; i++) {
            float fi = float(i);
            if (fi >= count) break;
            float h1 = hash11(fi * 1.73 + 0.31);
            float h2 = hash11(fi * 2.91 + 7.7);
            float h3 = hash11(fi * 5.13 + 3.3);
            float h4 = hash11(fi * 9.37 + 1.1);
            // The orbit's plane, tipped away from the eye by its own amount.
            vec3 ax = normalize(vec3((h1 - 0.5) * 1.5, (h2 - 0.5) * 1.5, 0.6));
            vec3 ou = normalize(vec3(-ax.z, 0.0, ax.x));
            vec3 ov = cross(ax, ou);
            float rad = mix(0.07, 0.37, sqrt(h3));
            // Inner points go round faster than outer ones.
            float rate = (0.55 + 0.5 * h4) / (0.5 + 2.2 * rad);
            float t = flow * rate + h1 * TAU * 3.0;
            float ct = cos(t);
            float st = sin(t);
            float ba = t * 0.43 + h2 * TAU;
            float breathe = 1.0 + 0.2 * sin(ba);
            vec3 q = (ou * ct + ov * st) * rad * breathe;
            vec3 dq = ((ov * ct - ou * st) * breathe + (ou * ct + ov * st) * 0.086 * cos(ba)) * rad;
            vec2 at = center + q.xy * vec2(stretch, 1.0) * pull;
            // Where it was: back along its orbit by the angle it has turned since (the current
            // has carried that end of the stroke along with the rest of the smoke).
            float turned = ran * rate;
            vec2 qWas = q.xy * (1.0 - 0.5 * turned * turned) - dq.xy * turned;
            vec2 was = centerWas + qWas * vec2(stretchWas, 1.0) * pulledWas + vel * gone;

            // Nearer points are larger and brighter.
            float near = clamp(0.5 + q.z * 1.6, 0.0, 1.0);
            float r = max(rBase * (0.6 + 0.8 * near), 0.8);
            vec2 pa = p - at;
            vec2 seg = was - at;
            float along = clamp(dot(pa, seg) / max(dot(seg, seg), 1e-9), 0.0, 1.0);
            float ds = length(pa - seg * along) * RENDERSIZE.y;
            float d = length(pa) * RENDERSIZE.y;
            float b = mix(0.45, 1.0, near);
            // The trail it leaves is finer than the point itself.
            float rt = max(r * 0.62, 0.75);
            float g = exp(-(ds * ds) / (rt * rt)) * b;
            // The points this hit struck, about a third of them, take the accent color while it lasts.
            float acc = hash11(fi * 3.7 + n * 17.3) < 0.34 ? accOn : 0.0;
            inkD = max(inkD, g * (1.0 - acc));
            accD = max(accD, g * acc);
            head = max(head, exp(-(d * d) / (r * r * 0.5)) * b);
        }

        // Trails keep the brighter of the old smoke and the new stroke, so a point standing still
        // can never pile light up.
        vec3 c = vec3(max(old.r, inkD * 0.85), max(old.g, accD * 0.85), head);
        c = clamp(c, 0.0, 1.0);
        if (FRAMEINDEX < 2) c = vec3(0.0);
        gl_FragColor = vec4(c, 1.0);
        return;
    }

    // To the screen: trails in their two colors, a soft bloom gathered from round each pixel,
    // and the points themselves whiter on top.
    vec3 t0 = smokeAt(uv);
    vec2 bloom = vec2(0.0);
    for (int k = 0; k < 8; k++) {
        float a = (float(k) + 0.5) * TAU / 8.0;
        float rr = (mod(float(k), 2.0) < 0.5 ? 5.0 : 12.0) * max(res, 0.4);
        bloom += smokeAt(uv + vec2(cos(a), sin(a)) * rr / RENDERSIZE.xy).rg;
    }
    bloom /= 8.0;

    float level = 0.8 + 0.5 * sw;
    vec3 col = ink.rgb * (t0.r * 0.8 + bloom.r * 0.5) * level;
    col += accent.rgb * (t0.g * 1.1 + bloom.g * 0.7) * level;
    float total = t0.r + t0.g;
    vec3 headC = mix(ink.rgb, accent.rgb, total > 1e-4 ? t0.g / total : 0.0);
    col += mix(headC, vec3(1.0), 0.5) * t0.b * (0.85 + 0.6 * sw);
    // A faint glow where the swarm gathers.
    vec2 fromC = (p - center) * vec2(0.55, 1.0);
    col += ink.rgb * 0.03 * (0.7 + sw) * exp(-dot(fromC, fromC) * 7.0);

    // Tone map on the brightest channel so the light keeps its color, then dither against banding.
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
