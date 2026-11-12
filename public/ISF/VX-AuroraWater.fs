/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Aurora curtains hanging over a low dark shore, mirrored in still black water. Every note of the chord takes a curtain in its own color: the note's place in the octave sets where it hangs, and the curtain drifts there and folds slowly as the chord changes, its rays rising from a bright lower edge. Each hit sends a slow ripple across the water that breaks up the reflection, and now and then streaks a falling star across the sky; louder playing lifts the curtains higher. With no sound two faint curtains glow low over the water.",
    "PASSES": [
        {
            "TARGET": "sky",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 40,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "fold", "LABEL": "Folds", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripples", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "meteors", "LABEL": "Falling stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First curtain", "TYPE": "color", "DEFAULT": [0.22, 1.0, 0.55, 1.0] },
        { "NAME": "accent", "LABEL": "Second curtain", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.62, 1.0] },
        { "NAME": "palBody", "LABEL": "Third curtain", "TYPE": "color", "DEFAULT": [0.2, 0.72, 1.0, 1.0] },
        { "NAME": "palAccent", "LABEL": "Fourth curtain", "TYPE": "color", "DEFAULT": [0.62, 0.38, 1.0, 1.0] },
        { "NAME": "palLight", "LABEL": "Stars and hems", "TYPE": "color", "DEFAULT": [0.86, 0.95, 1.0, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
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

// The horizon, in frame heights from the centre (negative is below).
const float HORIZON = -0.17;
// How bright a curtain with no note rests.
const float REST = 0.3;
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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
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

vec3 curtainColor(float i) {
    if (i < 0.5) return ink.rgb;
    if (i < 1.5) return accent.rgb;
    if (i < 2.5) return palBody.rgb;
    return palAccent.rgb;
}

vec4 slot(float i) {
    return IMG_NORM_PIXEL(sky, vec2((i + 0.5) / 5.0, 0.5));
}

// The low shore: a ridge that rises toward the sides of the frame, flatter in the middle.
float shoreTop(float x, float asp) {
    float side = smoothstep(0.05, 0.85, abs(x) / (0.5 * asp));
    float r = noise1(x * 3.1 + 7.0) * 0.6 + noise1(x * 9.0 + 2.0) * 0.28 + noise1(x * 31.0) * 0.12;
    return HORIZON + max(r * (0.02 + 0.075 * side) - 0.012, 0.0);
}

// One curtain's light at q. st = (where it hangs 0-1, brightness).
vec3 curtain(vec2 q, float i, vec4 st, float t, float asp, float lift) {
    float e = st.y;
    if (e < 0.003) return vec3(0.0);
    // Nearer curtains (larger depth) hang higher and longer.
    float depth = 0.45 + 0.55 * hash11(i * 3.7 + 1.3);
    float cx = (st.x - 0.5) * asp * 0.8;
    float halfLen = (0.28 + 0.22 * depth) * asp * 0.5;
    // Folds: the sheet bunches where it turns edge-on, and is brightest there.
    float a = 0.35 + 0.5 * fold;
    float k = 5.0 + 3.0 * hash11(i + 9.0);
    float ph = t * (0.16 + 0.05 * i) + i * 2.1;
    float s = q.x - cx;
    for (int it = 0; it < 4; it++) {
        s = (q.x - cx) - a * sin(k * s + ph) / k;
    }
    float dxds = 1.0 + a * cos(k * s + ph);
    float bunch = 1.0 / max(dxds, 0.45);
    // The sheet thins out toward its ends (measured on the sky, so a fold there cannot cut it off).
    float ends = smoothstep(halfLen, halfLen * 0.25, abs(q.x - cx));
    ends *= ends;
    if (ends <= 0.0) return vec3(0.0);
    // The lower edge undulates slowly.
    float hem = HORIZON + 0.07 + 0.2 * depth
        + 0.05 * sin(s * 2.3 + t * 0.11 + i * 1.7)
        + 0.022 * sin(k * s + ph + 0.8) * fold
        + 0.03 * (noise1(s * 4.0 + t * 0.07 + i * 13.0) - 0.5);
    float v = q.y - hem;
    // Rays: fine vertical striations drifting along the sheet, each reaching its own height.
    float rs = s * 70.0 + t * 0.35 + i * 40.0;
    float r1 = noise2(vec2(rs, t * 0.25 + i));
    float r2 = noise2(vec2(rs * 0.31 + 5.0, t * 0.12));
    float rays = 0.35 + 0.65 * r1 * r1 + 0.4 * r2;
    float tall = (0.07 + 0.2 * height * depth) * (0.75 + 0.5 * lift) * (0.6 + 0.8 * r2);
    // Brightest at the lower edge: a sharp rise from below, then a glow fading up the rays.
    float edge = 0.8 + 0.6 * rays;
    float prof = v > 0.0 ? exp(-v / (0.025 + 0.02 * depth)) * 0.8 + exp(-v / tall) * 0.6 * rays : edge * exp(v / 0.006);
    float light = prof * ends * bunch * e;
    vec3 c = curtainColor(i);
    // The lower edge burns whiter; the tops cool and deepen.
    float topness = clamp(v / (tall * 1.5 + 0.02), 0.0, 1.0);
    vec3 hot = mix(c, palLight.rgb, 0.45);
    vec3 cc = mix(hot * 1.4, c, smoothstep(0.0, 0.035, v));
    cc = mix(cc, c * vec3(0.7, 0.55, 1.0) * 0.8, topness * 0.6);
    return cc * light * (0.7 + 0.5 * depth);
}

// Everything above the water at q: night sky, stars, the curtains, the shore.
// mirror is 1 when seen in the water (stars dimmer there).
vec3 skyAt(vec2 q, float asp, float t, float lift, float px, float mirror) {
    float h = q.y - HORIZON;
    vec3 col = mix(vec3(0.004, 0.006, 0.013), vec3(0.01, 0.016, 0.028), exp(-max(h, 0.0) / 0.18));
    vec3 aur = vec3(0.0);
    vec3 air = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        float fi = float(k);
        vec4 st = slot(fi);
        aur += curtain(q, fi, st, t, asp, lift);
        // Each curtain also lights the air around and below it with a broad faint glow.
        float dx = (q.x - (st.x - 0.5) * asp * 0.8) / (0.45 * asp);
        air += curtainColor(fi) * st.y * exp(-dx * dx);
    }
    col += aur + air * 0.03 * exp(-max(h, 0.0) / 0.22);
    // Stars, thinning toward the horizon.
    vec2 g = q * 70.0;
    vec2 cid = floor(g);
    float hs = hash21(cid);
    if (hs < 0.1) {
        vec2 sp = cid + 0.2 + 0.6 * vec2(hash21(cid + 3.1), hash21(cid + 7.7));
        float d = length(g - sp) / 70.0;
        float mag = pow(hash21(cid + 1.9), 4.0);
        float tw = 0.75 + 0.25 * sin(TIME * (0.6 + hash21(cid + 5.0)) + hs * 40.0);
        float rad = px * (0.45 + 0.9 * mag);
        float star = smoothstep(rad + px, rad - px * 0.5, d) * (0.15 + 0.85 * mag) * tw;
        col += palLight.rgb * star * smoothstep(0.0, 0.12, h) * (1.0 - 0.75 * mirror);
    }
    // The shore is a dark silhouette that hides the sky behind it.
    float top = shoreTop(q.x, asp);
    float land = clamp((top - q.y) / px + 0.5, 0.0, 1.0);
    // Its slopes catch a trace of the curtains' light.
    vec3 shore = vec3(0.002, 0.0025, 0.004) + aur * 0.02;
    return mix(col, shore, land);
}

// Height of the water's swell at (x across, z into the distance): slow broad waves, and each
// hit's ripple travelling in from the far water.
float water(vec2 w, float t, float hitAge, float amp) {
    // Heights are scaled by their wavelength so every component tilts the surface about as much.
    float hgt = 0.0;
    hgt += sin(w.y * 9.0 - t * 0.6 + sin(w.x * 1.3) * 1.5) * 0.06;
    hgt += sin(w.y * 17.0 + w.x * 4.0 - t * 0.9) * 0.025;
    hgt += (noise2(vec2(w.x * 6.0, w.y * 22.0 - t * 0.5)) - 0.5) * 0.03;
    hgt *= amp;
    // A hit's ripple: a short train of waves rolling toward the viewer, fading as it comes.
    // Measured down the frame from the horizon, so it rolls toward the viewer at a steady pace.
    float below = 0.06 / max(w.y, 1e-3);
    float front = 0.004 + hitAge * 0.11;
    float d = (below - front) / (0.012 + 0.12 * front);
    hgt += sin(d * 5.0) * exp(-d * d * 0.35) * exp(-hitAge / 2.0) * 0.07 * ripple * step(0.0, hitAge);
    return hgt;
}

void main() {
    if (PASSINDEX == 0) {
        // Slots 0-3: each curtain's (where it hangs 0-1, brightness), easing so a chord change drifts.
        // Slot 4: (hit count seen, time of the latest hit, swell eased, 1).
        float i = clamp(floor(gl_FragCoord.x / 8.0), 0.0, 4.0);
        vec4 prev = slot(i);
        bool cold = FRAMEINDEX < 2 || prev.a < 0.5;
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (i > 3.5) {
            float n = floor(vxCount + 0.5);
            vec4 o = prev;
            float sw = prev.z + (vxSwell - prev.z) * (1.0 - exp(-dt / 0.5));
            if (cold) {
                o = vec4(n, vxPulse > 0.05 ? TIME - 0.5 : -100.0, vxSwell, 1.0);
            } else {
                o.z = sw;
                if (abs(n - prev.x) > 0.5) {
                    o.x = n;
                    o.y = TIME;
                }
            }
            gl_FragColor = o;
            return;
        }
        float anyNote = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
        float e = energyAt(i);
        float restAim = 0.5 + (i - 1.5) * 0.24;
        float aim = e > 0.02 ? 0.08 + 0.84 * fract(noteAt(i) * 127.0 / 12.0 + 0.5) : restAim;
        // With no notes, the first and third curtains rest faintly; a sound with no pitches
        // (drums) lights the rest of the sky with its level.
        float restE = (i < 0.5 || (i > 1.5 && i < 2.5)) ? REST : 0.0;
        float bright = anyNote > 0.02 ? max(e, restE * 0.5) : restE + 0.5 * clamp(vxEnv, 0.0, 1.0);
        float a = mix(prev.x, aim, 1.0 - exp(-dt / 0.6));
        float b = prev.y + (bright - prev.y) * (1.0 - exp(-dt / (bright > prev.y ? 0.25 : 1.2)));
        if (cold) {
            a = aim;
            b = bright;
        }
        gl_FragColor = vec4(a, b, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;
    vec4 hs = slot(4.0);
    float lift = clamp(max(hs.z, vxSwell), 0.0, 1.0);
    float t = vxFlow * 0.8 + TIME * 0.05;
    float hitAge = TIME - hs.y;

    vec3 col;
    float glint = 0.0;
    if (p.y > HORIZON) {
        col = skyAt(p, asp, t, lift, px, 0.0);
    } else {
        // Still water: perspective depth into the distance, and the swell's slope bending the mirror.
        float below = HORIZON - p.y;
        float z = 0.06 / max(below, 0.002);
        vec2 w = vec2(p.x * z, z);
        float amp = (0.25 + 0.75 * lift) * (0.3 + 0.7 * ripple);
        float eps = 0.02;
        float h0 = water(w, t, hitAge, amp);
        float hx = water(w + vec2(eps * z, 0.0), t, hitAge, amp);
        float hz = water(w + vec2(0.0, eps * z), t, hitAge, amp);
        vec2 slope = vec2(hx - h0, hz - h0) / (eps * z);
        // Nearer water bends the reflection more; far water is a near-perfect mirror.
        float bend = 0.02 * sqrt(below / 0.33);
        vec2 rq = vec2(p.x + slope.x * bend * 0.3, 2.0 * HORIZON - p.y + slope.y * bend);
        rq.y = max(rq.y, HORIZON + 0.0005);
        vec3 refl = skyAt(rq, asp, t, lift, px, 1.0);
        // Water reflects more toward the horizon, where it is seen at a grazing angle.
        float fres = mix(0.35, 0.85, exp(-below / 0.08));
        col = vec3(0.002, 0.003, 0.006) + refl * fres;
        // Crests facing the sky catch a brighter glint of the curtains above them.
        glint = pow(clamp(0.5 + 0.35 * slope.y, 0.0, 1.0), 8.0) * smoothstep(0.0, 0.05, below);
        col += refl * glint * 0.8;
    }

    // A falling star, now and then on a hit: a fine streak sliding down across the sky.
    float n = hs.x;
    if (hash11(n * 3.17 + 0.5) < meteors && hitAge > 0.0 && hitAge < 1.2) {
        vec2 start = vec2((hash11(n * 1.3) - 0.5) * asp * 0.8, 0.28 + 0.15 * hash11(n * 2.9));
        float ang = -0.35 - 0.5 * hash11(n * 5.1);
        vec2 dir = vec2(hash11(n * 7.7) < 0.5 ? -cos(ang) : cos(ang), sin(ang));
        float travel = 0.55 * (1.0 - exp(-hitAge / 0.35));
        vec2 head = start + dir * travel;
        vec2 rel = p - head;
        float along = dot(rel, -dir);
        float across = abs(dot(rel, vec2(-dir.y, dir.x)));
        float len = travel * 0.7;
        float trail = smoothstep(len, 0.0, along) * step(-0.002, along);
        float w = px * 0.9;
        float line = smoothstep(w + px, w * 0.3, across) * trail * trail;
        float fade = exp(-hitAge / 0.35) * smoothstep(0.0, 0.03, hitAge);
        vec3 mc = palLight.rgb * line * fade * 2.2 * step(HORIZON + 0.02, p.y);
        col += mc;
    }

    // Tone map on luminance so bright curtains keep their color, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.4));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only light is drawn: the night, the water and the shore go clear.
        vec3 lightOnly = max(col - vec3(0.012, 0.018, 0.03), 0.0) * 1.03;
        outa = clamp(max(max(lightOnly.r, lightOnly.g), lightOnly.b), 0.0, 1.0);
        outc = min(lightOnly, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
