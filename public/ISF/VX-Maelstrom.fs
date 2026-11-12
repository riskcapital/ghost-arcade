/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A whirlpool of light seen at a slight tilt. Streams of light enter at the rim and every frame the picture is drawn inward and turned - slowly at the edge, fast near the center - so the light winds down in spiral arms and vanishes into a dark eye with a hot lip. The colors split a little as they turn, so the arms carry prism fringes, and a deep glow rises off the water. Quiet passages wind the arms tight; as the music swells the pull grows and they loosen and open out; each hit surges the drain, widens the eye and flares the streams and glints at the rim, then it settles.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pull", "LABEL": "Pull", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "arms", "LABEL": "Arms", "TYPE": "float", "DEFAULT": 3, "MIN": 2, "MAX": 6 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "eye", "LABEL": "Eye", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "prism", "LABEL": "Prism", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.25, 0.65, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.2, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// The drain wanders a little, slowly.
vec2 drainAt(float t) { return vec2(0.035 * sin(t * 0.13), 0.025 * sin(t * 0.097 + 1.3)); }

// How much the whirlpool's plane is squashed vertically (seen at a tilt).
float squash() { return 1.0 - 0.45 * clamp(tilt, 0.0, 1.0); }

// Screen point -> the whirlpool's own plane, drain at the origin.
vec2 planeOf(vec2 uv, float aspect, float t) {
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0) - drainAt(t);
    p.y /= squash();
    return p;
}

vec2 screenOf(vec2 q, float aspect, float t) {
    q.y *= squash();
    return (q + drainAt(t)) / vec2(aspect, 1.0) + 0.5;
}

// The eye opens on hits and closes again.
float eyeRadius() { return 0.03 + 0.06 * eye + 0.035 * vxPulse; }

// Pull: inward, faster toward the drain; the swell and every hit surge it.
float inflowAt(float r) {
    float lv = max(0.3, 1.0 + 0.6 * (clamp(vxLevel, 0.0, 3.0) - 1.0));
    float pullAmt = (0.002 + 0.0065 * pull) * lv * (1.0 + 0.8 * vxSwell) + 0.014 * (0.2 + pull) * vxPulse;
    return pullAmt * (0.35 + 0.9 * r + 0.022 / (r + 0.05));
}

// Spin: angular speed falls off with radius, so the arms wind tighter with time.
float spinAt(float r) {
    float spinAmt = (0.0011 + 0.0055 * spin) * (1.0 + 0.25 * vxSwell + 0.4 * vxPulse);
    return spinAmt / (r * r + 0.02);
}

// The look's motion: where this pixel's light was last frame. Light is drawn
// inward and turned like water round a drain: a free vortex (fast near the
// centre, slow at the rim) with a small solid core. chan nudges the turn per
// colour channel, so the colours part a little as they wind down.
vec2 sourceOf(vec2 uv, float aspect, float t, float s, float chan) {
    vec2 q = planeOf(uv, aspect, t);
    float r = length(q) + 1e-4;
    float inflow = inflowAt(r);
    float w = spinAt(r);
    w *= 1.0 + chan * 0.07 * prism;
    // A slow spiral wave rides on the arms so they never sit still.
    float a = atan(q.y, q.x);
    float wave = sin(a * 3.0 - log(r + 0.02) * 4.0 - t * 0.9) * 0.0012 * (1.0 + vxSwell);
    float rs = r + s * (inflow + wave * r);
    q = rot2(-w * s) * (q * (rs / r));
    return screenOf(q, aspect, t);
}

// Fades anything that would be read from beyond the frame (nothing there).
float inFrame(vec2 st) {
    vec2 e = min(st, 1.0 - st);
    return smoothstep(-0.002, 0.012, min(e.x, e.y));
}

float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

