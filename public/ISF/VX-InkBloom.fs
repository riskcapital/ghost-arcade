/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Ink dropped into still water, drawn as light on black. Each note lets a drop fall where its pitch says: it blooms outward in feathered petals and is carried off in slow curling currents, its heart warm while it is fresh. The water clears as the ink thins, so the dark stays dark.",
    "PASSES": [
        {
            "TARGET": "ibDrops",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {
            "TARGET": "ibMeta",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "ibWater",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "dropSize", "LABEL": "Drop size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "curl", "LABEL": "Curl", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "dissipation", "LABEL": "Dissipation", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "tendrils", "LABEL": "Tendril detail", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "flowSpeed", "LABEL": "Flow speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "warmth", "LABEL": "Warm cores", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Cores", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// ibDrops: four slots, one per recent drop: (x as a share of the width, y, age in seconds, strength).
// ibMeta:  (note count + 100 once running, 0, 0, 0).
// ibWater: r = ink, g = the fresh part of it, which cools faster.
const float DROPS = 4.0;
const float INJECT = 0.16;

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

// Value noise and its gradient.
vec3 noised(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k4 = a - b - c + d;
    return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

vec4 dropAt(float i) {
    return IMG_NORM_PIXEL(ibDrops, vec2((i + 0.5) / DROPS, 0.5));
}

float dropRadius() {
    return mix(0.025, 0.11, dropSize);
}

// Where a note's drop falls: across by pitch class (an octave spans the
// frame, higher octaves nudged right), down by a hash of the note.
vec2 dropPlace(float n) {
    float midi = floor(vxPitch * 127.0 + 0.5);
    float pc = mod(midi * 7.0, 12.0);
    float x = 0.14 + 0.72 * (pc + 0.5) / 12.0 + 0.03 * (floor(midi / 12.0) - 5.0);
    float y = 0.52 + 0.3 * hash21(vec2(n * 1.37, floor(vxPhase * 3.0)));
    return vec2(x, y);
}

// Slow curling current: the curl of a drifting noise potential.
vec2 current(vec2 p, float t) {
    vec3 a = noised(p * 2.2 + vec2(t * 0.11, -t * 0.07));
    vec3 b = noised(p * 5.1 + vec2(-t * 0.17, t * 0.13) + 9.7);
    vec2 g = a.yz * 2.2 + b.yz * 5.1 * 0.35;
    return vec2(g.y, -g.x);
}

float bloomSpeed(vec4 d) {
    return mix(0.08, 0.42, spread) * (0.6 + 0.4 * d.w);
}

// How far the pair sits from its centre line: it widens as it slows.
float vortexSep(float age) {
    return dropRadius() * (0.7 + 1.6 * (1.0 - exp(-age / 2.2)));
}

// A drop's vortex pair: (centre, direction of travel). It falls, leaning a little.
vec4 vortexPair(vec4 d, float aspect) {
    float seed = d.x * 13.1 + d.y * 7.7;
    float lean = (hash11(seed + 3.0) - 0.5) * 0.7;
    vec2 dir = vec2(sin(lean), -cos(lean));
    float travel = bloomSpeed(d) * 1.1 * (1.0 - exp(-d.z / 1.1));
    return vec4(vec2(d.x * aspect, d.y) + dir * travel, dir);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        float me = floor(uv.x * DROPS);
        vec4 d = dropAt(me);
        vec4 meta = IMG_NORM_PIXEL(ibMeta, vec2(0.5));
        bool ready = FRAMEINDEX >= 2 && meta.x > 99.5;
        float count = floor(vxCount + 0.5);
        bool strike = ready && abs(count - (meta.x - 100.0)) > 0.5;
        if (!ready) d = vec4(0.0, 0.0, 100.0, 0.0);
        d.z = min(d.z + dt, 100.0);
        if (strike && abs(mod(count, DROPS) - me) < 0.5) {
            vec2 at = dropPlace(count);
            d = vec4(at, 0.0, 0.45 + 0.55 * vxVel);
        }
        gl_FragColor = d;
        return;
    }

    if (PASSINDEX == 1) {
        gl_FragColor = vec4(floor(vxCount + 0.5) + 100.0, 0.0, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 2) {
        vec2 px = 1.0 / RENDERSIZE;
        vec2 p = vec2(uv.x * aspect, uv.y);
        float t = vxPhase * mix(0.4, 2.5, flowSpeed);
        float rad = dropRadius();

        // Velocity in frame-height units per second: a slow curling current,
        // plus a vortex pair under each drop. The pair carries the drop down
        // and rolls its sides up into the curls of a bloom.
        vec2 vel = current(p, t) * mix(0.0, 0.05, curl) * mix(0.4, 1.6, flowSpeed);
        for (int i = 0; i < 4; i++) {
            vec4 d = dropAt(float(i));
            if (d.w > 0.0 && d.z < 12.0) {
                vec4 v = vortexPair(d, aspect);
                vec2 dir = v.zw;
                vec2 side = vec2(-dir.y, dir.x);
                float sep = vortexSep(d.z);
                float speed = bloomSpeed(d) * exp(-d.z / 1.1);
                float circ = speed * 12.566 * sep;
                float core2 = rad * rad * 0.3;
                vec2 ra = p - (v.xy + side * sep);
                vec2 rb = p - (v.xy - side * sep);
                vel += circ / 6.2832 * (vec2(-ra.y, ra.x) / (dot(ra, ra) + core2) - vec2(-rb.y, rb.x) / (dot(rb, rb) + core2));
            }
        }

        // Carry the ink along the flow. The ink diffuses a little; its
        // material coordinates (where in its drop each bit of ink began) are
        // carried without blurring, so fine structure can be drawn from them.
        vec2 back = uv - vel * dt / vec2(aspect, 1.0);
        vec4 c0 = IMG_NORM_PIXEL(ibWater, back);
        vec4 nb = IMG_NORM_PIXEL(ibWater, back + vec2(px.x, 0.0)) + IMG_NORM_PIXEL(ibWater, back - vec2(px.x, 0.0))
                + IMG_NORM_PIXEL(ibWater, back + vec2(0.0, px.y)) + IMG_NORM_PIXEL(ibWater, back - vec2(0.0, px.y));
        vec2 inkv = mix(c0.rg, nb.rg * 0.25, 0.04 * dt * 60.0);
        vec2 mat = c0.ba;

        // The water clears: a slow fade, and a floor that keeps black black.
        float life = mix(12.0, 1.2, dissipation);
        inkv.r *= exp(-dt / life);
        inkv.g *= exp(-dt / (life * 0.3 + 0.2));
        inkv = max(inkv - 0.0006 * dt * 60.0 * vec2(1.0, 1.5), 0.0);

        // New drops: ink poured in at the pair for a moment.
        for (int i = 0; i < 4; i++) {
            vec4 d = dropAt(float(i));
            if (d.w > 0.0 && d.z < INJECT) {
                vec4 v = vortexPair(d, aspect);
                vec2 rel = p - v.xy;
                float g = exp(-dot(rel, rel) / (2.0 * rad * rad));
                float add = d.w * (1.0 - d.z / INJECT) * 2.6 * dt / INJECT * g;
                // Material coordinates in drop radii, turned to the drop's fall.
                vec2 local = vec2(dot(rel, vec2(-v.w, v.z)), dot(rel, v.zw)) / rad;
                mat = mix(mat, local, add / max(inkv.r + add, 1e-4));
                inkv += vec2(add);
            }
        }

        // At rest a faint thread of ink seeps in and wanders off.
        float rest = 1.0;
        for (int i = 0; i < 4; i++) {
            vec4 d = dropAt(float(i));
            if (d.w > 0.0) rest = min(rest, smoothstep(2.0, 8.0, d.z));
        }
        vec2 seepAt = vec2(0.5 * aspect + 0.18 * sin(vxPhase * 0.31), 0.5 + 0.1 * sin(vxPhase * 0.23 + 1.3));
        vec2 sr = p - seepAt;
        float seep = rest * exp(-dot(sr, sr) / (2.0 * 0.016 * 0.016)) * 3.0 * dt;
        mat = mix(mat, sr / 0.03, seep / max(inkv.r + seep, 1e-4));
        inkv.r += seep;

        if (FRAMEINDEX < 2) {
            inkv = vec2(0.0);
            mat = vec2(0.0);
        }
        gl_FragColor = vec4(min(inkv, vec2(4.0)), clamp(mat, -60.0, 60.0));
        return;
    }

    vec4 w = IMG_NORM_PIXEL(ibWater, uv);
    // Fine structure from where each bit of ink began in its drop: layered
    // shells and radial fibres, drawn out by the flow into thin filaments.
    vec2 X = w.ba;
    // Veins: ridged noise of the material coordinates, so a fresh drop is
    // marbled and the flow draws each vein out into a filament.
    float sc = mix(0.8, 1.8, tendrils);
    // Two layers, turned off the lattice and each other so no grid shows.
    vec2 xa = vec2(0.8 * X.x - 0.6 * X.y, 0.6 * X.x + 0.8 * X.y) * sc;
    vec2 xb = vec2(0.28 * X.x + 0.96 * X.y, -0.96 * X.x + 0.28 * X.y) * sc * 2.3;
    float n1 = noise2(xa + 1.7) * 0.7 + noise2(xa * 1.9 + 4.4) * 0.3;
    float n2 = noise2(xb + 8.1) * 0.7 + noise2(xb * 2.1 + 2.2) * 0.3;
    float vein = 1.0 - abs(n1 * 2.0 - 1.0);
    float vein2 = 1.0 - abs(n2 * 2.0 - 1.0);
    float veins = pow(vein, 5.0) * 0.65 + pow(vein2, 5.0) * 0.35;
    // Where the coordinates change faster than a pixel, show the average.
    float fw2 = (fwidth(X.x) + fwidth(X.y)) * sc;
    veins = mix(veins, 0.22, smoothstep(0.25, 0.7, fw2));
    float structure = mix(1.0, 0.2 + 2.6 * veins, tendrils);
    float dens = w.r * structure;
    float gain = 0.6 + 1.8 * brightness;
    float lum = 1.0 - exp(-dens * gain);
    vec3 col = ink.rgb * lum;
    float warm = smoothstep(0.5, 1.3, w.g * structure) * warmth;
    col = mix(col, accent.rgb * lum, warm * 0.85);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
