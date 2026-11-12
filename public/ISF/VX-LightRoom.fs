/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A dark room built of light: glowing planes and open frames standing at different depths, nearer ones in front of farther ones, each pooling soft light on a polished floor through a faint haze. Every note of the chord lights one of them in its own color, and when the chord changes the room rebuilds itself, the pieces gliding to new places over about a beat. With no sound the room rests dim and still. With a transparent background only the light is drawn.",
    "PASSES": [
        {
            "TARGET": "room",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 16,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "frames", "LABEL": "Frames", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "tall", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Floor shine", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First light", "TYPE": "color", "DEFAULT": [1.0, 0.26, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Haze", "TYPE": "color", "DEFAULT": [0.52, 0.36, 1.0, 1.0] },
        { "NAME": "palBody", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [0.22, 0.42, 1.0, 1.0] },
        { "NAME": "palAccent", "LABEL": "Third light", "TYPE": "color", "DEFAULT": [1.0, 0.6, 0.18, 1.0] },
        { "NAME": "palLight", "LABEL": "Fourth light", "TYPE": "color", "DEFAULT": [0.55, 0.95, 0.9, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 63 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// How bright a piece with no note of its own rests.
const float REST = 0.22;
// How long the room takes to rebuild, in seconds (about a beat).
const float GLIDE = 0.55;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noteAt(float i) {
    if (i < 0.5) return vxNote0;
    if (i < 1.5) return vxNote1;
    if (i < 2.5) return vxNote2;
    return vxNote3;
}

float energyAt(float i) {
    if (i < 0.5) return vxNoteE0;
    if (i < 1.5) return vxNoteE1;
    if (i < 2.5) return vxNoteE2;
    return vxNoteE3;
}

vec3 lightColor(float i) {
    if (i < 0.5) return ink.rgb;
    if (i < 1.5) return palBody.rgb;
    if (i < 2.5) return palAccent.rgb;
    return palLight.rgb;
}

// One piece of the room for a layout key: x centre, depth (0 far, 1 near), hb width, height.
vec4 pieceShape(float key, float i) {
    float h0 = hash21(vec2(key * 0.731 + 1.3, 5.1));
    float h1 = hash21(vec2(key * 0.517 + 7.9, 2.3));
    // Lanes across the room and ranks in depth are each a shuffle of the four pieces.
    float lane = mod(i * (h0 < 0.5 ? 1.0 : 3.0) + floor(h1 * 4.0), 4.0);
    float h2 = hash21(vec2(key * 0.293 + 3.7, 9.4));
    float h3 = hash21(vec2(key * 0.861 + 0.4, 6.6));
    float rank = mod(i * (h2 < 0.5 ? 3.0 : 1.0) + floor(h3 * 4.0), 4.0);
    float j0 = hash21(vec2(key * 1.13 + i * 3.1, 1.7));
    float j1 = hash21(vec2(key * 0.77 + i * 5.3, 4.2));
    float j2 = hash21(vec2(key * 0.37 + i * 2.9, 8.8));
    float x = (lane - 1.5) * 0.36 + (j0 - 0.5) * 0.14;
    float depth = (rank + 0.25 + 0.5 * j1) / 4.0;
    float hw = 0.09 + 0.12 * j2;
    float ht = (0.26 + 0.22 * hash21(vec2(key * 0.59 + i * 7.7, 3.3))) * (0.7 + 0.6 * tall);
    return vec4(x, depth, hw, ht);
}

// Whether a piece is an open frame (1) or a solid plane of light (0) in a layout.
float pieceKind(float key, float i) {
    float h = hash21(vec2(key * 0.91 + i * 4.4, 7.2));
    // The first is always a plane and the second a frame unless the control says all one kind.
    if (i < 0.5) h = 0.98;
    if (i > 0.5 && i < 1.5) h = 0.02;
    return step(h, frames);
}

float sdBox(vec2 q, vec2 b) {
    vec2 d = abs(q) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// A frame is three tubes: two posts and a lintel, standing open at the floor.
float sdFrame(vec2 q, vec2 b) {
    float posts = length(vec2(abs(q.x) - b.x, max(abs(q.y) - b.y, 0.0)));
    float top = length(vec2(max(abs(q.x) - b.x, 0.0), q.y - b.y));
    return min(posts, top);
}

void main() {
    if (PASSINDEX == 0) {
        // Slot 0: the layout now (x), the layout it is leaving (y), how far the glide has run (z).
        // Slot 1: a candidate layout (x) and how long it has held (y), and the bar last seen (z).
        // A chord's layout key is its set of pitch classes, so the same chord always builds the
        // same room; a part with single notes or none rebuilds on the bar instead.
        float slot = floor(gl_FragCoord.x / 8.0);
        vec4 s0 = IMG_NORM_PIXEL(room, vec2(0.25, 0.5));
        vec4 s1 = IMG_NORM_PIXEL(room, vec2(0.75, 0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float key = 0.0;
        float count = 0.0;
        for (int k = 0; k < 4; k++) {
            float fk = float(k);
            if (energyAt(fk) > 0.3) {
                float pc = mod(floor(fract(noteAt(fk) * 127.0 / 12.0) * 12.0 + 0.5), 12.0);
                key += exp2(pc);
                count += 1.0;
            }
        }
        float cur = s0.x;
        float prv = s0.y;
        float prog = s0.z;
        float cand = s1.x;
        float age = s1.y;
        float bars = s1.z;
        float want = cur;
        // Keys stay below 2048 so they survive a half-float state target exactly.
        key = mod(key * 7.0, 1009.0);
        if (count > 1.5) {
            want = key;
        } else if (abs(vxBars - bars) > 0.5 && vxEnv > 0.05) {
            want = 1100.0 + mod(vxBars, 64.0);
        }
        if (FRAMEINDEX < 2 || s0.a < 0.5 || s1.a < 0.5) {
            // Cold start: the chord's room, or the bar's when there is no chord.
            want = count > 1.5 ? key : 1100.0 + mod(vxBars, 64.0);
            cur = want;
            prv = want;
            prog = 1.0;
            cand = want;
            age = 1.0;
        } else {
            // A new layout must hold for a moment (so a chord's notes landing one by one count once).
            if (abs(want - cand) > 0.5) {
                cand = want;
                age = 0.0;
            } else {
                age += dt;
            }
            if (abs(cand - cur) > 0.5 && age > 0.07) {
                prv = prog > 0.5 ? cur : prv;
                cur = cand;
                prog = 0.0;
            }
            prog = min(prog + dt / GLIDE, 1.0);
        }
        bars = vxBars;
        gl_FragColor = slot < 0.5 ? vec4(cur, prv, prog, 1.0) : vec4(cand, age, bars, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;
    // Lay the room out across the frame's width, whatever its aspect.
    float wide = clamp(asp / 1.7778, 0.3, 1.4);
    float narrow = pow(min(wide, 1.0), 0.8);

    vec4 st = IMG_NORM_PIXEL(room, vec2(0.25, 0.5));
    float glide = smoothstep(0.0, 1.0, st.z);
    float anyNote = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pulse = clamp(vxPulse, 0.0, 1.0);
    float spread = 0.035 + 0.09 * haze;

    vec3 col = vec3(0.0);
    vec3 hazeC = accent.rgb;
    float total = 0.0;
    for (int k = 0; k < 4; k++) {
        float fi = float(k);
        vec4 a = pieceShape(st.y, fi);
        vec4 b = pieceShape(st.x, fi);
        vec4 sh = mix(a, b, glide);
        float kind = mix(pieceKind(st.y, fi), pieceKind(st.x, fi), glide);
        float depth = sh.y;
        float sc = 0.62 + 0.55 * depth;
        vec2 hb = vec2(sh.z * narrow, sh.w * 0.5) * sc;
        float base = -0.13 - 0.25 * depth;
        vec2 ctr = vec2(sh.x * wide, base + hb.y);
        vec2 q = p - ctr;

        // How brightly it is lit: its own note, or the part's level when it has no notes.
        float e = anyNote > 0.02 ? max(energyAt(fi), REST * 0.7) : REST + (0.75 - REST) * sw;
        e *= 1.0 + 0.2 * pulse;
        // Farther pieces sit deeper in the haze: dimmer and softer.
        float aerial = 0.6 + 0.4 * depth;
        float soft = px * 1.2 + 0.004 * (1.0 - depth);
        vec3 c = lightColor(fi);
        vec3 hot = mix(c, vec3(1.0), 0.5);

        // Nearer solid planes hide what stands behind them.
        float vis = 1.0;
        for (int m = 0; m < 4; m++) {
            if (m == k) continue;
            float fm = float(m);
            vec4 sm = mix(pieceShape(st.y, fm), pieceShape(st.x, fm), glide);
            float km = mix(pieceKind(st.y, fm), pieceKind(st.x, fm), glide);
            float scm = 0.62 + 0.55 * sm.y;
            vec2 hm = vec2(sm.z * narrow, sm.w * 0.5) * scm;
            vec2 cm = vec2(sm.x * wide, -0.13 - 0.25 * sm.y + hm.y);
            float covm = smoothstep(px, -px, sdBox(p - cm, hm)) * (1.0 - km);
            vis *= 1.0 - covm * smoothstep(-0.02, 0.02, sm.y - depth);
        }

        vec3 lit = vec3(0.0);
        // A plane: an even field of light, a touch brighter toward its lower edge where it meets
        // the floor's bounce, with a faint hot rim where the light gathers at its edge.
        float sd = sdBox(q, hb);
        float inside = smoothstep(soft, -soft, sd);
        // Inside, the light is strongest through the middle and falls off softly toward the edges,
        // so a plane glows like a lit surface rather than a flat card.
        vec2 qn = q / hb;
        float body = 0.62 + 0.38 * exp(-dot(qn * vec2(0.9, 0.6), qn * vec2(0.9, 0.6)) * 1.6);
        float lower = 0.9 + 0.25 * smoothstep(0.2, -1.0, qn.y);
        float rim = exp(-sd * sd / 0.00003) * 0.3;
        lit += (c * body * lower * inside + hot * (rim + 0.25 * exp(-dot(qn, qn) * 2.5)) * inside) * 1.1 * (1.0 - kind);
        // A frame: three tubes of light with a white-hot core.
        float sf = sdFrame(q, hb);
        float tw = 0.0045 * sc;
        float tube = exp(-sf * sf / (tw * tw)) + 0.5 * exp(-sf * sf / (tw * tw * 9.0));
        float core = smoothstep(tw * 0.6 + px, tw * 0.6 - px, sf);
        lit += (c * tube * 1.3 + hot * core * 1.4) * kind;
        // Haze round it: a soft near glow and a wide faint one, tinted toward the room's haze.
        float dHalo = mix(max(sd, 0.0), sf, kind);
        float halo = exp(-dHalo / spread) * 0.22 + exp(-dHalo / (spread * 5.0)) * 0.06;
        lit += mix(c, hazeC, 0.3) * halo * (0.55 + 0.45 * kind);

        // The floor in front of it: a pool of its light spilling toward you, and its blurred
        // reflection in the polished floor.
        float below = max(base - p.y, 0.0);
        float onFloor = smoothstep(-px, px, base - p.y);
        float dx = max(abs(q.x) - hb.x, 0.0);
        float pool = exp(-dx / (0.03 + 0.4 * below)) * exp(-below / (0.08 + 0.25 * hb.y)) * (0.5 - 0.25 * kind);
        vec2 qm = vec2(q.x, (base - (p.y - base)) - ctr.y);
        float blur = 0.004 + 0.3 * below;
        float sdm = mix(sdBox(qm, hb), sdFrame(qm, hb) - tw, kind);
        float refl = exp(-max(sdm, 0.0) / blur) * exp(-below * 3.5) * gloss * (0.45 - 0.25 * kind);
        lit += (c * pool + mix(c, hot, 0.3) * refl) * onFloor;

        col += lit * e * aerial * vis;
        total += e;
    }
    // The room's haze, lit faintly by everything in it, and a dark floor that is never quite black.
    col += hazeC * 0.012 * (0.5 + total) * (0.4 + 0.6 * haze) * exp(-abs(p.y + 0.05) / 0.5);

    // Tone map on luminance so the colors keep their hue, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.4));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Light is only as solid as it is bright.
        outa = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