// The look's new light: streams fed in at the rim and a necklace of glints that
// each leave a fine thread; hits flare both.
vec3 pourIn(vec2 q, float t, out float cover) {
    float r = length(q);
    float a = atan(q.y, q.x);
    float k = squash();
    float rim = clamp(0.5 / k, 0.5, 0.75);
    // Glints are drawn out along the way the water carries them, long enough
    // that even a slow frame leaves no gaps in their threads.
    vec2 carry = vec2(spinAt(rim) * rim, -inflowAt(rim));
    float stride = length(carry) * frameStep();
    vec2 cu = carry / max(length(carry), 1e-6);
    float n = clamp(arms, 2.0, 6.0);
    float drive = 0.24 + 0.22 * vxSwell + 0.55 * vxPulse;
    vec3 col = vec3(0.0);
    // The arms' feeders: they orbit the rim faster than the water turns there,
    // shift a little with each hit, and their light comes in waves, so you can
    // watch it travel down.
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float on = clamp(n - fi, 0.0, 1.0);
        float ang = TAU * fi / n + t * 0.15 + 0.25 * sin(t * 0.11 + fi * 2.1) + 0.3 * sin(vxMorph * TAU * 5.0 / 64.0 + fi * 1.7);
        float rad = rim * (1.0 + 0.08 * sin(t * 0.23 + fi * 1.7));
        vec2 c = vec2(cos(ang), sin(ang)) * rad;
        vec2 dl = rot2(ang) * (q - c);
        float e = length(dl / vec2(0.016 + 0.008 * vxPulse, 0.045 + 0.03 * vxPulse));
        float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 2.6 + fi * 1.9), 2.0);
        vec3 tint = mix(ink.rgb, accent.rgb, smoothstep(-0.35, 0.35, sin(fi * PI + 0.5 * PI + 0.6 * sin(t * 0.07 + fi))));
        col += tint * exp(-e * e) * drive * wave * on;
    }
    // Glints: one per sector round the rim, each brightening and dimming on its own.
    const float cells = 40.0;
    float ca = (a - t * 0.2) / TAU * cells;
    float id = mod(floor(ca), cells);
    float h = hash1(id);
    float h2 = hash1(id * 1.37 + 9.0);
    float gr = rim * (0.92 + 0.22 * h2);
    float arc = (fract(ca) - 0.5) * TAU / cells * r;
    vec2 off = vec2(arc, r - gr);
    float gd = length(vec2(dot(off, cu) / max(0.012, 0.7 * stride), dot(off, vec2(-cu.y, cu.x)) / 0.0045));
    float twinkle = pow(0.5 + 0.5 * sin(t * (1.1 + 1.4 * h) + h * TAU), 2.0);
    col += mix(ink.rgb, accent.rgb, step(0.5, h2)) * exp(-gd * gd) * twinkle * (0.35 + 0.35 * vxSwell + 0.9 * vxPulse);
    cover = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
        // Quarter-size blur of last frame.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 3.0);
            acc += IMG_NORM_PIXEL(feedback, uv + vec2(float(i), float(j)) * px * 4.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 1) {
        // A much wider blur, for the glow off the water.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 4.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i), float(j)) * px * 16.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        vec2 sG = sourceOf(uv, aspect, t, s, 0.0);
        // Stream a little along the light's own contours, so the arms stay silky.
        vec2 bpx = 4.0 / RENDERSIZE;
        float gx = luma(IMG_NORM_PIXEL(blurA, sG + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, sG - vec2(bpx.x, 0.0)).rgb);
        float gy = luma(IMG_NORM_PIXEL(blurA, sG + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, sG - vec2(0.0, bpx.y)).rgb);
        vec2 slide = vec2(-gy, gx) * s * 0.0025 * (1.0 + vxSwell + 2.0 * vxPulse);
        vec2 sR = sourceOf(uv, aspect, t, s, 1.0) + slide;
        vec2 sB = sourceOf(uv, aspect, t, s, -1.0) + slide;
        sG += slide;
        vec4 pg = IMG_NORM_PIXEL(feedback, sG);
        vec4 prev = vec4(IMG_NORM_PIXEL(feedback, sR).r * inFrame(sR), pg.g * inFrame(sG), IMG_NORM_PIXEL(feedback, sB).b * inFrame(sB), pg.a * inFrame(sG));
        prev = clamp(prev, 0.0, 1.0);

        vec2 q = planeOf(uv, aspect, t);
        float r = length(q);
        // The eye swallows what reaches it.
        float er = eyeRadius();
        prev *= mix(1.0, smoothstep(er * 0.5, er * 1.15, r), clamp(0.35 * s, 0.0, 1.0));
        // Fade: Echo sets how long the past lingers, a little longer down the
        // throat so the threads reach the eye. Always at least a frame's worth.
        float keep = pow(mix(0.945, 0.988, echo) + 0.004 * vxSwell, max(s, 1.0) * mix(0.5, 1.0, smoothstep(0.08, 0.45, r)));
        vec4 col = max(prev * keep - vec4(0.0015 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        float cv;
        vec3 add = pourIn(q, t, cv);
        col.rgb = col.rgb + add * (1.0 - col.rgb);
        col.a = clamp(col.a + cv * (1.0 - col.a), 0.0, 1.0);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: prism fringes spreading out from the drain, a deep glow off
    // the water, a hot lip round the eye and the abyss inside it.
    vec2 q = planeOf(uv, aspect, t);
    float r = length(q);
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0) - drainAt(t);
    vec2 dir = d / (length(d) + 1e-4) / vec2(aspect, 1.0);
    float split = prism * (0.0015 + 0.006 * length(d)) * (1.0 + 0.8 * vxPulse);
    vec3 fb = vec3(IMG_NORM_PIXEL(feedback, uv + dir * split).r,
                   IMG_NORM_PIXEL(feedback, uv).g,
                   IMG_NORM_PIXEL(feedback, uv - dir * split).b);
    vec3 glow = IMG_NORM_PIXEL(blurB, uv).rgb;
    vec3 near = IMG_NORM_PIXEL(blurA, uv).rgb;
    float er = eyeRadius();
    float lipBand = exp(-pow((r - er * 1.03) / (0.005 + 0.12 * er), 2.0));
    vec3 lip = mix(accent.rgb, vec3(1.0), 0.45) * lipBand * (0.03 + 0.15 * vxSwell + 0.45 * vxPulse + 2.2 * luma(near));
    vec3 light = fb * 1.3 + glow * (0.3 + 0.25 * vxSwell + 0.45 * vxPulse) + lip;
    // The abyss.
    light *= smoothstep(er * 0.55, er * 1.0, r);
    vec3 col = 1.0 - exp(-light * 1.55);
    // Keep the dark water dark between the arms.
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.6);
    float vig = smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(aspect, 1.0)));
    col *= mix(0.5, 1.0, vig);
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.3, 0.0, 1.0);
    } else {
        vec3 bg = mix(vec3(0.004, 0.005, 0.011), mix(ink.rgb, accent.rgb, 0.25) * 0.03, 0.55);
        bg *= (0.45 + 0.55 * vig) * smoothstep(er * 0.8, er * 4.0, r);
        col = bg + col * (1.0 - bg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
