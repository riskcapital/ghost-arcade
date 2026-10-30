/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A sound-system stack drawn in fine lines and seen from low down: a wall of boxes, each with its drivers. The low drivers breathe with the sound's level; every note punches the drivers at its own height, high notes up top and low notes at the bottom, and the cones settle with a little wobble. A thin LED on each box lights with its driver, and heat shimmers above the stack.",
    "PASSES": [
        {
            "TARGET": "coneState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 4, "MIN": 1, "MAX": 6 },
        { "NAME": "rows", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 4, "MIN": 1, "MAX": 6 },
        { "NAME": "flex", "LABEL": "Flex", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "settle", "LABEL": "Settle time", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Heat haze", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "perspective", "LABEL": "Perspective", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "LEDs", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0.28, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// coneState: slots 0..2 hold the newest notes as (height 0..1, age in seconds,
// velocity, 1 if used); slot 3 holds (last count + 1, ready). Each slot is a
// quarter of the target wide and read at its centre.
const float SLOTS = 3.0;
const float STATE_W = 4.0;
// One box, in stack units.
const float BW = 1.3;
const float BH = 1.0;
const float DEPTH = 0.85;
const float GAP = 0.035;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec4 slotAt(float i) {
    return IMG_NORM_PIXEL(coneState, vec2((i + 0.5) / STATE_W, 0.5));
}

// Height on the stack for a note: a bass register folded into sixteen semitones.
float noteHeight(float pitch) {
    float n = floor(pitch * 127.0 + 0.5);
    if (n > 46.0) n -= 12.0 * ceil((n - 46.0) / 12.0);
    if (n < 31.0) n += 12.0 * ceil((31.0 - n) / 12.0);
    return clamp((n - 30.5) / 16.0, 0.0, 1.0);
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// A thin line, d in stored pixels.
float lineAt(float d, float w) {
    return exp(-d * d / (w * w)) + 0.05 * exp(-abs(d) / (w * 4.0));
}

// The camera: low and off to the right, looking at the middle of the stack.
void camera(vec2 s, float W, float H, float aspect, out vec3 eye, out vec3 rd) {
    float yaw = 0.9 * perspective;
    float tilt = 0.2 * perspective;
    float focal = mix(4.0, 1.45, perspective);
    // Aimed a little above the middle so the stack sits low, with air for the haze.
    vec3 target = vec3(0.06 * W * perspective, H * 0.6, DEPTH * 0.3);
    float dist = focal * max(H / 0.68, W / (aspect * 0.74));
    eye = target + dist * vec3(sin(yaw) * cos(tilt), -sin(tilt), -cos(yaw) * cos(tilt));
    vec3 fwd = normalize(target - eye);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    rd = normalize(fwd * focal + right * s.x + up * s.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float me = floor(uv.x * STATE_W);
        vec4 meta = slotAt(SLOTS);
        float n = floor(vxCount + 0.5);
        bool ready = meta.y > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (me < SLOTS) {
            vec4 s = slotAt(me);
            s.y = min(s.y + dt, 60.0);
            if (!ready) s = vec4(0.5, 60.0, 0.0, 0.0);
            if (fresh && abs(me - mod(n, SLOTS)) < 0.5) {
                s = vec4(noteHeight(vxPitch), 0.0, clamp(vxVel, 0.15, 1.0), 1.0);
            }
            gl_FragColor = s;
        } else {
            gl_FragColor = vec4(n + 1.0, 1.0, 0.0, 1.0);
        }
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float C = floor(columns + 0.5);
    float R = floor(rows + 0.5);
    float W = C * BW;
    float H = R * BH;
    vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 fwPx = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float px = 1.0 / RENDERSIZE.y;

    // Heat haze: find where we are on the front plane, then bend the view
    // a few pixels just above the stack so its top edge shimmers.
    vec3 eye;
    vec3 rd;
    camera(s, W, H, aspect, eye, rd);
    vec2 p0 = (eye + rd * (-eye.z / rd.z)).xy;
    float ph = vxPhase;
    float above = smoothstep(H - 0.45, H + 0.05, p0.y) * smoothstep(H + 2.4, H + 0.2, p0.y)
                * smoothstep(W * 0.5 + 0.6, W * 0.5 - 0.1, abs(p0.x));
    float heat = haze * (0.35 + 0.65 * vxEnv);
    vec2 hz = vec2(noise2(vec2(p0.x * 5.0, p0.y * 3.0 - ph * 1.6)), noise2(vec2(p0.x * 5.0 + 7.3, p0.y * 3.0 - ph * 1.6 + 3.1))) - 0.5;
    s += hz * above * heat * 5.0 * px * fwPx.y;
    camera(s, W, H, aspect, eye, rd);

    // Front plane (z = 0) and the visible side plane, both in stack units.
    vec3 rdd = vec3(abs(rd.x) < 1e-5 ? 1e-5 : rd.x, rd.y, rd.z);
    vec2 pF = (eye + rdd * (-eye.z / rdd.z)).xy;
    float xs = eye.x > 0.0 ? W * 0.5 : -W * 0.5;
    vec3 hs = eye + rdd * ((xs - eye.x) / rdd.x);
    vec2 pS = vec2(hs.z, hs.y);
    // Stack units per stored pixel, for lines of a steady width.
    vec2 gF2 = max(vec2(length(vec2(dFdx(pF.x), dFdy(pF.x))), length(vec2(dFdx(pF.y), dFdy(pF.y)))), vec2(1e-5));
    vec2 gS2 = max(vec2(length(vec2(dFdx(pS.x), dFdy(pS.x))), length(vec2(dFdx(pS.y), dFdy(pS.y)))), vec2(1e-5));
    float gF = sqrt(gF2.x * gF2.y);
    float gy = gF2.y;
    vec2 slope = rdd.xy / rdd.z;

    // Shimmer field above the stack: thin rising contours.
    vec2 hp = vec2(pF.x * 5.0, (pF.y - H) * 1.0 - ph * 0.5);
    float warpX = noise2(hp * vec2(0.4, 1.8) + vec2(3.0, 0.0)) - 0.5;
    float f = noise2(vec2(hp.x + warpX * 1.8, hp.y * 0.4)) * 3.0;
    // The strands come and go along their length.
    float broken = smoothstep(0.35, 0.75, noise2(vec2(hp.x * 0.7 + 11.0, hp.y * 1.3 - ph * 0.2)));
    float fwf = max(fwidth(f), 1e-4);

    // Which face the ray enters first.
    vec3 bmin = vec3(-W * 0.5, 0.0, 0.0);
    vec3 bmax = vec3(W * 0.5, H, DEPTH);
    vec3 inv = 1.0 / rdd;
    vec3 t0 = (bmin - eye) * inv;
    vec3 t1 = (bmax - eye) * inv;
    vec3 tmn = min(t0, t1);
    vec3 tmx = max(t0, t1);
    float tN = max(max(tmn.x, tmn.y), tmn.z);
    float tF = min(min(tmx.x, tmx.y), tmx.z);
    bool onStack = tN < tF && tF > 0.0;
    bool front = onStack && tmn.z >= tmn.x && tmn.z >= tmn.y;

    float wl = mix(0.55, 1.5, lineWidth);
    float gain = 0.5 + 1.3 * brightness;
    float light = 0.0;
    float led = 0.0;

    if (front) {
        vec2 g = vec2(pF.x + W * 0.5, pF.y);
        vec2 cell = clamp(floor(g / vec2(BW, BH)), vec2(0.0), vec2(C - 1.0, R - 1.0));
        vec2 centre = (cell + 0.5) * vec2(BW, BH) - vec2(W * 0.5, 0.0);
        vec2 lc = pF - centre;
        vec2 he = vec2(BW, BH) * 0.5 - GAP;
        float rowY = (cell.y + 0.5) / R;

        // How hard this row is driven: the level breathes the low boxes,
        // and each note punches the row at its height, then rings down.
        float tau = mix(0.12, 0.42, settle);
        float omega = 6.2832 * mix(3.0, 2.0, settle);
        float punch = 0.0;
        float glow = 0.0;
        for (int i = 0; i < 3; i++) {
            vec4 st = slotAt(float(i));
            if (st.w > 0.5) {
                float dr = (rowY - st.x) * R;
                float w = exp(-dr * dr / 0.45) * st.z;
                w *= 0.8 + 0.4 * hash11(cell.x * 7.1 + float(i) * 3.3 + st.x * 40.0);
                punch += w * exp(-st.y / tau) * cos(omega * st.y);
                glow += w * exp(-st.y / (tau * 0.55));
            }
        }
        float breath = vxEnv * mix(1.0, 0.25, rowY);
        float idle = 0.06 * sin(ph * 1.7 + cell.x * 0.9 + cell.y * 1.3);
        float travel = (0.07 + 0.11 * flex) * (0.55 * breath * (0.4 + flex) + punch * (0.3 + 0.9 * flex) + idle);
        float act = clamp(glow * (0.5 + 0.9 * flex) + 0.22 * breath, 0.0, 1.4);

        // Box outline, and a fainter baffle line just inside it.
        float box = lineAt(abs(sdBox(lc / gF2, he / gF2)), wl) * (0.16 + 0.4 * act);
        box += lineAt(abs(sdBox(lc / gF2, (he - 0.045) / gF2)), wl * 0.8) * (0.05 + 0.08 * act);

        // Drivers: one big cone in the lower boxes, two smaller ones above.
        bool twin = cell.y >= floor(R * 0.5) && R > 1.5;
        float rad = twin ? 0.205 : 0.385;
        float cones = 0.0;
        for (int k = 0; k < 2; k++) {
            float fk = float(k);
            if (k == 0 || twin) {
                vec2 dc = centre + vec2(twin ? (fk * 2.0 - 1.0) * 0.3 : 0.0, twin ? 0.03 : 0.0);
                // Each ring sits at its own depth, so the cone shows real parallax
                // as it moves: rim flush, surround a touch in, dust cap deep.
                // The cone swells as it pushes out, so the flex reads head-on too.
                float k = travel / 0.14;
                vec2 q0 = pF - dc;
                vec2 q1 = pF + slope * (0.015 - travel * 0.45 * rad) - dc;
                vec2 q2 = pF + slope * ((0.09 - travel) * rad * 2.2) - dc;
                vec2 q3 = pF + slope * ((0.16 - travel) * rad * 2.2) - dc;
                float rim = lineAt(abs(length(q0) - rad) / gF, wl);
                float sur = lineAt(abs(length(q1) - rad * 0.84 * (1.0 + 0.03 * k)) / gF, wl * 0.85);
                float coneR = lineAt(abs(length(q2) - rad * 0.58 * (1.0 + 0.15 * k)) / gF, wl * 0.8);
                float cap = lineAt(abs(length(q3) - rad * 0.3 * (1.0 + 0.36 * k)) / gF, wl);
                // Bolts round the rim.
                float ang = atan(q0.y, q0.x);
                float seg = 6.2832 / 8.0;
                float a8 = (fract(ang / seg + 0.5) - 0.5) * seg;
                vec2 bp = vec2(cos(a8), sin(a8)) * length(q0) - vec2(rad * 1.09, 0.0);
                float bolt = exp(-dot(bp, bp) / (gF * gF * wl * wl * 1.2));
                cones += rim * (0.17 + 0.5 * act) + sur * (0.08 + 0.65 * act) + coneR * (0.045 + 0.55 * act)
                       + cap * (0.13 + 1.2 * act) + bolt * (0.1 + 0.25 * act);
            }
        }
        light = box + cones;

        // The LED: a short bar low on the right of each box.
        vec2 la = vec2(he.x - 0.2, -he.y + 0.085);
        vec2 lb = vec2(he.x - 0.09, -he.y + 0.085);
        led = lineAt(sdSegment(lc / gF2, la / gF2, lb / gF2), wl * 1.1) * (0.06 + 1.1 * clamp(act, 0.0, 1.0));
    } else if (onStack || (pS.x > -0.05 && pS.x < DEPTH + 0.1 && pS.y > -0.05 && pS.y < H + 0.05)) {
        // The side of the stack: one outline per box, running back, and its
        // back edge drawn just past the silhouette too.
        float j = clamp(floor(pS.y / BH), 0.0, R - 1.0);
        vec2 lc = vec2(pS.x - DEPTH * 0.5, pS.y - (j + 0.5) * BH);
        float side = lineAt(abs(sdBox(lc / gS2, vec2(DEPTH * 0.5, BH * 0.5 - GAP) / gS2)), wl);
        light = side * 0.17;
    } else {
        // The floor line either side of the stack.
        float off = max(abs(pF.x) - W * 0.5, 0.0);
        light = lineAt(abs(pF.y) / gy, wl * 0.9) * 0.12 * exp(-off / (W * 0.35)) * step(pF.y, 0.5);
    }

    // Shimmer above the stack, faint, more with heat.
    float rise = smoothstep(H - 0.02, H + 0.3, pF.y) * smoothstep(H + 1.7, H + 0.35, pF.y)
               * smoothstep(W * 0.5 + 0.1, W * 0.5 - 0.6, abs(pF.x));
    if (rise > 0.001 && !front) {
        float fd = abs(fract(f) - 0.5);
        float fl = lineAt((0.5 - fd) / fwf, wl * 0.8);
        light += fl * broken * rise * rise * haze * (0.05 + 0.1 * vxEnv);
    }

    vec3 col = ink.rgb * (1.0 - exp(-light * gain * 1.6));
    col += accent.rgb * min(led * gain, 1.2);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
